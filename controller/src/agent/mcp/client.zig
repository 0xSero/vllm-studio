const std = @import("std");
const connector_runtime = @import("../connectors/runtime.zig");
const oauth_connector_store = @import("../connectors/oauth_store.zig");
const account_store = @import("../../accounts/store.zig");

const Io = std.Io;
const max_frame_bytes = 4 * 1024 * 1024;
const http = std.http;
const modern_protocol = "2026-07-28";
const legacy_protocol = "2025-06-18";
const request_timeout = Io.Duration.fromSeconds(30);

const Era = enum {
    modern,
    legacy,
};

const ProtocolPreference = enum {
    modern,
    modern_first,
    legacy,
};

pub const Operation = union(enum) {
    tools,
    call: struct {
        name: []const u8,
        arguments: std.json.Value,
    },
};

pub const StdioSession = struct {
    allocator: std.mem.Allocator,
    io: Io,
    child: std.process.Child,
    connection: Connection,
    era: Era,
    next_request_id: i64 = 10,
    mutex: Io.Mutex = .init,

    pub fn open(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, data_dir: []const u8, connector: std.json.ObjectMap) !*StdioSession {
        var launch_arena = std.heap.ArenaAllocator.init(allocator);
        defer launch_arena.deinit();
        const launch = try connector_runtime.resolve(launch_arena.allocator(), io, environment, connector);
        var child_environment = try minimalEnvironment(allocator, environment, connector);
        defer child_environment.deinit();
        try child_environment.put("LOCAL_STUDIO_DATA_DIR", data_dir);
        try connector_runtime.addEnvironment(allocator, io, &child_environment, data_dir, connector, launch.kind);
        try oauth_connector_store.injectEnvironment(allocator, io, data_dir, connector, &child_environment);
        try account_store.injectEnvironment(allocator, io, data_dir, connector, environment, &child_environment);
        const session = try allocator.create(StdioSession);
        errdefer allocator.destroy(session);
        session.* = .{
            .allocator = allocator,
            .io = io,
            .child = try std.process.spawn(io, .{
                .argv = launch.argv,
                .environ_map = &child_environment,
                .cwd = if (launch.cwd) |value| .{ .path = value } else .inherit,
                .stdin = .pipe,
                .stdout = .pipe,
                .stderr = .ignore,
                .pgid = 0,
            }),
            .connection = undefined,
            .era = undefined,
        };
        errdefer session.child.kill(io);
        session.connection = .{ .allocator = allocator, .io = io, .child = &session.child };
        errdefer session.connection.deinit();
        session.era = try discoverStdio(allocator, &session.connection, protocolPreference(connector));
        return session;
    }

    pub fn close(session: *StdioSession) void {
        session.connection.deinit();
        session.child.kill(session.io);
        const allocator = session.allocator;
        session.* = undefined;
        allocator.destroy(session);
    }

    pub fn execute(session: *StdioSession, operation: Operation) ![]u8 {
        try session.mutex.lock(session.io);
        defer session.mutex.unlock(session.io);
        const request_id = session.next_request_id;
        session.next_request_id += 1;
        const document = try operationDocument(session.allocator, session.era, request_id, operation);
        defer session.allocator.free(document);
        return session.connection.request(request_id, document);
    }
};

pub fn executeStdio(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, data_dir: []const u8, connector: std.json.ObjectMap, operation: Operation) ![]u8 {
    const session = try StdioSession.open(allocator, io, environment, data_dir, connector);
    defer session.close();
    return session.execute(operation);
}

pub fn executeHttp(allocator: std.mem.Allocator, io: Io, client: *http.Client, connector: std.json.ObjectMap, operation: Operation) ![]u8 {
    const url = stringField(connector, "url") orelse return error.ConnectorUrlRequired;
    var discovery = try discoverHttp(allocator, io, client, connector, url, protocolPreference(connector));
    defer discovery.deinit();
    const request_id: i64 = if (discovery.era == .modern) 2 else 3;
    const document = try operationDocument(allocator, discovery.era, request_id, operation);
    defer allocator.free(document);
    const method: []const u8 = switch (operation) {
        .tools => "tools/list",
        .call => "tools/call",
    };
    const name: ?[]const u8 = switch (operation) {
        .tools => null,
        .call => |call| call.name,
    };
    var response = try postHttp(allocator, io, client, connector, url, discovery.era, discovery.session_id, method, name, document);
    defer response.deinit();
    try requireHttpSuccess(response.status);
    return rpcResult(allocator, response.body, request_id);
}

