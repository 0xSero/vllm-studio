const std = @import("std");

const http = std.http;

const Forwarding = struct {
    extra_request_headers: []const http.Header = &.{},
    strip_credentials: bool = false,
    worker_id: ?[]const u8 = null,
    exact_upstream: bool = false,
};

pub const CapturedRequest = struct {
    allocator: std.mem.Allocator,
    target: []u8,
    headers: []http.Header,

    pub fn deinit(captured: *CapturedRequest) void {
        captured.allocator.free(captured.target);
        for (captured.headers) |header| {
            captured.allocator.free(header.name);
            captured.allocator.free(header.value);
        }
        captured.allocator.free(captured.headers);
        captured.* = undefined;
    }
};

pub fn captureRequest(allocator: std.mem.Allocator, request: *const http.Server.Request) !CapturedRequest {
    const target = try allocator.dupe(u8, request.head.target);
    errdefer allocator.free(target);
    var collected: [64]http.Header = undefined;
    const count = try collectRequestHeaders(request, &collected, .{});
    const headers = try allocator.alloc(http.Header, count);
    errdefer allocator.free(headers);
    var initialized: usize = 0;
    errdefer for (headers[0..initialized]) |header| {
        allocator.free(header.name);
        allocator.free(header.value);
    };
    for (collected[0..count], headers) |header, *owned| {
        owned.* = try cloneHeader(allocator, header);
        initialized += 1;
    }
    return .{ .allocator = allocator, .target = target, .headers = headers };
}

fn cloneHeader(allocator: std.mem.Allocator, header: http.Header) !http.Header {
    const name = try allocator.dupe(u8, header.name);
    errdefer allocator.free(name);
    return .{ .name = name, .value = try allocator.dupe(u8, header.value) };
}

pub const ResponseCommitment = enum {
    pending,
    committed,

    pub fn canRetry(commitment: ResponseCommitment) bool {
        return commitment == .pending;
    }

    pub fn commit(commitment: *ResponseCommitment) void {
        commitment.* = .committed;
    }
};

const RequestBodyState = enum {
    untouched,
    streaming,
    complete,
};

pub fn serve(client: *http.Client, primary: []const u8, fallback: ?[]const u8, request: *http.Server.Request) !void {
    var commitment: ResponseCommitment = .pending;
    var request_body_state: RequestBodyState = .untouched;
    proxyAttempt(client, primary, request, &commitment, &request_body_state, .{}, null, null) catch |primary_failure| {
        if (request_body_state == .streaming) return primary_failure;
        if (!request.head.method.requestHasBody() and fallback != null and commitment.canRetry()) {
            proxyAttempt(client, fallback.?, request, &commitment, &request_body_state, .{}, null, null) catch |fallback_failure| {
                if (!commitment.canRetry()) return fallback_failure;
                try respondBadGateway(request);
            };
            return;
        }
        if (!commitment.canRetry()) return primary_failure;
        try respondBadGateway(request);
    };
}

pub fn serveWorker(allocator: std.mem.Allocator, client: *http.Client, upstream: []const u8, api_key: []const u8, worker_id: []const u8, request: *http.Server.Request) !void {
    const authorization = if (api_key.len > 0) try std.fmt.allocPrint(allocator, "Bearer {s}", .{api_key}) else null;
    defer if (authorization) |value| allocator.free(value);
    var headers: [2]http.Header = undefined;
    headers[0] = .{ .name = "X-Local-Studio-Federation-Hop", .value = "head" };
    var header_count: usize = 1;
    if (authorization) |value| {
        headers[1] = .{ .name = "Authorization", .value = value };
        header_count += 1;
    }
    var commitment: ResponseCommitment = .pending;
    var request_body_state: RequestBodyState = .untouched;
    proxyAttempt(client, upstream, request, &commitment, &request_body_state, .{
        .extra_request_headers = headers[0..header_count],
        .strip_credentials = true,
        .worker_id = worker_id,
    }, null, null) catch |failure| {
        if (!commitment.canRetry()) return failure;
        try respondBadGateway(request);
    };
}

