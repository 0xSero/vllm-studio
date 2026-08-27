const std = @import("std");

const Io = std.Io;
const http = std.http;
const max_document_bytes = 4 * 1024 * 1024;
const max_response_bytes = 2 * 1024 * 1024;
const max_field_bytes = 256 * 1024;

pub const Client = struct {
    allocator: std.mem.Allocator,
    provider: []u8,
    client_id: []u8,

    pub fn deinit(value: *Client) void {
        value.allocator.free(value.provider);
        value.allocator.free(value.client_id);
        value.* = undefined;
    }
};

pub const Grant = struct {
    allocator: std.mem.Allocator,
    provider: []u8,
    account: []u8,
    label: []u8,
    resource: []u8,
    token_endpoint: []u8,
    client_id: []u8,
    client_secret: ?[]u8,
    access_token: []u8,
    refresh_token: ?[]u8,
    scopes: [][]u8,
    expires_at_ms: ?i64,

    pub fn deinit(value: *Grant) void {
        value.allocator.free(value.provider);
        value.allocator.free(value.account);
        value.allocator.free(value.label);
        value.allocator.free(value.resource);
        value.allocator.free(value.token_endpoint);
        value.allocator.free(value.client_id);
        if (value.client_secret) |secret| value.allocator.free(secret);
        value.allocator.free(value.access_token);
        if (value.refresh_token) |refresh| value.allocator.free(refresh);
        for (value.scopes) |scope| value.allocator.free(scope);
        value.allocator.free(value.scopes);
        value.* = undefined;
    }
};

pub const Store = struct {
    allocator: std.mem.Allocator,
    clients: std.ArrayList(Client) = .empty,
    grants: std.ArrayList(Grant) = .empty,

    pub fn deinit(store: *Store) void {
        for (store.clients.items) |*value| value.deinit();
        store.clients.deinit(store.allocator);
        for (store.grants.items) |*value| value.deinit();
        store.grants.deinit(store.allocator);
        store.* = undefined;
    }

    pub fn clientId(store: *const Store, provider: []const u8) ?[]const u8 {
        for (store.clients.items) |value| if (std.mem.eql(u8, value.provider, provider)) return value.client_id;
        return null;
    }

    pub fn findGrant(store: *Store, provider: []const u8, account: []const u8) ?*Grant {
        for (store.grants.items) |*value| if (std.mem.eql(u8, value.provider, provider) and std.mem.eql(u8, value.account, account)) return value;
        return null;
    }
};