const Discovery = struct {
    allocator: std.mem.Allocator,
    era: Era,
    session_id: ?[]u8 = null,

    fn deinit(discovery: *Discovery) void {
        if (discovery.session_id) |value| discovery.allocator.free(value);
        discovery.* = undefined;
    }
};

fn discoverStdio(allocator: std.mem.Allocator, connection: *Connection, preference: ProtocolPreference) !Era {
    if (preference == .legacy) return initializeLegacyStdio(allocator, connection);
    const discovery_document = try modernDocument(allocator, 1, "server/discover", null, null);
    defer allocator.free(discovery_document);
    const discovered = connection.request(1, discovery_document) catch |failure| switch (failure) {
        error.ModernMcpUnsupported => if (preference == .modern_first) return initializeLegacyStdio(allocator, connection) else return failure,
        else => return failure,
    };
    defer allocator.free(discovered);
    if (!try supportsModern(allocator, discovered)) {
        if (preference == .modern_first) return initializeLegacyStdio(allocator, connection);
        return error.ModernMcpUnsupported;
    }
    return .modern;
}

fn initializeLegacyStdio(allocator: std.mem.Allocator, connection: *Connection) !Era {
    const initialized = try connection.request(
        2,
        "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},\"clientInfo\":{\"name\":\"local-studio\",\"version\":\"2.1.0\"}}}",
    );
    allocator.free(initialized);
    try connection.send("{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}");
    return .legacy;
}

fn discoverHttp(allocator: std.mem.Allocator, io: Io, client: *http.Client, connector: std.json.ObjectMap, url: []const u8, preference: ProtocolPreference) !Discovery {
    if (preference == .legacy) return initializeLegacyHttp(allocator, io, client, connector, url);
    const discovery_document = try modernDocument(allocator, 1, "server/discover", null, null);
    defer allocator.free(discovery_document);
    var response = try postHttp(allocator, io, client, connector, url, .modern, null, "server/discover", null, discovery_document);
    defer response.deinit();
    if (response.status >= 200 and response.status < 300) {
        const discovered = rpcResult(allocator, response.body, 1) catch |failure| switch (failure) {
            error.ModernMcpUnsupported => if (preference == .modern_first) return initializeLegacyHttp(allocator, io, client, connector, url) else return failure,
            else => return failure,
        };
        defer allocator.free(discovered);
        if (try supportsModern(allocator, discovered)) return .{ .allocator = allocator, .era = .modern };
        if (preference == .modern_first) return initializeLegacyHttp(allocator, io, client, connector, url);
        return error.ModernMcpUnsupported;
    }
    if (response.status == 400 and modernRejected(allocator, response.body, 1)) {
        if (preference == .modern_first) return initializeLegacyHttp(allocator, io, client, connector, url);
        return error.ModernMcpUnsupported;
    }
    return error.McpHttpRejected;
}

fn initializeLegacyHttp(allocator: std.mem.Allocator, io: Io, client: *http.Client, connector: std.json.ObjectMap, url: []const u8) !Discovery {
    var initialized = try postHttp(
        allocator,
        io,
        client,
        connector,
        url,
        .legacy,
        null,
        "initialize",
        null,
        "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},\"clientInfo\":{\"name\":\"local-studio\",\"version\":\"2.1.0\"}}}",
    );
    defer initialized.deinit();
    try requireHttpSuccess(initialized.status);
    const initialized_result = try rpcResult(allocator, initialized.body, 2);
    allocator.free(initialized_result);
    var notification = try postHttp(allocator, io, client, connector, url, .legacy, initialized.session_id, "notifications/initialized", null, "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}");
    defer notification.deinit();
    try requireHttpSuccess(notification.status);
    return .{
        .allocator = allocator,
        .era = .legacy,
        .session_id = if (initialized.session_id) |value| try allocator.dupe(u8, value) else null,
    };
}

