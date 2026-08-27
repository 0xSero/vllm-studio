const std = @import("std");
const client_runtime = @import("client.zig");
const oauth_store = @import("../../accounts/mcp_oauth/store.zig");

const Io = std.Io;
const max_document_bytes = 8 * 1024 * 1024;

pub fn run(init: std.process.Init, url: []const u8, protocol_era: []const u8, provider: ?[]const u8, account: ?[]const u8) !void {
    var client: std.http.Client = .{ .allocator = init.gpa, .io = init.io };
    defer client.deinit();
    var connector = try Connector.init(init.gpa, init.environ_map, url, protocol_era);
    defer connector.deinit();
    var input_buffer: [16 * 1024]u8 = undefined;
    var output_buffer: [16 * 1024]u8 = undefined;
    var input = Io.File.stdin().reader(init.io, &input_buffer);
    var output = Io.File.stdout().writer(init.io, &output_buffer);
    while (try input.interface.takeDelimiter('\n')) |line_value| {
        const line = std.mem.trim(u8, line_value, " \t\r");
        if (line.len == 0) continue;
        if (line.len > max_document_bytes) return error.McpRequestTooLarge;
        const authorization = if (provider != null and account != null)
            try oauth_store.authorizationHeader(init.gpa, init.io, &client, init.environ_map.get("LOCAL_STUDIO_DATA_DIR") orelse return error.McpOAuthDataDirectoryRequired, provider.?, account.?)
        else
            null;
        defer if (authorization) |value| init.gpa.free(value);
        var invocation = try connector.invocation(init.gpa, authorization);
        defer invocation.deinit();
        const response = handle(init.gpa, init.io, &client, invocation.value, line) catch |failure| try errorResponse(init.gpa, line, failure);
        defer init.gpa.free(response);
        if (response.len == 0) continue;
        try output.interface.writeAll(response);
        try output.interface.writeByte('\n');
        try output.interface.flush();
    }
}

const Connector = struct {
    arena: std.heap.ArenaAllocator,
    value: std.json.ObjectMap,

    fn init(allocator: std.mem.Allocator, environment: *const std.process.Environ.Map, url: []const u8, protocol_era: []const u8) !Connector {
        var arena = std.heap.ArenaAllocator.init(allocator);
        errdefer arena.deinit();
        const storage = arena.allocator();
        var value: std.json.ObjectMap = .empty;
        try value.put(storage, "id", .{ .string = "native-forwarder" });
        try value.put(storage, "transport", .{ .string = "http" });
        try value.put(storage, "url", .{ .string = try storage.dupe(u8, url) });
        try value.put(storage, "protocolEra", .{ .string = try storage.dupe(u8, protocol_era) });
        const configured = environment.get("MCP_AUTHORIZATION");
        const github = environment.get("GITHUB_PERSONAL_ACCESS_TOKEN");
        if (configured != null or github != null) {
            var headers: std.json.ObjectMap = .empty;
            const authorization = if (configured) |value_header| try storage.dupe(u8, value_header) else try std.fmt.allocPrint(storage, "Bearer {s}", .{github.?});
            try headers.put(storage, "Authorization", .{ .string = authorization });
            try value.put(storage, "headers", .{ .object = headers });
        }
        return .{ .arena = arena, .value = value };
    }

    fn deinit(connector: *Connector) void {
        connector.arena.deinit();
        connector.* = undefined;
    }

    fn invocation(connector: *Connector, allocator: std.mem.Allocator, authorization: ?[]const u8) !Invocation {
        var value: std.json.ObjectMap = .empty;
        errdefer value.deinit(allocator);
        var iterator = connector.value.iterator();
        while (iterator.next()) |entry| try value.put(allocator, entry.key_ptr.*, entry.value_ptr.*);
        var headers: std.json.ObjectMap = .empty;
        errdefer headers.deinit(allocator);
        if (connector.value.get("headers")) |configured| if (configured == .object) {
            var header_iterator = configured.object.iterator();
            while (header_iterator.next()) |entry| try headers.put(allocator, entry.key_ptr.*, entry.value_ptr.*);
        };
        if (authorization) |header| try headers.put(allocator, "Authorization", .{ .string = header });
        if (headers.count() > 0) try value.put(allocator, "headers", .{ .object = headers });
        return .{ .allocator = allocator, .value = value, .headers = headers };
    }
};