pub fn serveWorkerBuffered(allocator: std.mem.Allocator, client: *http.Client, upstream: []const u8, api_key: []const u8, worker_id: []const u8, payload: []const u8, captured: *const CapturedRequest, request: *http.Server.Request) !void {
    const authorization = if (api_key.len > 0) try std.fmt.allocPrint(allocator, "Bearer {s}", .{api_key}) else null;
    defer if (authorization) |value| allocator.free(value);
    var headers: [2]http.Header = undefined;
    headers[0] = .{ .name = "X-Local-Studio-Federation-Hop", .value = "head" };
    var header_count: usize = 1;
    if (authorization) |value| {
        headers[1] = .{ .name = "Authorization", .value = value };
        header_count += 1;
    }
    var commitment: ResponseCommitment = .pending;
    var request_body_state: RequestBodyState = .untouched;
    proxyAttempt(client, upstream, request, &commitment, &request_body_state, .{
        .extra_request_headers = headers[0..header_count],
        .strip_credentials = true,
        .worker_id = worker_id,
    }, payload, captured) catch {
        return if (commitment.canRetry()) error.WorkerUnavailableBeforeCommitment else error.WorkerStreamFailedAfterCommitment;
    };
}

pub fn serveLocalBuffered(client: *http.Client, upstream: []const u8, payload: []const u8, captured: *const CapturedRequest, request: *http.Server.Request, accept: ?[]const u8) !void {
    var commitment: ResponseCommitment = .pending;
    var request_body_state: RequestBodyState = .untouched;
    var headers: [2]http.Header = undefined;
    headers[0] = .{ .name = "Content-Type", .value = "application/json" };
    var header_count: usize = 1;
    if (accept) |value| {
        headers[1] = .{ .name = "Accept", .value = value };
        header_count += 1;
    }
    proxyAttempt(client, upstream, request, &commitment, &request_body_state, .{
        .extra_request_headers = headers[0..header_count],
        .strip_credentials = true,
    }, payload, captured) catch |failure| {
        if (!commitment.canRetry()) return failure;
        try respondBadGateway(request);
    };
}

pub fn serveProviderBuffered(allocator: std.mem.Allocator, client: *http.Client, upstream: []const u8, api_key: []const u8, payload: []const u8, captured: *const CapturedRequest, request: *http.Server.Request, accept: ?[]const u8, include_x_api_key: bool) !void {
    const authorization = try std.fmt.allocPrint(allocator, "Bearer {s}", .{api_key});
    defer allocator.free(authorization);
    var headers: [4]http.Header = undefined;
    headers[0] = .{ .name = "Content-Type", .value = "application/json" };
    headers[1] = .{ .name = "Authorization", .value = authorization };
    var header_count: usize = 2;
    if (include_x_api_key) {
        headers[header_count] = .{ .name = "X-Api-Key", .value = api_key };
        header_count += 1;
    }
    if (accept) |value| {
        headers[header_count] = .{ .name = "Accept", .value = value };
        header_count += 1;
    }
    const target = try providerTarget(allocator, upstream, captured.target);
    defer allocator.free(target);
    var commitment: ResponseCommitment = .pending;
    var request_body_state: RequestBodyState = .untouched;
    proxyAttempt(client, target, request, &commitment, &request_body_state, .{
        .extra_request_headers = headers[0..header_count],
        .strip_credentials = true,
        .exact_upstream = true,
    }, payload, captured) catch |failure| {
        if (!commitment.canRetry()) return failure;
        try respondBadGateway(request);
    };
}

