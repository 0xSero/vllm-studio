const std = @import("std");

const max_document_bytes = 4 * 1024 * 1024;
const max_field_bytes = 256 * 1024;

pub const Service = enum {
    gmail,
    calendar,

    pub fn parse(value: []const u8) !Service {
        if (std.mem.eql(u8, value, "gmail")) return .gmail;
        if (std.mem.eql(u8, value, "google-calendar")) return .calendar;
        return error.InvalidGoogleService;
    }

    pub fn name(service: Service) []const u8 {
        return if (service == .gmail) "gmail" else "google-calendar";
    }

    pub fn endpoint(service: Service) []const u8 {
        return if (service == .gmail) "https://gmail.googleapis.com/gmail/v1" else "https://www.googleapis.com/calendar/v3";
    }
};

pub const Connection = struct {
    allocator: std.mem.Allocator,
    refresh_token: []u8,
    scopes: [][]u8,
    connected_at: []u8,

    pub fn deinit(connection: *Connection) void {
        connection.allocator.free(connection.refresh_token);
        for (connection.scopes) |scope| connection.allocator.free(scope);
        connection.allocator.free(connection.scopes);
        connection.allocator.free(connection.connected_at);
        connection.* = undefined;
    }
};

pub const Account = struct {
    allocator: std.mem.Allocator,
    key: []u8,
    email: []u8,
    gmail: ?Connection = null,
    calendar: ?Connection = null,

    pub fn deinit(account: *Account) void {
        account.allocator.free(account.key);
        account.allocator.free(account.email);
        if (account.gmail) |*value| value.deinit();
        if (account.calendar) |*value| value.deinit();
        account.* = undefined;
    }

    pub fn connection(account: *Account, service: Service) *?Connection {
        return if (service == .gmail) &account.gmail else &account.calendar;
    }
};

