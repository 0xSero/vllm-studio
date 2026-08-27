const std = @import("std");
const harness_nodes = @import("../agent/harness/nodes.zig");

const Io = std.Io;
const http = std.http;
const max_response_bytes = 16 * 1024 * 1024;

pub const Response = struct {
    allocator: std.mem.Allocator,
    status: http.Status,
    storage: []u8,
    body: []const u8,

    pub fn deinit(response: *Response) void {
        response.allocator.free(response.storage);
        response.* = undefined;
    }
};

pub fn fetch(allocator: std.mem.Allocator, client: *http.Client, target: *const harness_nodes.Target, path: []const u8, method: http.Method, payload: ?[]const u8) !Response {
    var transport_client: http.Client = .{ .allocator = allocator, .io = client.io };
    defer transport_client.deinit();
    const url = try std.fmt.allocPrint(allocator, "{s}{s}", .{ target.address, path });
    defer allocator.free(url);
    const authorization = if (target.api_key.len > 0) try std.fmt.allocPrint(allocator, "Bearer {s}", .{target.api_key}) else null;
    defer if (authorization) |value| allocator.free(value);
    var headers: [3]http.Header = undefined;
    headers[0] = .{ .name = "X-Local-Studio-Federation-Hop", .value = "head" };
    headers[1] = .{ .name = "Content-Type", .value = "application/json" };
    var count: usize = 2;
    if (authorization) |value| {
        headers[count] = .{ .name = "Authorization", .value = value };
        count += 1;
    }
    const storage = try allocator.alloc(u8, max_response_bytes);
    errdefer allocator.free(storage);
    var output: Io.Writer = .fixed(storage);
    const response = try transport_client.fetch(.{
        .location = .{ .url = url },
        .method = method,
        .payload = payload,
        .redirect_behavior = .unhandled,
        .keep_alive = false,
        .headers = .{ .accept_encoding = .omit },
        .extra_headers = headers[0..count],
        .response_writer = &output,
    });
    return .{ .allocator = allocator, .status = response.status, .storage = storage, .body = output.buffered() };
}

pub fn get(allocator: std.mem.Allocator, client: *http.Client, target: *const harness_nodes.Target, path: []const u8) ![]u8 {
    var response = try fetch(allocator, client, target, path, .GET, null);
    defer response.deinit();
    if (!success(response.status)) return error.NodeUnavailable;
    return allocator.dupe(u8, response.body);
}

pub fn send(allocator: std.mem.Allocator, client: *http.Client, target: *const harness_nodes.Target, path: []const u8, method: http.Method, payload: ?[]const u8) ![]u8 {
    var response = try fetch(allocator, client, target, path, method, payload);
    defer response.deinit();
    if (!success(response.status)) return error.NodeRequestRejected;
    return allocator.dupe(u8, response.body);
}

fn success(status: http.Status) bool {
    const code = @intFromEnum(status);
    return code >= 200 and code < 300;
}