fn operationDocument(allocator: std.mem.Allocator, era: Era, id: i64, operation: Operation) ![]u8 {
    if (era == .modern) return switch (operation) {
        .tools => modernDocument(allocator, id, "tools/list", null, null),
        .call => |call| modernDocument(allocator, id, "tools/call", call.name, call.arguments),
    };
    var request: Io.Writer.Allocating = .init(allocator);
    errdefer request.deinit();
    switch (operation) {
        .tools => try request.writer.print("{{\"jsonrpc\":\"2.0\",\"id\":{d},\"method\":\"tools/list\",\"params\":{{}}}}", .{id}),
        .call => |call| {
            try request.writer.print("{{\"jsonrpc\":\"2.0\",\"id\":{d},\"method\":\"tools/call\",\"params\":{{\"name\":", .{id});
            try std.json.Stringify.value(call.name, .{}, &request.writer);
            try request.writer.writeAll(",\"arguments\":");
            try std.json.Stringify.value(call.arguments, .{}, &request.writer);
            try request.writer.writeAll("}}");
        },
    }
    return request.toOwnedSlice();
}

fn modernDocument(allocator: std.mem.Allocator, id: i64, method: []const u8, name: ?[]const u8, arguments: ?std.json.Value) ![]u8 {
    var request: Io.Writer.Allocating = .init(allocator);
    errdefer request.deinit();
    try request.writer.print("{{\"jsonrpc\":\"2.0\",\"id\":{d},\"method\":", .{id});
    try std.json.Stringify.value(method, .{}, &request.writer);
    try request.writer.writeAll(",\"params\":{");
    if (name) |value| {
        const argument_value = arguments orelse return error.InvalidMcpRequest;
        try request.writer.writeAll("\"name\":");
        try std.json.Stringify.value(value, .{}, &request.writer);
        try request.writer.writeAll(",\"arguments\":");
        try std.json.Stringify.value(argument_value, .{}, &request.writer);
        try request.writer.writeByte(',');
    }
    try request.writer.writeAll("\"_meta\":{\"io.modelcontextprotocol/protocolVersion\":\"2026-07-28\",\"io.modelcontextprotocol/clientInfo\":{\"name\":\"local-studio\",\"version\":\"2.1.0\"},\"io.modelcontextprotocol/clientCapabilities\":{}}}}");
    return request.toOwnedSlice();
}

fn supportsModern(allocator: std.mem.Allocator, document: []const u8) !bool {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidMcpResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidMcpResponse;
    const versions = parsed.value.object.get("supportedVersions") orelse return error.InvalidMcpResponse;
    if (versions != .array) return error.InvalidMcpResponse;
    for (versions.array.items) |value| if (value == .string and std.mem.eql(u8, value.string, modern_protocol)) return true;
    return false;
}

fn modernRejected(allocator: std.mem.Allocator, body: []const u8, id: i64) bool {
    const document = rpcDocument(allocator, body, id) catch return false;
    defer allocator.free(document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return false;
    defer parsed.deinit();
    if (parsed.value != .object or !matchesId(parsed.value.object, id)) return false;
    const code = mcpErrorCode(parsed.value.object) orelse return false;
    return code == -32601 or code == -32022;
}

const HttpResponse = struct {
    allocator: std.mem.Allocator,
    body: []u8,
    session_id: ?[]u8,
    status: u16,

    fn deinit(response: *HttpResponse) void {
        response.allocator.free(response.body);
        if (response.session_id) |value| response.allocator.free(value);
        response.* = undefined;
    }
};

fn postHttp(allocator: std.mem.Allocator, io: Io, client: *http.Client, connector: std.json.ObjectMap, url: []const u8, era: Era, session_id: ?[]const u8, method: []const u8, name: ?[]const u8, document: []const u8) !HttpResponse {
    const Selection = union(enum) { request: anyerror!HttpResponse, timer: Io.Cancelable!void };
    var selections: [2]Selection = undefined;
    var select = Io.Select(Selection).init(io, &selections);
    try select.concurrent(.request, postHttpRequest, .{ allocator, client, connector, url, era, session_id, method, name, document });
    select.concurrent(.timer, waitForTimeout, .{io}) catch {
        while (select.cancel()) |pending| deinitPost(pending);
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
            while (select.cancel()) |pending| deinitPost(pending);
            return error.McpRequestTimeout;
        },
    }
}