pub fn load(allocator: std.mem.Allocator, io: Io, data_dir: []const u8) !Store {
    const file_path = try path(allocator, data_dir);
    defer allocator.free(file_path);
    const document = std.Io.Dir.cwd().readFileAlloc(io, file_path, allocator, .limited(max_document_bytes)) catch |failure| switch (failure) {
        error.FileNotFound => return .{ .allocator = allocator },
        else => return failure,
    };
    defer allocator.free(document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidMcpOAuthStore;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidMcpOAuthStore;
    var store = Store{ .allocator = allocator };
    errdefer store.deinit();
    if (parsed.value.object.get("clients")) |clients| {
        if (clients != .array or clients.array.items.len > 256) return error.InvalidMcpOAuthStore;
        for (clients.array.items) |value| {
            if (value != .object) return error.InvalidMcpOAuthStore;
            const provider = stringField(value.object, "provider") orelse return error.InvalidMcpOAuthStore;
            const client_id = stringField(value.object, "clientId") orelse return error.InvalidMcpOAuthStore;
            try store.clients.append(allocator, .{
                .allocator = allocator,
                .provider = try allocator.dupe(u8, provider),
                .client_id = try allocator.dupe(u8, client_id),
            });
        }
    }
    if (parsed.value.object.get("grants")) |grants| {
        if (grants != .array or grants.array.items.len > 1024) return error.InvalidMcpOAuthStore;
        for (grants.array.items) |value| {
            if (value != .object) return error.InvalidMcpOAuthStore;
            try store.grants.append(allocator, try parseGrant(allocator, value.object));
        }
    }
    return store;
}

pub fn save(allocator: std.mem.Allocator, io: Io, data_dir: []const u8, store: *const Store) !void {
    const file_path = try path(allocator, data_dir);
    defer allocator.free(file_path);
    var output: Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try output.writer.writeAll("{\"version\":1,\"clients\":[");
    for (store.clients.items, 0..) |value, index| {
        if (index > 0) try output.writer.writeByte(',');
        try output.writer.writeAll("{\"provider\":");
        try std.json.Stringify.value(value.provider, .{}, &output.writer);
        try output.writer.writeAll(",\"clientId\":");
        try std.json.Stringify.value(value.client_id, .{}, &output.writer);
        try output.writer.writeByte('}');
    }
    try output.writer.writeAll("],\"grants\":[");
    for (store.grants.items, 0..) |value, index| {
        if (index > 0) try output.writer.writeByte(',');
        try writeGrant(&output.writer, value);
    }
    try output.writer.writeAll("]}");
    var atomic_file = try std.Io.Dir.cwd().createFileAtomic(io, file_path, .{
        .permissions = @enumFromInt(0o600),
        .make_path = true,
        .replace = true,
    });
    defer atomic_file.deinit(io);
    try atomic_file.file.writeStreamingAll(io, output.writer.buffered());
    try atomic_file.file.sync(io);
    try atomic_file.replace(io);
    const directory = std.fs.path.dirname(file_path) orelse data_dir;
    const directory_z = try allocator.dupeZ(u8, directory);
    defer allocator.free(directory_z);
    _ = std.c.chmod(directory_z.ptr, 0o700);
}

pub fn setClientId(allocator: std.mem.Allocator, store: *Store, provider: []const u8, client_id: []const u8) !void {
    for (store.clients.items) |*value| {
        if (!std.mem.eql(u8, value.provider, provider)) continue;
        allocator.free(value.client_id);
        value.client_id = try allocator.dupe(u8, client_id);
        return;
    }
    try store.clients.append(allocator, .{
        .allocator = allocator,
        .provider = try allocator.dupe(u8, provider),
        .client_id = try allocator.dupe(u8, client_id),
    });
}

pub fn upsertGrant(allocator: std.mem.Allocator, store: *Store, grant: Grant) !void {
    for (store.grants.items) |*value| {
        if (!std.mem.eql(u8, value.provider, grant.provider) or !std.mem.eql(u8, value.account, grant.account)) continue;
        value.deinit();
        value.* = grant;
        return;
    }
    try store.grants.append(allocator, grant);
}

pub fn removeGrant(store: *Store, provider: []const u8, account: []const u8) bool {
    var index: usize = 0;
    while (index < store.grants.items.len) : (index += 1) {
        const value = &store.grants.items[index];
        if (!std.mem.eql(u8, value.provider, provider) or !std.mem.eql(u8, value.account, account)) continue;
        var removed = store.grants.orderedRemove(index);
        removed.deinit();
        return true;
    }
    return false;
}

pub fn authorizationHeader(allocator: std.mem.Allocator, io: Io, client: *http.Client, data_dir: []const u8, provider: []const u8, account: []const u8) ![]u8 {
    var store = try load(allocator, io, data_dir);
    defer store.deinit();
    const grant = store.findGrant(provider, account) orelse return error.McpOAuthGrantNotFound;
    const now_ms = nowMillis(io);
    if (grant.expires_at_ms) |expires_at| if (expires_at <= now_ms + 60_000) {
        try refreshGrant(allocator, client, grant, now_ms);
        try save(allocator, io, data_dir, &store);
    };
    return std.fmt.allocPrint(allocator, "Bearer {s}", .{grant.access_token});
}

fn refreshGrant(allocator: std.mem.Allocator, client: *http.Client, grant: *Grant, now_ms: i64) !void {
    const refresh = grant.refresh_token orelse return error.McpOAuthGrantExpired;
    var form: Io.Writer.Allocating = .init(allocator);
    defer form.deinit();
    try form.writer.writeAll("grant_type=refresh_token&refresh_token=");
    try formEncode(&form.writer, refresh);
    try form.writer.writeAll("&client_id=");
    try formEncode(&form.writer, grant.client_id);
    try form.writer.writeAll("&resource=");
    try formEncode(&form.writer, grant.resource);
    if (grant.client_secret) |secret| {
        try form.writer.writeAll("&client_secret=");
        try formEncode(&form.writer, secret);
    }
    const response = try postForm(allocator, client, grant.token_endpoint, form.writer.buffered());
    defer allocator.free(response.body);
    if (response.status.class() != .success) return error.McpOAuthRefreshRejected;
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, response.body, .{}) catch return error.InvalidMcpOAuthResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidMcpOAuthResponse;
    const access = stringField(parsed.value.object, "access_token") orelse return error.InvalidMcpOAuthResponse;
    const next_access = try allocator.dupe(u8, access);
    allocator.free(grant.access_token);
    grant.access_token = next_access;
    if (stringField(parsed.value.object, "refresh_token")) |next_refresh| {
        const copy = try allocator.dupe(u8, next_refresh);
        if (grant.refresh_token) |current| allocator.free(current);
        grant.refresh_token = copy;
    }
    if (stringField(parsed.value.object, "scope")) |scope_value| {
        var next_scopes: std.ArrayList([]u8) = .empty;
        errdefer {
            for (next_scopes.items) |scope| allocator.free(scope);
            next_scopes.deinit(allocator);
        }
        var values = std.mem.tokenizeAny(u8, scope_value, " ,\t\r\n");
        while (values.next()) |scope| try next_scopes.append(allocator, try allocator.dupe(u8, scope));
        for (grant.scopes) |scope| allocator.free(scope);
        allocator.free(grant.scopes);
        grant.scopes = try next_scopes.toOwnedSlice(allocator);
    }
    grant.expires_at_ms = if (positiveInteger(parsed.value.object, "expires_in")) |seconds| now_ms + seconds * 1000 else null;
}

