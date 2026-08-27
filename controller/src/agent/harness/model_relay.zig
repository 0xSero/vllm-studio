const std = @import("std");
const config = @import("../../app/config.zig");

const Io = std.Io;
const http = std.http;
const max_body_bytes = 64 * 1024 * 1024;
const max_pending_requests = 16;

const Pending = struct {
    allocator: std.mem.Allocator,
    id: []u8,
    target: []u8,
    body: []u8,
    streaming: bool,
    dispatched: bool = false,
    response_status: ?u16 = null,
    response_content_type: ?[]u8 = null,
    response_body: ?[]u8 = null,
    completed: Io.Event = .unset,

    fn deinit(pending: *Pending) void {
        pending.allocator.free(pending.id);
        pending.allocator.free(pending.target);
        pending.allocator.free(pending.body);
        if (pending.response_content_type) |value| pending.allocator.free(value);
        if (pending.response_body) |value| pending.allocator.free(value);
        pending.allocator.destroy(pending);
    }
};

pub const Manager = struct {
    allocator: std.mem.Allocator,
    io: Io,
    mode: config.Mode,
    mutex: Io.Mutex = .init,
    available: Io.Condition = .init,
    pending: std.StringHashMapUnmanaged(*Pending) = .empty,

    pub fn init(allocator: std.mem.Allocator, io: Io, mode: config.Mode) Manager {
        return .{ .allocator = allocator, .io = io, .mode = mode };
    }

    pub fn deinit(manager: *Manager) void {
        manager.mutex.lockUncancelable(manager.io);
        var iterator = manager.pending.valueIterator();
        while (iterator.next()) |pending| pending.*.completed.set(manager.io);
        manager.mutex.unlock(manager.io);
        iterator = manager.pending.valueIterator();
        while (iterator.next()) |pending| pending.*.deinit();
        manager.pending.deinit(manager.allocator);
        manager.* = undefined;
    }

    pub fn serveModel(manager: *Manager, target: []const u8, request: *http.Server.Request) !bool {
        if (manager.mode != .worker or !validRelayTarget(target)) return error.ModelRelayUnavailable;
        const storage = try manager.allocator.alloc(u8, max_body_bytes);
        defer manager.allocator.free(storage);
        var body_writer: Io.Writer = .fixed(storage);
        var read_buffer: [16 * 1024]u8 = undefined;
        const reader = try request.readerExpectContinue(&read_buffer);
        _ = reader.streamRemaining(&body_writer) catch return error.ModelRelayRequestTooLarge;
        var random: [20]u8 = undefined;
        manager.io.random(&random);
        const id_buffer = std.fmt.bytesToHex(random, .lower);
        const pending = try manager.allocator.create(Pending);
        errdefer manager.allocator.destroy(pending);
        pending.* = .{
            .allocator = manager.allocator,
            .id = try manager.allocator.dupe(u8, id_buffer[0..]),
            .target = try manager.allocator.dupe(u8, target),
            .body = try manager.allocator.dupe(u8, body_writer.buffered()),
            .streaming = requestStreams(body_writer.buffered()),
        };
        errdefer pending.deinit();
        try manager.mutex.lock(manager.io);
        if (manager.pending.count() >= max_pending_requests) {
            manager.mutex.unlock(manager.io);
            return error.ModelRelayCapacityExhausted;
        }
        try manager.pending.put(manager.allocator, pending.id, pending);
        manager.available.signal(manager.io);
        manager.mutex.unlock(manager.io);
        defer {
            manager.mutex.lockUncancelable(manager.io);
            _ = manager.pending.remove(pending.id);
            manager.mutex.unlock(manager.io);
            pending.deinit();
        }
        try pending.completed.wait(manager.io);
        const status_code = pending.response_status orelse return error.ModelRelayDisconnected;
        const response_body = pending.response_body orelse return error.ModelRelayDisconnected;
        const content_type = pending.response_content_type orelse if (pending.streaming) "text/event-stream" else "application/json";
        try request.respond(response_body, .{
            .status = @enumFromInt(status_code),
            .keep_alive = false,
            .extra_headers = &.{.{ .name = "Content-Type", .value = content_type }},
        });
        return false;
    }

    pub fn pollPayload(manager: *Manager) ![]u8 {
        if (manager.mode != .worker) return error.ModelRelayUnavailable;
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        while (nextPending(manager) == null) try manager.available.wait(manager.io, &manager.mutex);
        const pending = nextPending(manager).?;
        pending.dispatched = true;
        var output: Io.Writer.Allocating = .init(manager.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"request\":{\"id\":");
        try std.json.Stringify.value(pending.id, .{}, &output.writer);
        try output.writer.writeAll(",\"target\":");
        try std.json.Stringify.value(pending.target, .{}, &output.writer);
        try output.writer.writeAll(",\"body\":");
        try std.json.Stringify.value(pending.body, .{}, &output.writer);
        try output.writer.writeAll("}}");
        return output.toOwnedSlice();
    }

    pub fn completePayload(manager: *Manager, document: []const u8) ![]u8 {
        if (manager.mode != .worker) return error.ModelRelayUnavailable;
        var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, document, .{}) catch return error.InvalidModelRelayResponse;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidModelRelayResponse;
        const id = stringField(parsed.value.object, "id") orelse return error.InvalidModelRelayResponse;
        const body = rawStringField(parsed.value.object, "body") orelse return error.InvalidModelRelayResponse;
        const status = statusField(parsed.value.object.get("status")) orelse return error.InvalidModelRelayResponse;
        const content_type = stringField(parsed.value.object, "contentType") orelse "application/json";
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        const pending = manager.pending.get(id) orelse return error.ModelRelayRequestNotFound;
        if (pending.response_body != null) return error.ModelRelayResponseAlreadySet;
        pending.response_body = try manager.allocator.dupe(u8, body);
        errdefer {
            manager.allocator.free(pending.response_body.?);
            pending.response_body = null;
        }
        pending.response_content_type = try manager.allocator.dupe(u8, content_type);
        pending.response_status = status;
        pending.completed.set(manager.io);
        return manager.allocator.dupe(u8, "{\"success\":true}");
    }
};

