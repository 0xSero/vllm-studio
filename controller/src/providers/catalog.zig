const std = @import("std");
const provider_settings = @import("store.zig");

const Io = std.Io;
const max_parallel_requests = 8;
const max_response_bytes = 8 * 1024 * 1024;
const max_models = 100_000;
const request_timeout = Io.Duration.fromSeconds(10);

const CatalogResult = struct {
    allocator: std.mem.Allocator,
    payload: ?[]u8 = null,

    fn deinit(result: *CatalogResult) void {
        if (result.payload) |value| result.allocator.free(value);
        result.* = undefined;
    }
};

const FetchResult = struct {
    status: std.http.Status,
    body: []u8,
};

pub fn payload(allocator: std.mem.Allocator, io: Io, client: *std.http.Client, providers: []const provider_settings.Provider) ![]u8 {
    var enabled: std.ArrayList(*const provider_settings.Provider) = .empty;
    defer enabled.deinit(allocator);
    for (providers) |*provider| if (provider.enabled and provider.api_key.len > 0) try enabled.append(allocator, provider);
    const results = try allocator.alloc(CatalogResult, enabled.items.len);
    defer allocator.free(results);
    for (results) |*result| result.* = .{ .allocator = allocator };
    defer for (results) |*result| result.deinit();
    var group: Io.Group = .init;
    defer group.cancel(io);
    var start: usize = 0;
    while (start < enabled.items.len) {
        const end = @min(start + max_parallel_requests, enabled.items.len);
        for (enabled.items[start..end], results[start..end]) |provider, *result| {
            group.concurrent(io, fetchInto, .{ allocator, io, client, provider, result }) catch fetchInto(allocator, io, client, provider, result);
        }
        try group.await(io);
        start = end;
    }
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"providers\":[");
    var wrote = false;
    for (results) |result| if (result.payload) |catalog_payload| {
        if (wrote) try output.writer.writeByte(',');
        try output.writer.writeAll(catalog_payload);
        wrote = true;
    };
    try output.writer.writeAll("]}");
    return output.toOwnedSlice();
}

fn fetchInto(allocator: std.mem.Allocator, io: Io, client: *std.http.Client, provider: *const provider_settings.Provider, result: *CatalogResult) void {
    result.payload = catalog(allocator, io, client, provider) catch null;
}

fn catalog(allocator: std.mem.Allocator, io: Io, client: *std.http.Client, provider: *const provider_settings.Provider) ![]u8 {
    const origin = std.mem.trimEnd(u8, std.mem.trim(u8, provider.base_url, " \t\r\n"), "/");
    if (origin.len == 0) return error.InvalidProviderOrigin;
    const url = try std.fmt.allocPrint(allocator, "{s}/v1/models", .{origin});
    defer allocator.free(url);
    const response = try fetch(allocator, io, client, url, provider.api_key);
    defer allocator.free(response.body);
    if (response.status.class() != .success) return error.ProviderRequestFailed;
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, response.body, .{}) catch return error.InvalidProviderResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidProviderResponse;
    const data_value = parsed.value.object.get("data");
    if (data_value != null and data_value.? != .array) return error.InvalidProviderResponse;
    const models = if (data_value) |value| value.array.items else &.{};
    if (models.len > max_models) return error.InvalidProviderResponse;
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"provider\":");
    try std.json.Stringify.value(provider.id, .{}, &output.writer);
    try output.writer.writeAll(",\"models\":[");
    var wrote = false;
    for (models) |model| {
        if (model != .object) return error.InvalidProviderResponse;
        const id_value = model.object.get("id") orelse continue;
        if (id_value != .string) return error.InvalidProviderResponse;
        const id = std.mem.trim(u8, id_value.string, " \t\r\n");
        if (id.len == 0) continue;
        if (wrote) try output.writer.writeByte(',');
        try output.writer.writeAll("{\"id\":");
        try std.json.Stringify.value(id, .{}, &output.writer);
        if (model.object.get("name")) |name_value| {
            if (name_value != .string) return error.InvalidProviderResponse;
            const name = std.mem.trim(u8, name_value.string, " \t\r\n");
            if (name.len > 0) {
                try output.writer.writeAll(",\"name\":");
                try std.json.Stringify.value(name, .{}, &output.writer);
            }
        }
        if (firstPositive(model.object.get("context_window"), model.object.get("max_model_len"))) |value| try output.writer.print(",\"contextWindow\":{d}", .{value});
        if (positive(model.object.get("max_tokens"))) |value| try output.writer.print(",\"maxTokens\":{d}", .{value});
        if (model.object.get("metadata")) |metadata| {
            if (metadata != .object) return error.InvalidProviderResponse;
            try output.writer.writeAll(",\"metadata\":");
            try std.json.Stringify.value(metadata, .{}, &output.writer);
        }
        try output.writer.writeByte('}');
        wrote = true;
    }
    try output.writer.writeAll("]}");
    return output.toOwnedSlice();
}

