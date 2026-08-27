const std = @import("std");
const config = @import("../../app/config.zig");
const head_connections = @import("../../topology/head_connection_store.zig");
const model_catalog = @import("../../inference/models/catalog.zig");

const Io = std.Io;
const http = std.http;
const max_response_bytes = 16 * 1024 * 1024;
const request_timeout = Io.Duration.fromMilliseconds(2500);

const FetchResult = struct {
    status: http.Status,
    body: []u8,
};

pub fn payload(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config, client: *http.Client) ![]u8 {
    var connection = if (configuration.mode == .standalone) try head_connections.load(allocator, io, configuration.data_dir) else null;
    defer if (connection) |*value| value.deinit();
    const base_url = if (connection) |value| value.url else try std.fmt.allocPrint(allocator, "http://127.0.0.1:{d}", .{configuration.port});
    defer if (connection == null) allocator.free(base_url);
    const api_key = if (connection) |value| value.api_key else configuration.api_key orelse "local-studio";
    const url = try std.fmt.allocPrint(allocator, "{s}/v1/models", .{base_url});
    defer allocator.free(url);
    const fetched = try fetchWithTimeout(allocator, io, client, url, api_key);
    defer allocator.free(fetched.body);
    if (fetched.status.class() != .success) return error.AgentModelCatalogRejected;
    return model_catalog.offersPayload(allocator, fetched.body, base_url);
}

fn fetchWithTimeout(allocator: std.mem.Allocator, io: Io, client: *http.Client, url: []const u8, api_key: []const u8) !FetchResult {
    const Selection = union(enum) { request: anyerror!FetchResult, timer: Io.Cancelable!void };
    var selections: [2]Selection = undefined;
    var select = Io.Select(Selection).init(io, &selections);
    try select.concurrent(.request, fetch, .{ allocator, client, url, api_key });
    select.concurrent(.timer, waitForTimeout, .{io}) catch {
        while (select.cancel()) |pending| deinitSelection(allocator, pending);
        return error.ConcurrencyUnavailable;
    };
    const selected = try select.await();
    switch (selected) {
        .request => |result| {
            select.cancelDiscard();
            return try result;
        },
        .timer => |result| {
            result catch |failure| switch (failure) {
                error.Canceled => return error.Canceled,
            };
            while (select.cancel()) |pending| deinitSelection(allocator, pending);
            return error.AgentModelCatalogTimeout;
        },
    }
}

fn fetch(allocator: std.mem.Allocator, client: *http.Client, url: []const u8, api_key: []const u8) !FetchResult {
    const storage = try allocator.alloc(u8, max_response_bytes);
    defer allocator.free(storage);
    const authorization = try std.fmt.allocPrint(allocator, "Bearer {s}", .{api_key});
    defer allocator.free(authorization);
    var body: Io.Writer = .fixed(storage);
    const response = try client.fetch(.{
        .location = .{ .url = url },
        .method = .GET,
        .redirect_behavior = .unhandled,
        .keep_alive = false,
        .headers = .{ .accept_encoding = .omit },
        .extra_headers = &.{.{ .name = "Authorization", .value = authorization }},
        .response_writer = &body,
    });
    return .{ .status = response.status, .body = try allocator.dupe(u8, body.buffered()) };
}

fn waitForTimeout(io: Io) Io.Cancelable!void {
    return io.sleep(request_timeout, .awake);
}

fn deinitSelection(allocator: std.mem.Allocator, selection: anytype) void {
    switch (selection) {
        .request => |result| if (result) |response| allocator.free(response.body) else |_| {},
        .timer => {},
    }
}