fn proxyAttempt(client: *http.Client, upstream: []const u8, request: *http.Server.Request, commitment: *ResponseCommitment, request_body_state: *RequestBodyState, forwarding: Forwarding, buffered_body: ?[]const u8, captured: ?*const CapturedRequest) !void {
    const uri = if (forwarding.exact_upstream) try std.Uri.parse(upstream) else try uriForTarget(upstream, if (captured) |metadata| metadata.target else request.head.target);
    var request_headers: [64]http.Header = undefined;
    const request_header_count = if (captured) |metadata|
        try collectCapturedHeaders(metadata, &request_headers, forwarding)
    else
        try collectRequestHeaders(request, &request_headers, forwarding);
    var upstream_request = try client.request(request.head.method, uri, .{
        .redirect_behavior = .unhandled,
        .keep_alive = false,
        .headers = .{
            .authorization = .omit,
            .user_agent = .omit,
            .connection = .omit,
            .accept_encoding = .omit,
            .content_type = .omit,
        },
        .extra_headers = request_headers[0..request_header_count],
    });
    defer upstream_request.deinit();

    if (request.head.method.requestHasBody()) {
        upstream_request.transfer_encoding = if (buffered_body) |body| .{ .content_length = body.len } else if (request.head.content_length) |length| .{ .content_length = length } else .chunked;
        var request_write_buffer: [16 * 1024]u8 = undefined;
        var upstream_body = try upstream_request.sendBody(&request_write_buffer);
        if (buffered_body) |body| {
            try upstream_body.writer.writeAll(body);
        } else {
            var request_read_buffer: [16 * 1024]u8 = undefined;
            request_body_state.* = .streaming;
            const downstream_body = try request.readerExpectContinue(&request_read_buffer);
            _ = try downstream_body.streamRemaining(&upstream_body.writer);
        }
        try upstream_body.end();
        request_body_state.* = .complete;
    } else {
        try upstream_request.sendBodiless();
        request_body_state.* = .complete;
    }

    var redirect_buffer: [8 * 1024]u8 = undefined;
    var upstream_response = try upstream_request.receiveHead(&redirect_buffer);
    var response_headers: [64]http.Header = undefined;
    const response_header_count = try collectResponseHeaders(upstream_response.head, &response_headers, forwarding.worker_id);

    var response_write_buffer: [16 * 1024]u8 = undefined;
    commitment.commit();
    var downstream_response = try request.respondStreaming(&response_write_buffer, .{
        .content_length = upstream_response.head.content_length,
        .respond_options = .{
            .status = upstream_response.head.status,
            .keep_alive = false,
            .extra_headers = response_headers[0..response_header_count],
        },
    });
    try downstream_response.flush();
    var response_read_buffer: [16 * 1024]u8 = undefined;
    const upstream_body = upstream_response.reader(&response_read_buffer);
    var bytes_forwarded: u64 = 0;
    var response_chunk: [16 * 1024]u8 = undefined;
    while (true) {
        var response_buffers = [_][]u8{response_chunk[0..]};
        const count = upstream_body.readVec(&response_buffers) catch |err| switch (err) {
            error.EndOfStream => break,
            error.ReadFailed => return error.ReadFailed,
        };
        if (count == 0) continue;
        try downstream_response.writer.writeAll(response_chunk[0..count]);
        try downstream_response.writer.flush();
        try downstream_response.flush();
        bytes_forwarded += count;
    }
    if (upstream_response.head.content_length) |content_length| {
        if (bytes_forwarded != content_length) return error.UpstreamBodyTruncated;
    }
    try downstream_response.end();
}

fn providerTarget(allocator: std.mem.Allocator, upstream: []const u8, target: []const u8) ![]u8 {
    const base = std.mem.trimEnd(u8, std.mem.trim(u8, upstream, " \t\r\n"), "/");
    if (base.len == 0) return error.InvalidProviderOrigin;
    return std.fmt.allocPrint(allocator, "{s}/{s}", .{ base, std.mem.trimStart(u8, target, "/") });
}

fn collectCapturedHeaders(captured: *const CapturedRequest, output: *[64]http.Header, forwarding: Forwarding) !usize {
    var count: usize = 0;
    for (captured.headers) |header| {
        if (std.ascii.eqlIgnoreCase(header.name, "x-local-studio-model-route")) continue;
        if (forwarding.strip_credentials and (std.ascii.eqlIgnoreCase(header.name, "authorization") or std.ascii.eqlIgnoreCase(header.name, "x-api-key"))) continue;
        if (replacedByExtraHeader(header.name, forwarding.extra_request_headers)) continue;
        if (count == output.len) return error.TooManyForwardedHeaders;
        output[count] = header;
        count += 1;
    }
    for (forwarding.extra_request_headers) |header| {
        if (count == output.len) return error.TooManyForwardedHeaders;
        output[count] = header;
        count += 1;
    }
    return count;
}