const ClientLink = struct {
    allocator: std.mem.Allocator,
    io: Io,
    client: http.Client,
    worker_origin: []u8,
    worker_api_key: []u8,
    head_origin: []u8,
    head_api_key: ?[]u8,

    fn deinit(link: *ClientLink) void {
        link.client.deinit();
        link.allocator.free(link.worker_origin);
        link.allocator.free(link.worker_api_key);
        link.allocator.free(link.head_origin);
        if (link.head_api_key) |value| link.allocator.free(value);
        link.allocator.destroy(link);
    }
};

pub fn startClient(tasks: *Io.Group, allocator: std.mem.Allocator, io: Io, worker_origin: []const u8, worker_api_key: []const u8, head_origin: []const u8, head_api_key: ?[]const u8) !void {
    const link = try allocator.create(ClientLink);
    errdefer allocator.destroy(link);
    link.* = .{
        .allocator = allocator,
        .io = io,
        .client = .{ .allocator = allocator, .io = io },
        .worker_origin = try allocator.dupe(u8, std.mem.trimEnd(u8, worker_origin, "/")),
        .worker_api_key = try allocator.dupe(u8, worker_api_key),
        .head_origin = try allocator.dupe(u8, std.mem.trimEnd(u8, head_origin, "/")),
        .head_api_key = if (head_api_key) |value| try allocator.dupe(u8, value) else null,
    };
    errdefer link.deinit();
    try tasks.concurrent(io, runClient, .{link});
}

fn runClient(link: *ClientLink) void {
    defer link.deinit();
    runClientLoop(link) catch {};
}

fn runClientLoop(link: *ClientLink) !void {
    var consecutive_failures: u8 = 0;
    while (consecutive_failures < 30) {
        const poll_url = try std.fmt.allocPrint(link.allocator, "{s}/internal/head-link/v1/poll", .{link.worker_origin});
        defer link.allocator.free(poll_url);
        const polled = fetchBuffered(link.allocator, &link.client, poll_url, .POST, "{}", link.worker_api_key) catch {
            consecutive_failures += 1;
            try link.io.sleep(.fromSeconds(1), .awake);
            continue;
        };
        defer link.allocator.free(polled.body);
        if (polled.status.class() != .success) {
            consecutive_failures += 1;
            try link.io.sleep(.fromSeconds(1), .awake);
            continue;
        }
        consecutive_failures = 0;
        var request = parseWorkerRequest(link.allocator, polled.body) catch continue;
        defer request.deinit();
        const public_target = publicTarget(request.target) orelse {
            try completeError(link, request.id, .bad_request, "Model relay target is not allowed");
            continue;
        };
        const head_url = try std.fmt.allocPrint(link.allocator, "{s}{s}", .{ link.head_origin, public_target });
        defer link.allocator.free(head_url);
        const response = fetchBufferedOptionalKey(link.allocator, &link.client, head_url, .POST, request.body, link.head_api_key) catch {
            try completeError(link, request.id, .bad_gateway, "Head model gateway is unavailable");
            continue;
        };
        defer link.allocator.free(response.body);
        const content_type = if (requestStreams(request.body)) "text/event-stream" else "application/json";
        try complete(link, request.id, response.status, content_type, response.body);
    }
}

const BufferedResponse = struct {
    status: http.Status,
    body: []u8,
};

fn fetchBuffered(allocator: std.mem.Allocator, client: *http.Client, url: []const u8, method: http.Method, payload: ?[]const u8, api_key: []const u8) !BufferedResponse {
    return fetchBufferedOptionalKey(allocator, client, url, method, payload, api_key);
}

