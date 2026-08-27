const std = @import("std");

const max_response_bytes = 64 * 1024 * 1024;

pub fn serve(allocator: std.mem.Allocator, client: *std.http.Client, base_url: []const u8, api_key: []const u8, model_id: []const u8, payload: []const u8, request: *std.http.Server.Request) !void {
    const upstream_payload = try toChatPayload(allocator, model_id, payload);
    defer allocator.free(upstream_payload);
    const upstream_url = try std.fmt.allocPrint(allocator, "{s}/chat/completions", .{std.mem.trimEnd(u8, base_url, "/")});
    defer allocator.free(upstream_url);
    const authorization = try std.fmt.allocPrint(allocator, "Bearer {s}", .{api_key});
    defer allocator.free(authorization);
    const storage = try allocator.alloc(u8, max_response_bytes);
    defer allocator.free(storage);
    var body: std.Io.Writer = .fixed(storage);
    const response = try client.fetch(.{
        .location = .{ .url = upstream_url },
        .method = .POST,
        .payload = upstream_payload,
        .redirect_behavior = .not_allowed,
        .keep_alive = false,
        .headers = .{ .accept_encoding = .omit, .authorization = .omit, .content_type = .omit },
        .extra_headers = &.{
            .{ .name = "Authorization", .value = authorization },
            .{ .name = "Content-Type", .value = "application/json" },
            .{ .name = "Accept", .value = "application/json" },
        },
        .response_writer = &body,
    });
    if (response.status.class() != .success) {
        try request.respond(body.buffered(), .{
            .status = response.status,
            .keep_alive = false,
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return;
    }
    try writeVercelStream(allocator, body.buffered(), request);
}

fn toChatPayload(allocator: std.mem.Allocator, model_id: []const u8, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidFxGatewayPayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidFxGatewayPayload;
    const prompt = parsed.value.object.get("prompt") orelse return error.InvalidFxGatewayPayload;
    if (prompt != .array) return error.InvalidFxGatewayPayload;
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"model\":");
    try std.json.Stringify.value(model_id, .{}, &output.writer);
    try output.writer.writeAll(",\"stream\":false,\"messages\":[");
    var first = true;
    for (prompt.array.items) |entry| try writePromptEntry(allocator, &output.writer, &first, entry);
    try output.writer.writeAll("],\"tools\":[");
    if (parsed.value.object.get("tools")) |tools| if (tools == .array) for (tools.array.items, 0..) |tool, index| {
        if (index > 0) try output.writer.writeByte(',');
        try writeTool(&output.writer, tool);
    };
    try output.writer.writeAll("],\"tool_choice\":\"auto\"}");
    return output.toOwnedSlice();
}

fn writePromptEntry(allocator: std.mem.Allocator, writer: *std.Io.Writer, first: *bool, entry: std.json.Value) !void {
    if (entry != .object) return;
    const role = stringField(entry.object, "role") orelse return;
    const content = entry.object.get("content") orelse std.json.Value{ .string = "" };
    if (std.mem.eql(u8, role, "tool")) {
        if (content != .array) return;
        for (content.array.items) |part| {
            if (part != .object or !std.mem.eql(u8, stringField(part.object, "type") orelse "", "tool-result")) continue;
            try comma(writer, first);
            try writer.writeAll("{\"role\":\"tool\",\"tool_call_id\":");
            try std.json.Stringify.value(stringField(part.object, "toolCallId") orelse "", .{}, writer);
            try writer.writeAll(",\"content\":");
            try writeToolOutput(allocator, writer, part.object.get("output"));
            try writer.writeByte('}');
        }
        return;
    }
    try comma(writer, first);
    try writer.writeAll("{\"role\":");
    try std.json.Stringify.value(role, .{}, writer);
    try writer.writeAll(",\"content\":");
    var text: std.Io.Writer.Allocating = .init(allocator);
    defer text.deinit();
    try appendText(&text.writer, content);
    if (text.writer.buffered().len > 0) try std.json.Stringify.value(text.writer.buffered(), .{}, writer) else try writer.writeAll("null");
    if (std.mem.eql(u8, role, "assistant") and content == .array) {
        var call_count: usize = 0;
        for (content.array.items) |part| {
            if (part == .object and std.mem.eql(u8, stringField(part.object, "type") orelse "", "tool-call")) call_count += 1;
        }
        if (call_count > 0) {
            try writer.writeAll(",\"tool_calls\":[");
            var call_index: usize = 0;
            for (content.array.items) |part| {
                if (part != .object or !std.mem.eql(u8, stringField(part.object, "type") orelse "", "tool-call")) continue;
                if (call_index > 0) try writer.writeByte(',');
                try writer.writeAll("{\"id\":");
                try std.json.Stringify.value(stringField(part.object, "toolCallId") orelse "", .{}, writer);
                try writer.writeAll(",\"type\":\"function\",\"function\":{\"name\":");
                try std.json.Stringify.value(stringField(part.object, "toolName") orelse "", .{}, writer);
                try writer.writeAll(",\"arguments\":");
                try writeJsonAsString(allocator, writer, part.object.get("input") orelse std.json.Value{ .object = .empty });
                try writer.writeAll("}}");
                call_index += 1;
            }
            try writer.writeByte(']');
        }
    }
    try writer.writeByte('}');
}

fn writeTool(writer: *std.Io.Writer, tool: std.json.Value) !void {
    if (tool != .object) return error.InvalidFxGatewayPayload;
    try writer.writeAll("{\"type\":\"function\",\"function\":{\"name\":");
    try std.json.Stringify.value(stringField(tool.object, "name") orelse "", .{}, writer);
    if (stringField(tool.object, "description")) |description| {
        try writer.writeAll(",\"description\":");
        try std.json.Stringify.value(description, .{}, writer);
    }
    try writer.writeAll(",\"parameters\":");
    if (tool.object.get("inputSchema")) |schema| try std.json.Stringify.value(schema, .{}, writer) else try writer.writeAll("{\"type\":\"object\"}");
    try writer.writeAll("}}");
}

fn appendText(writer: *std.Io.Writer, content: std.json.Value) !void {
    if (content == .string) return writer.writeAll(content.string);
    if (content != .array) return;
    for (content.array.items) |part| {
        if (part != .object or !std.mem.eql(u8, stringField(part.object, "type") orelse "", "text")) continue;
        if (stringField(part.object, "text")) |text| try writer.writeAll(text);
    }
}

fn writeToolOutput(allocator: std.mem.Allocator, writer: *std.Io.Writer, output: ?std.json.Value) !void {
    const value = output orelse return writer.writeAll("\"\"");
    if (value == .object and stringField(value.object, "type") != null and std.mem.eql(u8, stringField(value.object, "type").?, "text")) {
        return std.json.Stringify.value(stringField(value.object, "value") orelse "", .{}, writer);
    }
    return writeJsonAsString(allocator, writer, value);
}

fn writeJsonAsString(allocator: std.mem.Allocator, writer: *std.Io.Writer, value: std.json.Value) !void {
    if (value == .string) return std.json.Stringify.value(value.string, .{}, writer);
    var encoded: std.Io.Writer.Allocating = .init(allocator);
    defer encoded.deinit();
    try std.json.Stringify.value(value, .{}, &encoded.writer);
    try std.json.Stringify.value(encoded.writer.buffered(), .{}, writer);
}

fn writeVercelStream(allocator: std.mem.Allocator, document: []const u8, request: *std.http.Server.Request) !void {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidFxGatewayResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidFxGatewayResponse;
    const choices = parsed.value.object.get("choices") orelse return error.InvalidFxGatewayResponse;
    if (choices != .array or choices.array.items.len == 0 or choices.array.items[0] != .object) return error.InvalidFxGatewayResponse;
    const message = choices.array.items[0].object.get("message") orelse return error.InvalidFxGatewayResponse;
    if (message != .object) return error.InvalidFxGatewayResponse;
    var write_buffer: [16 * 1024]u8 = undefined;
    var downstream = try request.respondStreaming(&write_buffer, .{
        .respond_options = .{
            .status = .ok,
            .keep_alive = false,
            .extra_headers = &.{
                .{ .name = "Content-Type", .value = "text/event-stream; charset=utf-8" },
                .{ .name = "Cache-Control", .value = "no-cache" },
                .{ .name = "X-Accel-Buffering", .value = "no" },
            },
        },
    });
    if (stringField(message.object, "content")) |text| if (text.len > 0) {
        try downstream.writer.writeAll("data: {\"type\":\"text-delta\",\"id\":\"answer\",\"delta\":");
        try std.json.Stringify.value(text, .{}, &downstream.writer);
        try downstream.writer.writeAll("}\n\n");
    };
    var tool_count: usize = 0;
    if (message.object.get("tool_calls")) |calls| if (calls == .array) for (calls.array.items) |call| {
        if (call != .object) continue;
        const function = call.object.get("function") orelse continue;
        if (function != .object) continue;
        try downstream.writer.writeAll("data: {\"type\":\"tool-call\",\"toolCallId\":");
        try std.json.Stringify.value(stringField(call.object, "id") orelse "", .{}, &downstream.writer);
        try downstream.writer.writeAll(",\"toolName\":");
        try std.json.Stringify.value(stringField(function.object, "name") orelse "", .{}, &downstream.writer);
        try downstream.writer.writeAll(",\"input\":");
        const arguments = stringField(function.object, "arguments") orelse "{}";
        var parsed_arguments = std.json.parseFromSlice(std.json.Value, allocator, arguments, .{}) catch null;
        if (parsed_arguments) |*value| {
            defer value.deinit();
            try std.json.Stringify.value(value.value, .{}, &downstream.writer);
        } else try downstream.writer.writeAll("{}");
        try downstream.writer.writeAll("}\n\n");
        tool_count += 1;
    };
    try downstream.writer.writeAll("data: {\"type\":\"finish\",\"finishReason\":{\"unified\":");
    try std.json.Stringify.value(if (tool_count > 0) "tool-calls" else "stop", .{}, &downstream.writer);
    try downstream.writer.writeAll(",\"raw\":");
    try std.json.Stringify.value(if (tool_count > 0) "tool_calls" else "stop", .{}, &downstream.writer);
    try downstream.writer.writeAll("},\"usage\":{\"inputTokens\":{\"total\":");
    try writeUsageValue(&downstream.writer, parsed.value.object.get("usage"), "prompt_tokens");
    try downstream.writer.writeAll("},\"outputTokens\":{\"total\":");
    try writeUsageValue(&downstream.writer, parsed.value.object.get("usage"), "completion_tokens");
    try downstream.writer.writeAll("}}}\n\ndata: [DONE]\n\n");
    try downstream.end();
}

fn writeUsageValue(writer: *std.Io.Writer, usage: ?std.json.Value, name: []const u8) !void {
    const value = usage orelse return writer.writeByte('0');
    if (value != .object) return writer.writeByte('0');
    const count = value.object.get(name) orelse return writer.writeByte('0');
    if (count == .integer) return writer.print("{d}", .{count.integer});
    return writer.writeByte('0');
}

fn comma(writer: *std.Io.Writer, first: *bool) !void {
    if (!first.*) try writer.writeByte(',');
    first.* = false;
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    return if (value == .string) value.string else null;
}