const Invocation = struct {
    allocator: std.mem.Allocator,
    value: std.json.ObjectMap,
    headers: std.json.ObjectMap,

    fn deinit(invocation: *Invocation) void {
        invocation.headers.deinit(invocation.allocator);
        invocation.value.deinit(invocation.allocator);
        invocation.* = undefined;
    }
};

fn handle(allocator: std.mem.Allocator, io: Io, client: *std.http.Client, connector: std.json.ObjectMap, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidMcpRequest;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidMcpRequest;
    const object = parsed.value.object;
    const method = stringField(object, "method") orelse return error.McpMethodRequired;
    if (std.mem.eql(u8, method, "notifications/initialized")) return allocator.dupe(u8, "");
    const id = object.get("id") orelse return allocator.dupe(u8, "");
    if (std.mem.eql(u8, method, "server/discover")) return discoverResponse(allocator, id);
    if (std.mem.eql(u8, method, "initialize")) return initializeResponse(allocator, id, object.get("params"));
    const result = if (std.mem.eql(u8, method, "tools/list"))
        try client_runtime.executeHttp(allocator, io, client, connector, .tools)
    else if (std.mem.eql(u8, method, "tools/call")) blk: {
        const params = object.get("params") orelse return error.McpParamsRequired;
        if (params != .object) return error.McpParamsRequired;
        const name = stringField(params.object, "name") orelse return error.McpToolRequired;
        const arguments = params.object.get("arguments") orelse std.json.Value{ .object = .empty };
        if (arguments != .object) return error.InvalidMcpArguments;
        break :blk try client_runtime.executeHttp(allocator, io, client, connector, .{ .call = .{ .name = name, .arguments = arguments } });
    } else return rpcError(allocator, id, -32601, "unknown method");
    defer allocator.free(result);
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"jsonrpc\":\"2.0\",\"id\":");
    try std.json.Stringify.value(id, .{}, &output.writer);
    try output.writer.writeAll(",\"result\":");
    try output.writer.writeAll(result);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn discoverResponse(allocator: std.mem.Allocator, id: std.json.Value) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"jsonrpc\":\"2.0\",\"id\":");
    try std.json.Stringify.value(id, .{}, &output.writer);
    try output.writer.writeAll(",\"result\":{\"supportedVersions\":[\"2026-07-28\"],\"capabilities\":{\"tools\":{}},\"resultType\":\"complete\",\"ttlMs\":300000,\"cacheScope\":\"private\",\"_meta\":{\"io.modelcontextprotocol/serverInfo\":{\"name\":\"local-studio-forwarder\",\"version\":\"2.1.0\"}}}}");
    return output.toOwnedSlice();
}

fn initializeResponse(allocator: std.mem.Allocator, id: std.json.Value, params: ?std.json.Value) ![]u8 {
    const protocol = if (params) |value| if (value == .object) stringField(value.object, "protocolVersion") orelse "2025-06-18" else "2025-06-18" else "2025-06-18";
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"jsonrpc\":\"2.0\",\"id\":");
    try std.json.Stringify.value(id, .{}, &output.writer);
    try output.writer.writeAll(",\"result\":{\"protocolVersion\":");
    try std.json.Stringify.value(protocol, .{}, &output.writer);
    try output.writer.writeAll(",\"capabilities\":{\"tools\":{}},\"serverInfo\":{\"name\":\"local-studio-forwarder\",\"version\":\"2.1.0\"}}}");
    return output.toOwnedSlice();
}

fn errorResponse(allocator: std.mem.Allocator, request: []const u8, failure: anyerror) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, request, .{}) catch return rpcError(allocator, .null, -32700, "parse error");
    defer parsed.deinit();
    const id = if (parsed.value == .object) parsed.value.object.get("id") orelse .null else .null;
    return rpcError(allocator, id, -32603, @errorName(failure));
}

fn rpcError(allocator: std.mem.Allocator, id: std.json.Value, code: i32, message: []const u8) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"jsonrpc\":\"2.0\",\"id\":");
    try std.json.Stringify.value(id, .{}, &output.writer);
    try output.writer.print(",\"error\":{{\"code\":{d},\"message\":", .{code});
    try std.json.Stringify.value(message, .{}, &output.writer);
    try output.writer.writeAll("}}");
    return output.toOwnedSlice();
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    return if (value == .string) value.string else null;
}
