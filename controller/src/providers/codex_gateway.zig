const std = @import("std");
const oauth_credentials = @import("../accounts/oauth_credentials.zig");
const openai_protocol = @import("openai_protocol.zig");
const inference_usage = @import("../inference/usage/store.zig");

const max_response_bytes = 64 * 1024 * 1024;

pub fn serve(allocator: std.mem.Allocator, client: *std.http.Client, credential: *const oauth_credentials.Credential, model_id: []const u8, public_protocol: openai_protocol.Protocol, payload: []const u8, requested_stream: bool, request: *std.http.Server.Request) !?inference_usage.Sample {
    const responses_payload = try openai_protocol.request(allocator, public_protocol, .responses, payload);
    defer allocator.free(responses_payload);
    const upstream_payload = try prepareRequest(allocator, responses_payload, model_id);
    defer allocator.free(upstream_payload);
    const authorization = try std.fmt.allocPrint(allocator, "Bearer {s}", .{credential.access});
    defer allocator.free(authorization);
    const storage = try allocator.alloc(u8, max_response_bytes);
    defer allocator.free(storage);
    var upstream_body: std.Io.Writer = .fixed(storage);
    const response = try client.fetch(.{
        .location = .{ .url = "https://chatgpt.com/backend-api/codex/responses" },
        .method = .POST,
        .payload = upstream_payload,
        .redirect_behavior = .not_allowed,
        .keep_alive = false,
        .headers = .{ .accept_encoding = .omit, .authorization = .omit, .content_type = .omit },
        .extra_headers = &.{
            .{ .name = "Authorization", .value = authorization },
            .{ .name = "chatgpt-account-id", .value = credential.account_id },
            .{ .name = "originator", .value = "local-studio" },
            .{ .name = "User-Agent", .value = "local-studio-zig" },
            .{ .name = "OpenAI-Beta", .value = "responses=experimental" },
            .{ .name = "Accept", .value = "text/event-stream" },
            .{ .name = "Content-Type", .value = "application/json" },
        },
        .response_writer = &upstream_body,
    });
    if (response.status.class() != .success) {
        try request.respond(upstream_body.buffered(), .{
            .status = response.status,
            .keep_alive = false,
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return null;
    }
    const completed = try completedResponse(allocator, upstream_body.buffered());
    defer allocator.free(completed);
    const converted = try openai_protocol.response(allocator, .responses, public_protocol, completed);
    defer allocator.free(converted);
    const sample = inference_usage.parseSample(allocator, converted);
    if (!requested_stream) {
        try request.respond(converted, .{
            .status = response.status,
            .keep_alive = false,
            .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
        });
        return sample;
    }
    var write_buffer: [16 * 1024]u8 = undefined;
    var downstream = try request.respondStreaming(&write_buffer, .{
        .respond_options = .{
            .status = response.status,
            .keep_alive = false,
            .extra_headers = &.{
                .{ .name = "Content-Type", .value = "text/event-stream; charset=utf-8" },
                .{ .name = "Cache-Control", .value = "no-cache" },
                .{ .name = "X-Accel-Buffering", .value = "no" },
            },
        },
    });
    switch (public_protocol) {
        .responses => try downstream.writer.writeAll(upstream_body.buffered()),
        .chat_completions => {
            const chunk = try chatChunk(allocator, converted);
            defer allocator.free(chunk);
            try downstream.writer.print("data: {s}\n\ndata: [DONE]\n\n", .{chunk});
        },
    }
    try downstream.end();
    return sample;
}

fn prepareRequest(allocator: std.mem.Allocator, document: []const u8, model_id: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidInferencePayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidInferencePayload;
    const storage = parsed.arena.allocator();
    try parsed.value.object.put(storage, "model", .{ .string = try storage.dupe(u8, model_id) });
    try parsed.value.object.put(storage, "store", .{ .bool = false });
    try parsed.value.object.put(storage, "stream", .{ .bool = true });
    if (parsed.value.object.get("instructions") == null) try parsed.value.object.put(storage, "instructions", .{ .string = "You are a helpful assistant." });
    var include: std.json.Array = .init(storage);
    var has_encrypted = false;
    if (parsed.value.object.get("include")) |value| if (value == .array) for (value.array.items) |entry| if (entry == .string) {
        try include.append(entry);
        if (std.mem.eql(u8, entry.string, "reasoning.encrypted_content")) has_encrypted = true;
    };
    if (!has_encrypted) try include.append(.{ .string = "reasoning.encrypted_content" });
    try parsed.value.object.put(storage, "include", .{ .array = include });
    _ = parsed.value.object.swapRemove("max_output_tokens");
    _ = parsed.value.object.swapRemove("stream_options");
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(parsed.value, .{}, &output.writer);
    return output.toOwnedSlice();
}

fn completedResponse(allocator: std.mem.Allocator, body: []const u8) ![]u8 {
    const trimmed = std.mem.trim(u8, body, " \t\r\n");
    if (trimmed.len == 0) return error.EmptyCodexResponse;
    if (trimmed[0] == '{') {
        var direct = std.json.parseFromSlice(std.json.Value, allocator, trimmed, .{}) catch null;
        if (direct) |*parsed| {
            defer parsed.deinit();
            if (parsed.value == .object and parsed.value.object.get("output") != null) return allocator.dupe(u8, trimmed);
        }
    }
    var last: ?[]u8 = null;
    errdefer if (last) |value| allocator.free(value);
    var blocks = std.mem.splitSequence(u8, body, "\n\n");
    while (blocks.next()) |block| {
        var data: std.Io.Writer.Allocating = .init(allocator);
        defer data.deinit();
        var lines = std.mem.splitScalar(u8, block, '\n');
        while (lines.next()) |raw_line| {
            const line = std.mem.trimEnd(u8, raw_line, "\r");
            if (!std.mem.startsWith(u8, line, "data:")) continue;
            if (data.writer.buffered().len > 0) try data.writer.writeByte('\n');
            try data.writer.writeAll(std.mem.trim(u8, line[5..], " \t"));
        }
        const event_document = data.writer.buffered();
        if (event_document.len == 0 or std.mem.eql(u8, event_document, "[DONE]")) continue;
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, event_document, .{}) catch continue;
        defer parsed.deinit();
        if (parsed.value != .object) continue;
        const event_type = stringField(parsed.value.object, "type") orelse "";
        if (!std.mem.eql(u8, event_type, "response.completed") and !std.mem.eql(u8, event_type, "response.done") and !std.mem.eql(u8, event_type, "response.incomplete")) continue;
        const response = parsed.value.object.get("response") orelse continue;
        if (response != .object) continue;
        var output: std.Io.Writer.Allocating = .init(allocator);
        errdefer output.deinit();
        try std.json.Stringify.value(response, .{}, &output.writer);
        if (last) |value| allocator.free(value);
        last = try output.toOwnedSlice();
    }
    return last orelse error.CodexStreamMissingCompletion;
}

fn chatChunk(allocator: std.mem.Allocator, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidInferenceResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidInferenceResponse;
    const choices = parsed.value.object.getPtr("choices") orelse return error.InvalidInferenceResponse;
    if (choices.* != .array) return error.InvalidInferenceResponse;
    for (choices.array.items) |*choice| {
        if (choice.* != .object) continue;
        if (choice.object.fetchSwapRemove("message")) |entry| try choice.object.put(parsed.arena.allocator(), "delta", entry.value);
    }
    try parsed.value.object.put(parsed.arena.allocator(), "object", .{ .string = "chat.completion.chunk" });
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(parsed.value, .{}, &output.writer);
    return output.toOwnedSlice();
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    return if (value == .string) value.string else null;
}
