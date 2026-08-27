const std = @import("std");
const runtime_limits = @import("../../agent/runtime/limits.zig");
const sse = @import("../../agent/runtime/sse.zig");
const protocol = @import("../protocol.zig");
const request_encoder = @import("request.zig");
const response_runtime = @import("response.zig");

pub fn stream(allocator: std.mem.Allocator, client: *std.http.Client, endpoint: []const u8, request: protocol.Request) !protocol.Result {
    if (request.cancel_flag.load(.seq_cst)) return error.Cancelled;
    const payload = try request_encoder.encode(allocator, request);
    defer allocator.free(payload);
    const authorization = try std.fmt.allocPrint(allocator, "Bearer {s}", .{request.api_key});
    defer allocator.free(authorization);
    const uri = try std.Uri.parse(endpoint);
    var http_request = try client.request(.POST, uri, .{
        .headers = .{
            .content_type = .{ .override = "application/json" },
            .authorization = .{ .override = authorization },
            .accept_encoding = .omit,
        },
        .extra_headers = &.{.{ .name = "Accept", .value = "text/event-stream" }},
        .keep_alive = true,
        .redirect_behavior = .unhandled,
    });
    defer http_request.deinit();
    http_request.transfer_encoding = .{ .content_length = payload.len };
    var send_buffer: [8192]u8 = undefined;
    var body_writer = try http_request.sendBodyUnflushed(&send_buffer);
    try body_writer.writer.writeAll(payload);
    try body_writer.end();
    if (http_request.connection) |connection| try connection.flush();
    var response = try http_request.receiveHead(&.{});
    if (response.head.status != .ok) {
        var transfer: [16 * 1024]u8 = undefined;
        const reader = response.reader(&transfer);
        const detail = reader.allocRemaining(allocator, .limited(runtime_limits.chat.error_body_bytes)) catch |failure| switch (failure) {
            error.StreamTooLong => try allocator.dupe(u8, "Provider error response exceeded the local limit"),
            else => return failure,
        };
        return .{ .failed = .{
            .kind = failureKind(response.head.status),
            .detail = detail,
        } };
    }
    var transfer: [256 * 1024]u8 = undefined;
    const reader = response.reader(&transfer);
    var reducer = response_runtime.Reducer.init(allocator);
    defer reducer.deinit(allocator);
    var decoder = sse.Decoder{ .maximum_line_bytes = runtime_limits.chat.stream_line_bytes };
    defer decoder.deinit(allocator);
    while (try decoder.next(allocator, reader)) |data| {
        defer decoder.release();
        if (try reducer.apply(allocator, data, request)) break;
    }
    return .{ .completed = try reducer.finish(allocator, request.cancel_flag) };
}

fn failureKind(status: std.http.Status) protocol.FailureKind {
    return switch (status) {
        .bad_request => .invalid_request,
        .unauthorized => .unauthorized,
        .forbidden => .forbidden,
        .payload_too_large => .request_too_large,
        .too_many_requests => .rate_limited,
        .internal_server_error => .server_error,
        .bad_gateway => .bad_gateway,
        .service_unavailable => .unavailable,
        .gateway_timeout => .gateway_timeout,
        else => .provider_error,
    };
}
