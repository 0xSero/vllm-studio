const std = @import("std");

const http = std.http;
const max_tokenize_response_bytes = 4 * 1024 * 1024;

pub fn countPayload(allocator: std.mem.Allocator, client: *http.Client, inference_origin: []const u8, active_model: []const u8, object: std.json.ObjectMap) ![]u8 {
    const model = optionalString(object, "model") orelse active_model;
    const prompt = optionalString(object, "text") orelse "";
    const count = tokenize(allocator, client, inference_origin, model, prompt) catch |failure| {
        var failed: std.Io.Writer.Allocating = .init(allocator);
        errdefer failed.deinit();
        try failed.writer.writeAll("{\"error\":");
        try std.json.Stringify.value(@errorName(failure), .{}, &failed.writer);
        try failed.writer.writeAll(",\"num_tokens\":0}");
        return try failed.toOwnedSlice();
    };
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.print("{{\"num_tokens\":{d},\"model\":", .{count});
    try std.json.Stringify.value(model, .{}, &output.writer);
    try output.writer.writeByte('}');
    return try output.toOwnedSlice();
}

pub fn chatPayload(allocator: std.mem.Allocator, client: *http.Client, inference_origin: []const u8, active_model: []const u8, object: std.json.ObjectMap) ![]u8 {
    const model = optionalString(object, "model") orelse active_model;
    const messages = object.get("messages");
    const tools = object.get("tools");
    var prompt: std.Io.Writer.Allocating = .init(allocator);
    defer prompt.deinit();
    const message_count = if (messages) |value| if (value == .array) value.array.items.len else 0 else 0;
    if (messages) |value| if (value == .array) try writeMessageText(&prompt.writer, value.array.items);
    const message_tokens = tokenize(allocator, client, inference_origin, model, prompt.writer.buffered()) catch 0;
    var tools_tokens: usize = 0;
    const tool_count = if (tools) |value| if (value == .array) value.array.items.len else 0 else 0;
    if (tool_count > 0) {
        var serialized_tools: std.Io.Writer.Allocating = .init(allocator);
        defer serialized_tools.deinit();
        try std.json.Stringify.value(tools.?, .{}, &serialized_tools.writer);
        tools_tokens = tokenize(allocator, client, inference_origin, model, serialized_tools.writer.buffered()) catch 0;
    }
    const overhead = message_count * 4;
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.print("{{\"input_tokens\":{d},\"breakdown\":{{\"messages\":{d},\"tools\":{d}}},\"model\":", .{ message_tokens + tools_tokens + overhead, message_tokens + overhead, tools_tokens });
    try std.json.Stringify.value(model, .{}, &output.writer);
    try output.writer.writeByte('}');
    return try output.toOwnedSlice();
}

pub fn validCountRequest(object: std.json.ObjectMap) bool {
    return optionalStringValid(object.get("text")) and optionalStringValid(object.get("model"));
}

pub fn validChatRequest(object: std.json.ObjectMap) bool {
    return optionalArrayValid(object.get("messages")) and optionalArrayValid(object.get("tools")) and optionalStringValid(object.get("model"));
}

fn tokenize(allocator: std.mem.Allocator, client: *http.Client, inference_origin: []const u8, model: []const u8, prompt: []const u8) !usize {
    const url = try std.fmt.allocPrint(allocator, "{s}/tokenize", .{inference_origin});
    defer allocator.free(url);
    var request_body: std.Io.Writer.Allocating = .init(allocator);
    defer request_body.deinit();
    try request_body.writer.writeAll("{\"model\":");
    try std.json.Stringify.value(model, .{}, &request_body.writer);
    try request_body.writer.writeAll(",\"prompt\":");
    try std.json.Stringify.value(prompt, .{}, &request_body.writer);
    try request_body.writer.writeByte('}');
    const storage = try allocator.alloc(u8, max_tokenize_response_bytes);
    defer allocator.free(storage);
    var response_body: std.Io.Writer = .fixed(storage);
    const headers = [_]http.Header{.{ .name = "Content-Type", .value = "application/json" }};
    const response = try client.fetch(.{
        .location = .{ .url = url },
        .method = .POST,
        .payload = request_body.writer.buffered(),
        .redirect_behavior = .unhandled,
        .keep_alive = false,
        .headers = .{ .accept_encoding = .omit, .content_type = .omit },
        .extra_headers = &headers,
        .response_writer = &response_body,
    });
    if (response.status.class() != .success) return error.TokenizeFailed;
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, response_body.buffered(), .{});
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidTokenizeResponse;
    const tokens = parsed.value.object.get("tokens") orelse return 0;
    if (tokens != .array) return error.InvalidTokenizeResponse;
    return tokens.array.items.len;
}

fn writeMessageText(writer: *std.Io.Writer, messages: []const std.json.Value) !void {
    var first = true;
    for (messages) |message| {
        if (message != .object) continue;
        const content = message.object.get("content") orelse continue;
        switch (content) {
            .string => |text| try writePart(writer, &first, text),
            .array => |parts| {
                var valid = true;
                for (parts.items) |part| {
                    if (part != .object) {
                        valid = false;
                        break;
                    }
                    const part_type = part.object.get("type") orelse {
                        valid = false;
                        break;
                    };
                    if (part_type != .string) {
                        valid = false;
                        break;
                    }
                    if (part.object.get("text")) |text| {
                        if (text != .string) {
                            valid = false;
                            break;
                        }
                    }
                }
                if (!valid) continue;
                for (parts.items) |part| {
                    const part_type = part.object.get("type").?;
                    const text = part.object.get("text") orelse continue;
                    if (std.mem.eql(u8, part_type.string, "text") and text.string.len > 0) try writePart(writer, &first, text.string);
                }
            },
            else => {},
        }
    }
}

fn writePart(writer: *std.Io.Writer, first: *bool, text: []const u8) !void {
    if (!first.*) try writer.writeByte('\n');
    first.* = false;
    try writer.writeAll(text);
}

fn optionalString(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    return if (value == .string) value.string else null;
}

fn optionalStringValid(value: ?std.json.Value) bool {
    const present = value orelse return true;
    return present == .string;
}

fn optionalArrayValid(value: ?std.json.Value) bool {
    const present = value orelse return true;
    return present == .array;
}