fn postHttpRequest(allocator: std.mem.Allocator, client: *http.Client, connector: std.json.ObjectMap, url: []const u8, era: Era, session_id: ?[]const u8, method: []const u8, name: ?[]const u8, document: []const u8) !HttpResponse {
    if (era == .modern) return postModernHttp(allocator, client, connector, url, method, name, document);
    if (document.len > max_frame_bytes) return error.McpFrameTooLarge;
    const uri = std.Uri.parse(url) catch return error.InvalidConnectorUrl;
    var headers: [260]http.Header = undefined;
    var count: usize = 0;
    headers[count] = .{ .name = "Content-Type", .value = "application/json" };
    count += 1;
    headers[count] = .{ .name = "Accept", .value = "application/json, text/event-stream" };
    count += 1;
    headers[count] = .{ .name = "MCP-Protocol-Version", .value = if (era == .modern) modern_protocol else legacy_protocol };
    count += 1;
    headers[count] = .{ .name = "Mcp-Method", .value = method };
    count += 1;
    if (name) |value| {
        headers[count] = .{ .name = "Mcp-Name", .value = value };
        count += 1;
    }
    if (session_id) |value| {
        headers[count] = .{ .name = "Mcp-Session-Id", .value = value };
        count += 1;
    }
    if (connector.get("headers")) |configured| {
        if (configured != .object) return error.InvalidConnectorRecord;
        var iterator = configured.object.iterator();
        while (iterator.next()) |entry| {
            if (entry.value_ptr.* != .string) return error.InvalidConnectorRecord;
            if (reservedHeader(entry.key_ptr.*)) continue;
            if (count == headers.len) return error.TooManyConnectorHeaders;
            headers[count] = .{ .name = entry.key_ptr.*, .value = entry.value_ptr.string };
            count += 1;
        }
    }
    var request = try client.request(.POST, uri, .{
        .redirect_behavior = .unhandled,
        .keep_alive = false,
        .headers = .{ .authorization = .omit, .user_agent = .omit, .connection = .omit, .accept_encoding = .omit, .content_type = .omit },
        .extra_headers = headers[0..count],
    });
    defer request.deinit();
    request.transfer_encoding = .{ .content_length = document.len };
    var write_buffer: [16 * 1024]u8 = undefined;
    var request_body = try request.sendBody(&write_buffer);
    try request_body.writer.writeAll(document);
    try request_body.end();
    var redirect_buffer: [16 * 1024]u8 = undefined;
    var response = try request.receiveHead(&redirect_buffer);
    const code = @intFromEnum(response.head.status);
    const owned_session_id = try responseSessionId(allocator, response.head);
    errdefer if (owned_session_id) |value| allocator.free(value);
    const storage = try allocator.alloc(u8, max_frame_bytes);
    defer allocator.free(storage);
    var output: Io.Writer = .fixed(storage);
    var read_buffer: [16 * 1024]u8 = undefined;
    const reader = response.reader(&read_buffer);
    _ = reader.streamRemaining(&output) catch return error.McpFrameTooLarge;
    return .{ .allocator = allocator, .body = try allocator.dupe(u8, output.buffered()), .session_id = owned_session_id, .status = code };
}