pub const Store = struct {
    allocator: std.mem.Allocator,
    client_id: ?[]u8 = null,
    client_secret: ?[]u8 = null,
    accounts: std.ArrayList(Account) = .empty,

    pub fn deinit(store: *Store) void {
        if (store.client_id) |value| store.allocator.free(value);
        if (store.client_secret) |value| store.allocator.free(value);
        for (store.accounts.items) |*account| account.deinit();
        store.accounts.deinit(store.allocator);
        store.* = undefined;
    }

    pub fn find(store: *Store, key: []const u8) ?*Account {
        for (store.accounts.items) |*account| if (std.mem.eql(u8, account.key, key)) return account;
        return null;
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
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidGoogleAccountStore;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidGoogleAccountStore;
    var store = Store{ .allocator = allocator };
    errdefer store.deinit();
    if (stringField(parsed.value.object, "clientId")) |value| store.client_id = try allocator.dupe(u8, value);
    if (stringField(parsed.value.object, "clientSecret")) |value| store.client_secret = try allocator.dupe(u8, value);
    const accounts = parsed.value.object.get("accounts") orelse return store;
    if (accounts != .object or accounts.object.count() > 1000) return error.InvalidGoogleAccountStore;
    var iterator = accounts.object.iterator();
    while (iterator.next()) |entry| {
        if (!validKey(entry.key_ptr.*) or entry.value_ptr.* != .object) return error.InvalidGoogleAccountStore;
        const email = stringField(entry.value_ptr.object, "email") orelse return error.InvalidGoogleAccountStore;
        var account = Account{
            .allocator = allocator,
            .key = try allocator.dupe(u8, entry.key_ptr.*),
            .email = try allocator.dupe(u8, email),
        };
        errdefer account.deinit();
        if (entry.value_ptr.object.get("connections")) |connections| if (connections == .object) {
            if (connections.object.get("gmail")) |value| {
                if (value == .object) account.gmail = try parseConnection(allocator, value.object);
            }
            if (connections.object.get("google-calendar")) |value| {
                if (value == .object) account.calendar = try parseConnection(allocator, value.object);
            }
        };
        try store.accounts.append(allocator, account);
    }
    return store;
}

pub fn save(allocator: std.mem.Allocator, io: std.Io, data_dir: []const u8, store: *const Store) !void {
    const file_path = try path(allocator, data_dir);
    defer allocator.free(file_path);
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try output.writer.writeAll("{\"version\":3,\"clientId\":");
    if (store.client_id) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
    try output.writer.writeAll(",\"clientSecret\":");
    if (store.client_secret) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
    try output.writer.writeAll(",\"accounts\":{");
    for (store.accounts.items, 0..) |account, index| {
        if (index > 0) try output.writer.writeByte(',');
        try std.json.Stringify.value(account.key, .{}, &output.writer);
        try output.writer.writeAll(":{\"email\":");
        try std.json.Stringify.value(account.email, .{}, &output.writer);
        try output.writer.writeAll(",\"connections\":{");
        var wrote = false;
        if (account.gmail) |connection| {
            try output.writer.writeAll("\"gmail\":");
            try writeConnection(&output.writer, connection, .gmail);
            wrote = true;
        }
        if (account.calendar) |connection| {
            if (wrote) try output.writer.writeByte(',');
            try output.writer.writeAll("\"google-calendar\":");
            try writeConnection(&output.writer, connection, .calendar);
        }
        try output.writer.writeAll("}}");
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

pub fn accountKey(email_value: []const u8) [10]u8 {
    var normalized: [320]u8 = undefined;
    const trimmed = std.mem.trim(u8, email_value, " \t\r\n");
    const length = @min(trimmed.len, normalized.len);
    for (trimmed[0..length], 0..) |byte, index| normalized[index] = std.ascii.toLower(byte);
    var digest: [32]u8 = undefined;
    std.crypto.hash.sha2.Sha256.hash(normalized[0..length], &digest, .{});
    return std.fmt.bytesToHex(digest[0..5].*, .lower);
}

pub fn validKey(value: []const u8) bool {
    if (value.len != 10) return false;
    for (value) |byte| if (!std.ascii.isHex(byte) or std.ascii.isUpper(byte)) return false;
    return true;
}

fn parseConnection(allocator: std.mem.Allocator, object: std.json.ObjectMap) !Connection {
    const refresh_token = stringField(object, "refreshToken") orelse return error.InvalidGoogleAccountStore;
    const connected_at = stringField(object, "connectedAt") orelse return error.InvalidGoogleAccountStore;
    const token_copy = try allocator.dupe(u8, refresh_token);
    errdefer allocator.free(token_copy);
    var scopes: std.ArrayList([]u8) = .empty;
    errdefer {
        for (scopes.items) |scope| allocator.free(scope);
        scopes.deinit(allocator);
    }
    const value = object.get("scopes") orelse return error.InvalidGoogleAccountStore;
    if (value != .array or value.array.items.len > 256) return error.InvalidGoogleAccountStore;
    for (value.array.items) |scope| {
        if (scope != .string or scope.string.len == 0 or scope.string.len > 4096) return error.InvalidGoogleAccountStore;
        try scopes.append(allocator, try allocator.dupe(u8, scope.string));
    }
    return .{
        .allocator = allocator,
        .refresh_token = token_copy,
        .scopes = try scopes.toOwnedSlice(allocator),
        .connected_at = try allocator.dupe(u8, connected_at),
    };
}

fn writeConnection(writer: *std.Io.Writer, connection: Connection, service: Service) !void {
    try writer.writeAll("{\"refreshToken\":");
    try std.json.Stringify.value(connection.refresh_token, .{}, writer);
    try writer.writeAll(",\"scopes\":[");
    for (connection.scopes, 0..) |scope, index| {
        if (index > 0) try writer.writeByte(',');
        try std.json.Stringify.value(scope, .{}, writer);
    }
    try writer.writeAll("],\"endpoint\":");
    try std.json.Stringify.value(service.endpoint(), .{}, writer);
    try writer.writeAll(",\"connectedAt\":");
    try std.json.Stringify.value(connection.connected_at, .{}, writer);
    try writer.writeByte('}');
}

fn path(allocator: std.mem.Allocator, data_dir: []const u8) ![]u8 {
    return std.fs.path.join(allocator, &.{ data_dir, "google-account.json" });
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string or value.string.len == 0 or value.string.len > max_field_bytes) return null;
    return value.string;
}