const FetchResponse = struct { status: http.Status, body: []u8 };

fn postForm(allocator: std.mem.Allocator, client: *http.Client, url: []const u8, payload: []const u8) !FetchResponse {
    const storage = try allocator.alloc(u8, max_response_bytes);
    defer allocator.free(storage);
    var output: Io.Writer = .fixed(storage);
    const response = try client.fetch(.{
        .location = .{ .url = url },
        .method = .POST,
        .payload = payload,
        .redirect_behavior = .not_allowed,
        .keep_alive = false,
        .headers = .{ .accept_encoding = .omit, .content_type = .omit },
        .extra_headers = &.{
            .{ .name = "Content-Type", .value = "application/x-www-form-urlencoded" },
            .{ .name = "Accept", .value = "application/json" },
        },
        .response_writer = &output,
    });
    return .{ .status = response.status, .body = try allocator.dupe(u8, output.buffered()) };
}

fn parseGrant(allocator: std.mem.Allocator, object: std.json.ObjectMap) !Grant {
    const provider = stringField(object, "provider") orelse return error.InvalidMcpOAuthStore;
    const account = stringField(object, "account") orelse return error.InvalidMcpOAuthStore;
    const label = stringField(object, "label") orelse return error.InvalidMcpOAuthStore;
    const resource = stringField(object, "resource") orelse return error.InvalidMcpOAuthStore;
    const token_endpoint = stringField(object, "tokenEndpoint") orelse return error.InvalidMcpOAuthStore;
    const client_id = stringField(object, "clientId") orelse return error.InvalidMcpOAuthStore;
    const access_token = stringField(object, "accessToken") orelse return error.InvalidMcpOAuthStore;
    var scopes: std.ArrayList([]u8) = .empty;
    errdefer {
        for (scopes.items) |scope| allocator.free(scope);
        scopes.deinit(allocator);
    }
    if (object.get("scopes")) |value| {
        if (value != .array or value.array.items.len > 256) return error.InvalidMcpOAuthStore;
        for (value.array.items) |scope| {
            if (scope != .string or scope.string.len == 0 or scope.string.len > 4096) return error.InvalidMcpOAuthStore;
            try scopes.append(allocator, try allocator.dupe(u8, scope.string));
        }
    }
    return .{
        .allocator = allocator,
        .provider = try allocator.dupe(u8, provider),
        .account = try allocator.dupe(u8, account),
        .label = try allocator.dupe(u8, label),
        .resource = try allocator.dupe(u8, resource),
        .token_endpoint = try allocator.dupe(u8, token_endpoint),
        .client_id = try allocator.dupe(u8, client_id),
        .client_secret = if (stringField(object, "clientSecret")) |value| try allocator.dupe(u8, value) else null,
        .access_token = try allocator.dupe(u8, access_token),
        .refresh_token = if (stringField(object, "refreshToken")) |value| try allocator.dupe(u8, value) else null,
        .scopes = try scopes.toOwnedSlice(allocator),
        .expires_at_ms = if (object.get("expiresAt")) |value| if (value == .integer and value.integer > 0) value.integer else null else null,
    };
}

