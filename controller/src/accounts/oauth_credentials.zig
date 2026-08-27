const std = @import("std");

const max_document_bytes = 1024 * 1024;
const max_token_bytes = 256 * 1024;

pub const Credential = struct {
    allocator: std.mem.Allocator,
    access: []u8,
    refresh: []u8,
    account_id: []u8,
    expires_at_ms: i64,

    pub fn deinit(credential: *Credential) void {
        credential.allocator.free(credential.access);
        credential.allocator.free(credential.refresh);
        credential.allocator.free(credential.account_id);
        credential.* = undefined;
    }
};

pub fn load(allocator: std.mem.Allocator, io: std.Io, data_dir: []const u8, provider_id: []const u8) !?Credential {
    const credential_path = try path(allocator, data_dir, provider_id);
    defer allocator.free(credential_path);
    const document = std.Io.Dir.cwd().readFileAlloc(io, credential_path, allocator, .limited(max_document_bytes)) catch |failure| switch (failure) {
        error.FileNotFound => return null,
        else => return failure,
    };
    defer allocator.free(document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return null;
    defer parsed.deinit();
    if (parsed.value != .object) return null;
    const access = stringField(parsed.value.object, "access") orelse return null;
    const refresh = stringField(parsed.value.object, "refresh") orelse return null;
    const account_id = stringField(parsed.value.object, "account_id") orelse return null;
    const expires = parsed.value.object.get("expires_at_ms") orelse return null;
    if (expires != .integer or expires.integer <= 0) return null;
    const access_copy = try allocator.dupe(u8, access);
    errdefer allocator.free(access_copy);
    const refresh_copy = try allocator.dupe(u8, refresh);
    errdefer allocator.free(refresh_copy);
    const account_copy = try allocator.dupe(u8, account_id);
    return .{
        .allocator = allocator,
        .access = access_copy,
        .refresh = refresh_copy,
        .account_id = account_copy,
        .expires_at_ms = expires.integer,
    };
}

pub fn save(allocator: std.mem.Allocator, io: std.Io, data_dir: []const u8, provider_id: []const u8, credential: *const Credential) !void {
    if (credential.access.len == 0 or credential.refresh.len == 0 or credential.account_id.len == 0) return error.InvalidCredential;
    if (credential.access.len > max_token_bytes or credential.refresh.len > max_token_bytes or credential.account_id.len > max_token_bytes) return error.CredentialTooLarge;
    const credential_path = try path(allocator, data_dir, provider_id);
    defer allocator.free(credential_path);
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try output.writer.writeAll("{\"type\":\"oauth\",\"access\":");
    try std.json.Stringify.value(credential.access, .{}, &output.writer);
    try output.writer.writeAll(",\"refresh\":");
    try std.json.Stringify.value(credential.refresh, .{}, &output.writer);
    try output.writer.writeAll(",\"account_id\":");
    try std.json.Stringify.value(credential.account_id, .{}, &output.writer);
    try output.writer.print(",\"expires_at_ms\":{d}}}", .{credential.expires_at_ms});
    var atomic_file = try std.Io.Dir.cwd().createFileAtomic(io, credential_path, .{
        .permissions = @enumFromInt(0o600),
        .make_path = true,
        .replace = true,
    });
    defer atomic_file.deinit(io);
    try atomic_file.file.writeStreamingAll(io, output.writer.buffered());
    try atomic_file.file.sync(io);
    try atomic_file.replace(io);
    const directory = std.fs.path.dirname(credential_path) orelse data_dir;
    const directory_z = try allocator.dupeZ(u8, directory);
    defer allocator.free(directory_z);
    _ = std.c.chmod(directory_z.ptr, 0o700);
}

pub fn remove(allocator: std.mem.Allocator, io: std.Io, data_dir: []const u8, provider_id: []const u8) !void {
    const credential_path = try path(allocator, data_dir, provider_id);
    defer allocator.free(credential_path);
    std.Io.Dir.cwd().deleteFile(io, credential_path) catch |failure| switch (failure) {
        error.FileNotFound => {},
        else => return failure,
    };
}

fn path(allocator: std.mem.Allocator, data_dir: []const u8, provider_id: []const u8) ![]u8 {
    if (!validProviderId(provider_id)) return error.InvalidProviderId;
    const filename = try std.fmt.allocPrint(allocator, "{s}.json", .{provider_id});
    defer allocator.free(filename);
    return std.fs.path.join(allocator, &.{ data_dir, "credentials", filename });
}

fn validProviderId(value: []const u8) bool {
    if (value.len == 0 or value.len > 128) return false;
    for (value) |byte| if (!std.ascii.isAlphanumeric(byte) and byte != '-' and byte != '_') return false;
    return true;
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string or value.string.len == 0 or value.string.len > max_token_bytes) return null;
    return value.string;
}
