const std = @import("std");

const max_document_bytes = 1024 * 1024;
const max_field_bytes = 256 * 1024;

pub const Token = struct {
    allocator: std.mem.Allocator,
    access: []u8,
    account: ?[]u8,
    scopes: [][]u8,
    obtained_at: []u8,
    expires_at_ms: ?i64,

    pub fn deinit(token: *Token) void {
        token.allocator.free(token.access);
        if (token.account) |value| token.allocator.free(value);
        for (token.scopes) |scope| token.allocator.free(scope);
        token.allocator.free(token.scopes);
        token.allocator.free(token.obtained_at);
        token.* = undefined;
    }
};

pub const Store = struct {
    allocator: std.mem.Allocator,
    client_id: ?[]u8 = null,
    tokens: std.ArrayList(Token) = .empty,

    pub fn deinit(store: *Store) void {
        if (store.client_id) |value| store.allocator.free(value);
        for (store.tokens.items) |*value| value.deinit();
        store.tokens.deinit(store.allocator);
        store.* = undefined;
    }
};

pub fn load(allocator: std.mem.Allocator, io: std.Io, data_dir: []const u8) !Store {
    const file_path = try path(allocator, data_dir);
    defer allocator.free(file_path);
    const document = std.Io.Dir.cwd().readFileAlloc(io, file_path, allocator, .limited(max_document_bytes)) catch |failure| switch (failure) {
        error.FileNotFound => return .{ .allocator = allocator },
        else => return failure,
    };
    defer allocator.free(document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidOAuthConnectorStore;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidOAuthConnectorStore;
    var store = Store{ .allocator = allocator };
    errdefer store.deinit();
    if (parsed.value.object.get("clients")) |clients| if (clients == .object) if (clients.object.get("github")) |github| if (github == .object) if (stringField(github.object, "clientId")) |value| {
        store.client_id = try allocator.dupe(u8, value);
    };
    if (parsed.value.object.get("tokens")) |tokens| if (tokens == .object) if (tokens.object.get("github")) |github| switch (github) {
        .object => try store.tokens.append(allocator, try parseToken(allocator, github.object)),
        .array => for (github.array.items) |item| {
            if (item != .object) return error.InvalidOAuthConnectorStore;
            try store.tokens.append(allocator, try parseToken(allocator, item.object));
        },
        else => return error.InvalidOAuthConnectorStore,
    };
    return store;
}

pub fn save(allocator: std.mem.Allocator, io: std.Io, data_dir: []const u8, store: *const Store) !void {
    const file_path = try path(allocator, data_dir);
    defer allocator.free(file_path);
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try output.writer.writeAll("{\"version\":2,\"clients\":{");
    if (store.client_id) |client_id| {
        try output.writer.writeAll("\"github\":{\"clientId\":");
        try std.json.Stringify.value(client_id, .{}, &output.writer);
        try output.writer.writeByte('}');
    }
    try output.writer.writeAll("},\"tokens\":{");
    if (store.tokens.items.len > 0) {
        try output.writer.writeAll("\"github\":[");
        for (store.tokens.items, 0..) |token, index| {
            if (index > 0) try output.writer.writeByte(',');
            try writeToken(&output.writer, token);
        }
        try output.writer.writeByte(']');
    }
    try output.writer.writeAll("}}");
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

pub fn injectEnvironment(allocator: std.mem.Allocator, io: std.Io, data_dir: []const u8, connector: std.json.ObjectMap, environment: *std.process.Environ.Map) !void {
    const id = stringField(connector, "id") orelse return;
    if (!std.mem.eql(u8, id, "github") and !std.mem.startsWith(u8, id, "account-github-")) return;
    const auth = connector.get("auth") orelse return;
    if (auth != .object) return;
    const auth_type = stringField(auth.object, "type") orelse return;
    const provider = stringField(auth.object, "provider") orelse return;
    if (!std.mem.eql(u8, auth_type, "oauth") or !std.mem.eql(u8, provider, "github")) return;
    var store = try load(allocator, io, data_dir);
    defer store.deinit();
    const account = stringField(auth.object, "account") orelse return error.OAuthConnectorNotConnected;
    for (store.tokens.items) |token| {
        if (token.account) |candidate| if (std.mem.eql(u8, candidate, account)) {
            try environment.put("GITHUB_PERSONAL_ACCESS_TOKEN", token.access);
            return;
        };
    }
    if (std.mem.eql(u8, id, "github") and store.tokens.items.len == 1) {
        try environment.put("GITHUB_PERSONAL_ACCESS_TOKEN", store.tokens.items[0].access);
        return;
    }
    return error.OAuthConnectorNotConnected;
}

fn writeToken(writer: *std.Io.Writer, token: Token) !void {
    try writer.writeAll("{\"accessToken\":");
    try std.json.Stringify.value(token.access, .{}, writer);
    if (token.account) |account| {
        try writer.writeAll(",\"account\":");
        try std.json.Stringify.value(account, .{}, writer);
    }
    if (token.expires_at_ms) |expires_at| try writer.print(",\"expiresAt\":{d}", .{expires_at});
    try writer.writeAll(",\"scopes\":[");
    for (token.scopes, 0..) |scope, index| {
        if (index > 0) try writer.writeByte(',');
        try std.json.Stringify.value(scope, .{}, writer);
    }
    try writer.writeAll("],\"obtainedAt\":");
    try std.json.Stringify.value(token.obtained_at, .{}, writer);
    try writer.writeByte('}');
}

fn parseToken(allocator: std.mem.Allocator, object: std.json.ObjectMap) !Token {
    const access = stringField(object, "accessToken") orelse return error.InvalidOAuthConnectorStore;
    const obtained_at = stringField(object, "obtainedAt") orelse return error.InvalidOAuthConnectorStore;
    const access_copy = try allocator.dupe(u8, access);
    errdefer allocator.free(access_copy);
    const account = if (stringField(object, "account")) |value| try allocator.dupe(u8, value) else null;
    errdefer if (account) |value| allocator.free(value);
    var scopes: std.ArrayList([]u8) = .empty;
    errdefer {
        for (scopes.items) |scope| allocator.free(scope);
        scopes.deinit(allocator);
    }
    if (object.get("scopes")) |value| {
        if (value != .array or value.array.items.len > 256) return error.InvalidOAuthConnectorStore;
        for (value.array.items) |scope| {
            if (scope != .string or scope.string.len == 0 or scope.string.len > 4096) return error.InvalidOAuthConnectorStore;
            try scopes.append(allocator, try allocator.dupe(u8, scope.string));
        }
    }
    const expires_at = if (object.get("expiresAt")) |value| if (value == .integer and value.integer > 0) value.integer else null else null;
    return .{
        .allocator = allocator,
        .access = access_copy,
        .account = account,
        .scopes = try scopes.toOwnedSlice(allocator),
        .obtained_at = try allocator.dupe(u8, obtained_at),
        .expires_at_ms = expires_at,
    };
}

fn path(allocator: std.mem.Allocator, data_dir: []const u8) ![]u8 {
    return std.fs.path.join(allocator, &.{ data_dir, "oauth-tokens.json" });
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string or value.string.len == 0 or value.string.len > max_field_bytes) return null;
    return value.string;
}