fn fetch(allocator: std.mem.Allocator, io: Io, client: *std.http.Client, url: []const u8, api_key: []const u8) !FetchResult {
    const Selection = union(enum) { request: anyerror!FetchResult, timer: Io.Cancelable!void };
    var selections: [2]Selection = undefined;
    var select = Io.Select(Selection).init(io, &selections);
    try select.concurrent(.request, fetchRequest, .{ allocator, client, url, api_key });
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
            return error.ProviderRequestTimeout;
        },
    }
}

fn fetchRequest(allocator: std.mem.Allocator, client: *std.http.Client, url: []const u8, api_key: []const u8) !FetchResult {
    const uri = try std.Uri.parse(url);
    return fetchUrl(allocator, client, uri, api_key, 5);
}

fn fetchUrl(allocator: std.mem.Allocator, client: *std.http.Client, uri: std.Uri, api_key: ?[]const u8, redirects_remaining: u8) !FetchResult {
    const storage = try allocator.alloc(u8, max_response_bytes);
    defer allocator.free(storage);
    var body: Io.Writer = .fixed(storage);
    var authorization: ?[]u8 = null;
    defer if (authorization) |value| allocator.free(value);
    const extra_headers: []const std.http.Header = if (api_key) |value| headers: {
        authorization = try std.fmt.allocPrint(allocator, "Bearer {s}", .{value});
        break :headers &.{.{ .name = "Authorization", .value = authorization.? }};
    } else &.{};
    var request = try client.request(.GET, uri, .{
        .redirect_behavior = .unhandled,
        .keep_alive = false,
        .headers = .{ .accept_encoding = .omit, .authorization = .omit },
        .extra_headers = extra_headers,
    });
    defer request.deinit();
    try request.sendBodiless();
    var response = try request.receiveHead(&.{});
    if (response.head.status.class() == .redirect) {
        if (redirects_remaining == 0) return error.TooManyProviderRedirects;
        const location = response.head.location orelse return error.ProviderRedirectMissing;
        if (location.len > 8 * 1024) return error.ProviderRedirectTooLong;
        var resolution_buffer: [32 * 1024]u8 = undefined;
        @memcpy(resolution_buffer[0..location.len], location);
        var resolution_slice: []u8 = &resolution_buffer;
        const next_uri = try uri.resolveInPlace(location.len, &resolution_slice);
        const next_key = if (sameOrigin(uri, next_uri)) api_key else null;
        return fetchUrl(allocator, client, next_uri, next_key, redirects_remaining - 1);
    }
    var read_buffer: [64 * 1024]u8 = undefined;
    const reader = response.reader(&read_buffer);
    _ = try reader.streamRemaining(&body);
    return .{ .status = response.head.status, .body = try allocator.dupe(u8, body.buffered()) };
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

fn sameOrigin(first: std.Uri, second: std.Uri) bool {
    if (!std.ascii.eqlIgnoreCase(first.scheme, second.scheme)) return false;
    var first_buffer: [Io.net.HostName.max_len]u8 = undefined;
    var second_buffer: [Io.net.HostName.max_len]u8 = undefined;
    const first_host = first.getHost(&first_buffer) catch return false;
    const second_host = second.getHost(&second_buffer) catch return false;
    if (!std.ascii.eqlIgnoreCase(first_host.bytes, second_host.bytes)) return false;
    return effectivePort(first) == effectivePort(second);
}

fn effectivePort(uri: std.Uri) ?u16 {
    if (uri.port) |port| return port;
    if (std.ascii.eqlIgnoreCase(uri.scheme, "https")) return 443;
    if (std.ascii.eqlIgnoreCase(uri.scheme, "http")) return 80;
    return null;
}

fn firstPositive(first: ?std.json.Value, second: ?std.json.Value) ?f64 {
    return positive(first) orelse positive(second);
}

fn positive(value: ?std.json.Value) ?f64 {
    const present = value orelse return null;
    const number: f64 = switch (present) {
        .integer => |integer| @floatFromInt(integer),
        .float => |float| float,
        .number_string => |text| std.fmt.parseFloat(f64, text) catch return null,
        else => return null,
    };
    return if (std.math.isFinite(number) and number > 0) number else null;
}