fn writeGrant(writer: *Io.Writer, value: Grant) !void {
    try writer.writeAll("{\"provider\":");
    try std.json.Stringify.value(value.provider, .{}, writer);
    try writer.writeAll(",\"account\":");
    try std.json.Stringify.value(value.account, .{}, writer);
    try writer.writeAll(",\"label\":");
    try std.json.Stringify.value(value.label, .{}, writer);
    try writer.writeAll(",\"resource\":");
    try std.json.Stringify.value(value.resource, .{}, writer);
    try writer.writeAll(",\"tokenEndpoint\":");
    try std.json.Stringify.value(value.token_endpoint, .{}, writer);
    try writer.writeAll(",\"clientId\":");
    try std.json.Stringify.value(value.client_id, .{}, writer);
    if (value.client_secret) |secret| {
        try writer.writeAll(",\"clientSecret\":");
        try std.json.Stringify.value(secret, .{}, writer);
    }
    try writer.writeAll(",\"accessToken\":");
    try std.json.Stringify.value(value.access_token, .{}, writer);
    if (value.refresh_token) |refresh| {
        try writer.writeAll(",\"refreshToken\":");
        try std.json.Stringify.value(refresh, .{}, writer);
    }
    if (value.expires_at_ms) |expires_at| try writer.print(",\"expiresAt\":{d}", .{expires_at});
    try writer.writeAll(",\"scopes\":[");
    for (value.scopes, 0..) |scope, index| {
        if (index > 0) try writer.writeByte(',');
        try std.json.Stringify.value(scope, .{}, writer);
    }
    try writer.writeAll("]}");
}

fn path(allocator: std.mem.Allocator, data_dir: []const u8) ![]u8 {
    return std.fs.path.join(allocator, &.{ data_dir, "accounts", "mcp-oauth.json" });
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string or value.string.len == 0 or value.string.len > max_field_bytes) return null;
    return value.string;
}

fn positiveInteger(object: std.json.ObjectMap, name: []const u8) ?i64 {
    const value = object.get(name) orelse return null;
    return if (value == .integer and value.integer > 0) value.integer else null;
}

fn formEncode(writer: *Io.Writer, value: []const u8) !void {
    const hex = "0123456789ABCDEF";
    for (value) |byte| {
        if (std.ascii.isAlphanumeric(byte) or byte == '-' or byte == '_' or byte == '.' or byte == '~') {
            try writer.writeByte(byte);
        } else if (byte == ' ') {
            try writer.writeByte('+');
        } else {
            try writer.writeByte('%');
            try writer.writeByte(hex[byte >> 4]);
            try writer.writeByte(hex[byte & 15]);
        }
    }
}

fn nowMillis(io: Io) i64 {
    return @max(Io.Clock.real.now(io).toSeconds(), 0) * 1000;
}
