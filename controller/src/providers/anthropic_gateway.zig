const std = @import("std");

const max_response_bytes = 64 * 1024 * 1024;

pub fn serveOpenRouter(allocator: std.mem.Allocator, client: *std.http.Client, api_key: []const u8, payload: []const u8, requested_stream: bool, request: *std.http.Server.Request) !void {
    const upstream_payload = try forceNonStreaming(allocator, payload);
    defer allocator.free(upstream_payload);
    const authorization = try std.fmt.allocPrint(allocator, "Bearer {s}", .{api_key});
    defer allocator.free(authorization);
    const storage = try allocator.alloc(u8, max_response_bytes);
    defer allocator.free(storage);
    var body: std.Io.Writer = .fixed(storage);
    const response = try client.fetch(.{
        .location = .{ .url = "https://openrouter.ai/api/v1/messages" },
        .method = .POST,
        .payload = upstream_payload,
        .redirect_behavior = .not_allowed,
        .keep_alive = false,
        .headers = .{ .accept_encoding = .omit, .authorization = .omit, .content_type = .omit },
        .extra_headers = &.{
            .{ .name = "Authorization", .value = authorization },
            .{ .name = "Content-Type", .value = "application/json" },
            .{ .name = "Accept", .value = "application/json" },
            .{ .name = "Anthropic-Version", .value = "2023-06-01" },
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
    if (!requested_stream) {
        try request.respond(body.buffered(), .{
            .status = response.status,
            .keep_alive = false,
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return;
    }
    try writeStream(allocator, body.buffered(), request);
}

fn forceNonStreaming(allocator: std.mem.Allocator, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidAnthropicPayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidAnthropicPayload;
    try parsed.value.object.put(parsed.arena.allocator(), "stream", .{ .bool = false });
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(parsed.value, .{}, &output.writer);
    return output.toOwnedSlice();
}

fn writeStream(allocator: std.mem.Allocator, document: []const u8, request: *std.http.Server.Request) !void {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidAnthropicResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidAnthropicResponse;
    const object = parsed.value.object;
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
    try downstream.writer.writeAll("event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":");
    try std.json.Stringify.value(stringField(object, "id") orelse "msg_local_studio", .{}, &downstream.writer);
    try downstream.writer.writeAll(",\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"model\":");
    try std.json.Stringify.value(stringField(object, "model") orelse "unknown", .{}, &downstream.writer);
    try downstream.writer.writeAll(",\"stop_reason\":null,\"stop_sequence\":null,\"usage\":");
    if (object.get("usage")) |usage| try std.json.Stringify.value(usage, .{}, &downstream.writer) else try downstream.writer.writeAll("{\"input_tokens\":0,\"output_tokens\":0}");
    try downstream.writer.writeAll("}}\n\n");
    if (object.get("content")) |content| if (content == .array) for (content.array.items, 0..) |block, index| {
        if (block != .object) continue;
        const block_type = stringField(block.object, "type") orelse continue;
        try downstream.writer.print("event: content_block_start\ndata: {{\"type\":\"content_block_start\",\"index\":{d},\"content_block\":", .{index});
        if (std.mem.eql(u8, block_type, "text")) {
            try downstream.writer.writeAll("{\"type\":\"text\",\"text\":\"\"}}\n\n");
            try downstream.writer.print("event: content_block_delta\ndata: {{\"type\":\"content_block_delta\",\"index\":{d},\"delta\":{{\"type\":\"text_delta\",\"text\":", .{index});
            try std.json.Stringify.value(stringField(block.object, "text") orelse "", .{}, &downstream.writer);
            try downstream.writer.writeAll("}}\n\n");
        } else if (std.mem.eql(u8, block_type, "thinking")) {
            try downstream.writer.writeAll("{\"type\":\"thinking\",\"thinking\":\"\"}}\n\n");
            try downstream.writer.print("event: content_block_delta\ndata: {{\"type\":\"content_block_delta\",\"index\":{d},\"delta\":{{\"type\":\"thinking_delta\",\"thinking\":", .{index});
            try std.json.Stringify.value(stringField(block.object, "thinking") orelse "", .{}, &downstream.writer);
            try downstream.writer.writeAll("}}\n\n");
        } else if (std.mem.eql(u8, block_type, "tool_use")) {
            try downstream.writer.writeAll("{\"type\":\"tool_use\",\"id\":");
            try std.json.Stringify.value(stringField(block.object, "id") orelse "tool_local_studio", .{}, &downstream.writer);
            try downstream.writer.writeAll(",\"name\":");
            try std.json.Stringify.value(stringField(block.object, "name") orelse "tool", .{}, &downstream.writer);
            try downstream.writer.writeAll(",\"input\":{}}}\n\n");
            var input: std.Io.Writer.Allocating = .init(allocator);
            defer input.deinit();
            if (block.object.get("input")) |value| try std.json.Stringify.value(value, .{}, &input.writer) else try input.writer.writeAll("{}");
            try downstream.writer.print("event: content_block_delta\ndata: {{\"type\":\"content_block_delta\",\"index\":{d},\"delta\":{{\"type\":\"input_json_delta\",\"partial_json\":", .{index});
            try std.json.Stringify.value(input.writer.buffered(), .{}, &downstream.writer);
            try downstream.writer.writeAll("}}\n\n");
        } else {
            try std.json.Stringify.value(block, .{}, &downstream.writer);
            try downstream.writer.writeAll("}\n\n");
        }
        try downstream.writer.print("event: content_block_stop\ndata: {{\"type\":\"content_block_stop\",\"index\":{d}}}\n\n", .{index});
    };
    try downstream.writer.writeAll("event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":");
    if (object.get("stop_reason")) |value| try std.json.Stringify.value(value, .{}, &downstream.writer) else try downstream.writer.writeAll("\"end_turn\"");
    try downstream.writer.writeAll(",\"stop_sequence\":");
    if (object.get("stop_sequence")) |value| try std.json.Stringify.value(value, .{}, &downstream.writer) else try downstream.writer.writeAll("null");
    try downstream.writer.writeAll("},\"usage\":");
    if (object.get("usage")) |usage| try std.json.Stringify.value(usage, .{}, &downstream.writer) else try downstream.writer.writeAll("{\"output_tokens\":0}");
    try downstream.writer.writeAll("}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n");
    try downstream.end();
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    return if (value == .string) value.string else null;
}