fn fetchBufferedOptionalKey(allocator: std.mem.Allocator, client: *http.Client, url: []const u8, method: http.Method, payload: ?[]const u8, api_key: ?[]const u8) !BufferedResponse {
    const storage = try allocator.alloc(u8, max_body_bytes);
    defer allocator.free(storage);
    var output: Io.Writer = .fixed(storage);
    const authorization = if (api_key) |value| if (value.len > 0) try std.fmt.allocPrint(allocator, "Bearer {s}", .{value}) else null else null;
    defer if (authorization) |value| allocator.free(value);
    var headers: [2]http.Header = undefined;
    headers[0] = .{ .name = "Content-Type", .value = "application/json" };
    var header_count: usize = 1;
    if (authorization) |value| {
        headers[1] = .{ .name = "Authorization", .value = value };
        header_count += 1;
    }
    const response = try client.fetch(.{
        .location = .{ .url = url },
        .method = method,
        .payload = payload,
        .redirect_behavior = .unhandled,
        .keep_alive = false,
        .headers = .{ .accept_encoding = .omit },
        .extra_headers = headers[0..header_count],
        .response_writer = &output,
    });
    return .{ .status = response.status, .body = try allocator.dupe(u8, output.buffered()) };
}

fn complete(link: *ClientLink, id: []const u8, status: http.Status, content_type: []const u8, body: []const u8) !void {
    var document: Io.Writer.Allocating = .init(link.allocator);
    defer document.deinit();
    try document.writer.writeAll("{\"id\":");
    try std.json.Stringify.value(id, .{}, &document.writer);
    try document.writer.print(",\"status\":{d},\"contentType\":", .{@intFromEnum(status)});
    try std.json.Stringify.value(content_type, .{}, &document.writer);
    try document.writer.writeAll(",\"body\":");
    try std.json.Stringify.value(body, .{}, &document.writer);
    try document.writer.writeByte('}');
    const url = try std.fmt.allocPrint(link.allocator, "{s}/internal/head-link/v1/complete", .{link.worker_origin});
    defer link.allocator.free(url);
    const response = try fetchBuffered(link.allocator, &link.client, url, .POST, document.writer.buffered(), link.worker_api_key);
    defer link.allocator.free(response.body);
    if (response.status.class() != .success) return error.ModelRelayCompletionRejected;
}

fn completeError(link: *ClientLink, id: []const u8, status: http.Status, detail: []const u8) !void {
    var body: Io.Writer.Allocating = .init(link.allocator);
    defer body.deinit();
    try body.writer.writeAll("{\"detail\":");
    try std.json.Stringify.value(detail, .{}, &body.writer);
    try body.writer.writeByte('}');
    return complete(link, id, status, "application/json", body.writer.buffered());
}

const WorkerRequest = struct {
    allocator: std.mem.Allocator,
    id: []u8,
    target: []u8,
    body: []u8,

    fn deinit(request: *WorkerRequest) void {
        request.allocator.free(request.id);
        request.allocator.free(request.target);
        request.allocator.free(request.body);
        request.* = undefined;
    }
};

fn parseWorkerRequest(allocator: std.mem.Allocator, document: []const u8) !WorkerRequest {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidModelRelayRequest;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidModelRelayRequest;
    const value = parsed.value.object.get("request") orelse return error.InvalidModelRelayRequest;
    if (value != .object) return error.InvalidModelRelayRequest;
    const id = stringField(value.object, "id") orelse return error.InvalidModelRelayRequest;
    const target = stringField(value.object, "target") orelse return error.InvalidModelRelayRequest;
    const body = rawStringField(value.object, "body") orelse return error.InvalidModelRelayRequest;
    return .{
        .allocator = allocator,
        .id = try allocator.dupe(u8, id),
        .target = try allocator.dupe(u8, target),
        .body = try allocator.dupe(u8, body),
    };
}

fn nextPending(manager: *Manager) ?*Pending {
    var iterator = manager.pending.valueIterator();
    while (iterator.next()) |pending| if (!pending.*.dispatched) return pending.*;
    return null;
}

fn validRelayTarget(target: []const u8) bool {
    return publicTarget(target) != null;
}

fn publicTarget(target: []const u8) ?[]const u8 {
    if (std.mem.eql(u8, target, "/internal/head-link/v1/responses")) return "/v1/responses";
    if (std.mem.eql(u8, target, "/internal/head-link/v1/chat/completions")) return "/v1/chat/completions";
    if (std.mem.eql(u8, target, "/internal/head-link/v1/messages")) return "/v1/messages";
    return null;
}

fn requestStreams(document: []const u8) bool {
    var parsed = std.json.parseFromSlice(std.json.Value, std.heap.page_allocator, document, .{}) catch return false;
    defer parsed.deinit();
    if (parsed.value != .object) return false;
    const value = parsed.value.object.get("stream") orelse return false;
    return value == .bool and value.bool;
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len == 0 or trimmed.len > max_body_bytes) null else trimmed;
}

fn rawStringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string or value.string.len > max_body_bytes) return null;
    return value.string;
}

fn statusField(value: ?std.json.Value) ?u16 {
    const candidate = value orelse return null;
    if (candidate != .integer or candidate.integer < 100 or candidate.integer > 599) return null;
    return @intCast(candidate.integer);
}