fn postModernHttp(allocator: std.mem.Allocator, client: *http.Client, connector: std.json.ObjectMap, url: []const u8, method: []const u8, name: ?[]const u8, document: []const u8) !HttpResponse {
    if (document.len > max_frame_bytes) return error.McpFrameTooLarge;
    var headers: [260]http.Header = undefined;
    var count: usize = 0;
    headers[count] = .{ .name = "Content-Type", .value = "application/json" };
    count += 1;
    headers[count] = .{ .name = "Accept", .value = "application/json, text/event-stream" };
    count += 1;
    headers[count] = .{ .name = "MCP-Protocol-Version", .value = modern_protocol };
    count += 1;
    headers[count] = .{ .name = "Mcp-Method", .value = method };
    count += 1;
    if (name) |value| {
        headers[count] = .{ .name = "Mcp-Name", .value = value };
        count += 1;
    }
    if (connector.get("headers")) |configured| {
        if (configured != .object) return error.InvalidConnectorRecord;
        var iterator = configured.object.iterator();
        while (iterator.next()) |entry| {
            if (entry.value_ptr.* != .string) return error.InvalidConnectorRecord;
            if (reservedHeader(entry.key_ptr.*)) continue;
            if (count == headers.len) return error.TooManyConnectorHeaders;
            headers[count] = .{ .name = entry.key_ptr.*, .value = entry.value_ptr.string };
            count += 1;
        }
    }
    const storage = try allocator.alloc(u8, max_frame_bytes);
    defer allocator.free(storage);
    var output: Io.Writer = .fixed(storage);
    const response = try client.fetch(.{
        .location = .{ .url = url },
        .method = .POST,
        .payload = document,
        .redirect_behavior = .unhandled,
        .keep_alive = false,
        .headers = .{ .authorization = .omit, .user_agent = .omit, .connection = .omit, .accept_encoding = .omit, .content_type = .omit },
        .extra_headers = headers[0..count],
        .response_writer = &output,
    });
    return .{ .allocator = allocator, .body = try allocator.dupe(u8, output.buffered()), .session_id = null, .status = @intFromEnum(response.status) };
}

fn waitForTimeout(io: Io) Io.Cancelable!void {
    return io.sleep(request_timeout, .awake);
}

fn deinitPost(selection: anytype) void {
    switch (selection) {
        .request => |result| if (result) |response_value| {
            var response = response_value;
            response.deinit();
        } else |_| {},
        .timer => {},
    }
}

fn requireHttpSuccess(status: u16) !void {
    if (status < 200 or status >= 300) return error.McpHttpRejected;
}

fn responseSessionId(allocator: std.mem.Allocator, head: http.Client.Response.Head) !?[]u8 {
    var iterator = head.iterateHeaders();
    while (iterator.next()) |header| {
        if (!std.ascii.eqlIgnoreCase(header.name, "mcp-session-id")) continue;
        const value = std.mem.trim(u8, header.value, " \t\r\n");
        if (value.len == 0 or value.len > 1024) return error.InvalidMcpSessionId;
        return @as(?[]u8, try allocator.dupe(u8, value));
    }
    return null;
}

fn rpcResult(allocator: std.mem.Allocator, body: []const u8, id: i64) ![]u8 {
    const document = try rpcDocument(allocator, body, id);
    defer allocator.free(document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidMcpFrame;
    defer parsed.deinit();
    if (parsed.value != .object or !matchesId(parsed.value.object, id)) return error.InvalidMcpResponse;
    if (mcpErrorCode(parsed.value.object)) |code| {
        if (code == -32601 or code == -32022) return error.ModernMcpUnsupported;
        return error.McpRequestRejected;
    }
    const result = parsed.value.object.get("result") orelse return error.InvalidMcpResponse;
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(result, .{}, &output.writer);
    return output.toOwnedSlice();
}

fn rpcDocument(allocator: std.mem.Allocator, body: []const u8, id: i64) ![]u8 {
    const trimmed = std.mem.trim(u8, body, " \t\r\n");
    if (trimmed.len == 0) return error.InvalidMcpResponse;
    if (trimmed[0] == '{') return allocator.dupe(u8, trimmed);
    var lines = std.mem.splitScalar(u8, trimmed, '\n');
    while (lines.next()) |line_value| {
        const line = std.mem.trim(u8, line_value, " \t\r");
        if (!std.mem.startsWith(u8, line, "data:")) continue;
        const candidate = std.mem.trim(u8, line[5..], " \t");
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, candidate, .{}) catch continue;
        defer parsed.deinit();
        if (parsed.value == .object and matchesId(parsed.value.object, id)) return allocator.dupe(u8, candidate);
    }
    return error.InvalidMcpResponse;
}

fn reservedHeader(name: []const u8) bool {
    for ([_][]const u8{ "content-type", "accept", "content-length", "transfer-encoding", "connection", "host", "mcp-protocol-version", "mcp-session-id", "mcp-method", "mcp-name" }) |reserved| {
        if (std.ascii.eqlIgnoreCase(name, reserved)) return true;
    }
    return false;
}