fn uriForTarget(upstream: []const u8, target: []const u8) !std.Uri {
    var uri = try std.Uri.parse(upstream);
    const query_start = std.mem.findScalar(u8, target, '?');
    const path_end = query_start orelse target.len;
    uri.path = .{ .percent_encoded = target[0..path_end] };
    uri.query = if (query_start) |index| .{ .percent_encoded = target[index + 1 ..] } else null;
    uri.fragment = null;
    return uri;
}

fn collectRequestHeaders(request: *const http.Server.Request, output: *[64]http.Header, forwarding: Forwarding) !usize {
    var count: usize = 0;
    var iterator = request.iterateHeaders();
    while (iterator.next()) |header| {
        if (isFramingOrHopByHop(header.name) or connectionNominatesRequestHeader(request, header.name)) continue;
        if (forwarding.strip_credentials and (std.ascii.eqlIgnoreCase(header.name, "authorization") or std.ascii.eqlIgnoreCase(header.name, "x-api-key"))) continue;
        if (replacedByExtraHeader(header.name, forwarding.extra_request_headers)) continue;
        if (count == output.len) return error.TooManyForwardedHeaders;
        output[count] = header;
        count += 1;
    }
    for (forwarding.extra_request_headers) |header| {
        if (count == output.len) return error.TooManyForwardedHeaders;
        output[count] = header;
        count += 1;
    }
    return count;
}

fn collectResponseHeaders(head: http.Client.Response.Head, output: *[64]http.Header, worker_id: ?[]const u8) !usize {
    var count: usize = 0;
    var iterator = head.iterateHeaders();
    while (iterator.next()) |header| {
        if (isFramingOrHopByHop(header.name) or connectionNominatesResponseHeader(head, header.name)) continue;
        if (worker_id != null and std.ascii.eqlIgnoreCase(header.name, "x-local-studio-worker-id")) continue;
        if (count == output.len) return error.TooManyForwardedHeaders;
        output[count] = header;
        count += 1;
    }
    if (worker_id) |value| {
        if (count == output.len) return error.TooManyForwardedHeaders;
        output[count] = .{ .name = "X-Local-Studio-Worker-Id", .value = value };
        count += 1;
    }
    return count;
}

fn replacedByExtraHeader(name: []const u8, extra_headers: []const http.Header) bool {
    for (extra_headers) |header| if (std.ascii.eqlIgnoreCase(name, header.name)) return true;
    return false;
}

fn connectionNominatesRequestHeader(request: *const http.Server.Request, name: []const u8) bool {
    var iterator = request.iterateHeaders();
    while (iterator.next()) |header| {
        if (std.ascii.eqlIgnoreCase(header.name, "connection") and containsHeaderToken(header.value, name)) return true;
    }
    return false;
}

fn connectionNominatesResponseHeader(head: http.Client.Response.Head, name: []const u8) bool {
    var iterator = head.iterateHeaders();
    while (iterator.next()) |header| {
        if (std.ascii.eqlIgnoreCase(header.name, "connection") and containsHeaderToken(header.value, name)) return true;
    }
    return false;
}

fn containsHeaderToken(value: []const u8, expected: []const u8) bool {
    var tokens = std.mem.splitScalar(u8, value, ',');
    while (tokens.next()) |token| {
        if (std.ascii.eqlIgnoreCase(std.mem.trim(u8, token, " \t"), expected)) return true;
    }
    return false;
}

fn isFramingOrHopByHop(name: []const u8) bool {
    const names = [_][]const u8{
        "connection",
        "content-length",
        "expect",
        "host",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    };
    for (names) |excluded| {
        if (std.ascii.eqlIgnoreCase(name, excluded)) return true;
    }
    return false;
}

fn respondBadGateway(request: *http.Server.Request) !void {
    try request.respond("{\"detail\":\"Upstream request failed\"}", .{
        .status = .bad_gateway,
        .keep_alive = false,
        .extra_headers = &.{.{ .name = "Content-Type", .value = "application/json" }},
    });
}
