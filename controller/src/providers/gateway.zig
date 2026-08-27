const std = @import("std");
const openai_protocol = @import("openai_protocol.zig");
const provider_settings = @import("store.zig");
const inference_usage = @import("../inference/usage/store.zig");

const max_response_bytes = 64 * 1024 * 1024;

pub fn serveTranslated(allocator: std.mem.Allocator, client: *std.http.Client, provider: *const provider_settings.Provider, public_protocol: openai_protocol.Protocol, payload: []const u8, requested_stream: bool, request: *std.http.Server.Request) !?inference_usage.Sample {
    const upstream_protocol: openai_protocol.Protocol = switch (provider.protocol) {
        .auto => public_protocol,
        .chat_completions => .chat_completions,
        .responses => .responses,
    };
    return serve(allocator, client, provider.base_url, provider.api_key, public_protocol, upstream_protocol, payload, requested_stream, request);
}

pub fn serve(allocator: std.mem.Allocator, client: *std.http.Client, base_url: []const u8, api_key: []const u8, public_protocol: openai_protocol.Protocol, upstream_protocol: openai_protocol.Protocol, payload: []const u8, requested_stream: bool, request: *std.http.Server.Request) !?inference_usage.Sample {
    const translated = if (upstream_protocol == public_protocol) try allocator.dupe(u8, payload) else try openai_protocol.request(allocator, public_protocol, upstream_protocol, payload);
    defer allocator.free(translated);
    const upstream_payload = try forceNonStreaming(allocator, translated);
    defer allocator.free(upstream_payload);
    const path = switch (upstream_protocol) {
        .chat_completions => "v1/chat/completions",
        .responses => "v1/responses",
    };
    const base = std.mem.trimEnd(u8, std.mem.trim(u8, base_url, " \t\r\n"), "/");
    const url = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ base, path });
    defer allocator.free(url);
    const authorization = try std.fmt.allocPrint(allocator, "Bearer {s}", .{api_key});
    defer allocator.free(authorization);
    const storage = try allocator.alloc(u8, max_response_bytes);
    defer allocator.free(storage);
    var body: std.Io.Writer = .fixed(storage);
    const response = try client.fetch(.{
        .location = .{ .url = url },
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
        return null;
    }
    const converted = if (upstream_protocol == public_protocol) try allocator.dupe(u8, body.buffered()) else try openai_protocol.response(allocator, upstream_protocol, public_protocol, body.buffered());
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
        .chat_completions => {
            const chunk = try chatChunk(allocator, converted);
            defer allocator.free(chunk);
            try downstream.writer.print("data: {s}\n\ndata: [DONE]\n\n", .{chunk});
        },
        .responses => try openai_protocol.writeResponsesStream(allocator, &downstream.writer, converted),
    }
    try downstream.end();
    return sample;
}

fn forceNonStreaming(allocator: std.mem.Allocator, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidInferencePayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidInferencePayload;
    try parsed.value.object.put(parsed.arena.allocator(), "stream", .{ .bool = false });
    _ = parsed.value.object.swapRemove("stream_options");
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(parsed.value, .{}, &output.writer);
    return output.toOwnedSlice();
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