fn minimalEnvironment(allocator: std.mem.Allocator, environment: *const std.process.Environ.Map, connector: std.json.ObjectMap) !std.process.Environ.Map {
    var result = std.process.Environ.Map.init(allocator);
    errdefer result.deinit();
    for ([_][]const u8{ "PATH", "HOME", "USER", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM", "SYSTEMROOT", "SystemRoot", "COMSPEC", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "TEMP", "TMP", "SSL_CERT_FILE", "SSL_CERT_DIR", "NIX_SSL_CERT_FILE", "CURL_CA_BUNDLE", "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY", "https_proxy", "http_proxy", "all_proxy", "no_proxy" }) |name| {
        if (environment.get(name)) |value| try result.put(name, value);
    }
    if (connector.get("env")) |values| {
        if (values != .object) return error.InvalidConnectorRecord;
        var iterator = values.object.iterator();
        while (iterator.next()) |entry| {
            if (entry.value_ptr.* != .string) return error.InvalidConnectorRecord;
            try result.put(entry.key_ptr.*, entry.value_ptr.string);
        }
    }
    return result;
}

const Connection = struct {
    allocator: std.mem.Allocator,
    io: Io,
    child: *std.process.Child,
    pending: std.ArrayList(u8) = .empty,

    fn deinit(connection: *Connection) void {
        connection.pending.deinit(connection.allocator);
    }

    fn send(connection: *Connection, document: []const u8) !void {
        if (document.len > max_frame_bytes) return error.McpFrameTooLarge;
        try connection.child.stdin.?.writeStreamingAll(connection.io, document);
        try connection.child.stdin.?.writeStreamingAll(connection.io, "\n");
    }

    fn request(connection: *Connection, id: i64, document: []const u8) ![]u8 {
        try connection.send(document);
        while (true) {
            const line = try connection.nextLine();
            defer connection.allocator.free(line);
            var parsed = std.json.parseFromSlice(std.json.Value, connection.allocator, line, .{}) catch return error.InvalidMcpFrame;
            defer parsed.deinit();
            if (parsed.value != .object or !matchesId(parsed.value.object, id)) continue;
            return rpcResult(connection.allocator, line, id);
        }
    }

    fn nextLine(connection: *Connection) ![]u8 {
        while (true) {
            if (std.mem.findScalar(u8, connection.pending.items, '\n')) |newline| {
                const line = try connection.allocator.dupe(u8, std.mem.trim(u8, connection.pending.items[0..newline], " \t\r"));
                const remaining = connection.pending.items[newline + 1 ..];
                std.mem.copyForwards(u8, connection.pending.items[0..remaining.len], remaining);
                connection.pending.items.len = remaining.len;
                if (line.len == 0) {
                    connection.allocator.free(line);
                    continue;
                }
                return line;
            }
            var buffer: [64 * 1024]u8 = undefined;
            const count = connection.child.stdout.?.readStreaming(connection.io, &.{&buffer}) catch |failure| switch (failure) {
                error.EndOfStream => return error.McpTransportClosed,
                else => return failure,
            };
            if (count == 0) return error.McpTransportClosed;
            if (connection.pending.items.len + count > max_frame_bytes) return error.McpFrameTooLarge;
            try connection.pending.appendSlice(connection.allocator, buffer[0..count]);
        }
    }
};

fn mcpErrorCode(object: std.json.ObjectMap) ?i64 {
    const value = object.get("error") orelse return null;
    if (value != .object) return null;
    const code = value.object.get("code") orelse return null;
    return if (code == .integer) code.integer else null;
}

fn matchesId(object: std.json.ObjectMap, expected: i64) bool {
    const value = object.get("id") orelse return false;
    return value == .integer and value.integer == expected;
}

fn protocolPreference(connector: std.json.ObjectMap) ProtocolPreference {
    const configured = stringField(connector, "protocolEra") orelse return .modern_first;
    if (std.mem.eql(u8, configured, "modern")) return .modern;
    if (std.mem.eql(u8, configured, "legacy")) return .legacy;
    return .modern_first;
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len == 0) null else trimmed;
}
