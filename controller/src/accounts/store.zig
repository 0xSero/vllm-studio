const std = @import("std");

const max_document_bytes = 16 * 1024 * 1024;
const max_field_bytes = 512 * 1024;

pub const Account = struct {
    allocator: std.mem.Allocator,
    id: []u8,
    provider: []u8,
    subject: []u8,
    label: []u8,
    credential_kind: []u8,
    configuration_json: []u8,
    secret_provider: []u8,
    secret_ref: []u8,
    connected_at: []u8,

    pub fn deinit(account: *Account) void {
        account.allocator.free(account.id);
        account.allocator.free(account.provider);
        account.allocator.free(account.subject);
        account.allocator.free(account.label);
        account.allocator.free(account.credential_kind);
        account.allocator.free(account.configuration_json);
        account.allocator.free(account.secret_provider);
        account.allocator.free(account.secret_ref);
        account.allocator.free(account.connected_at);
        account.* = undefined;
    }
};

pub const Store = struct {
    allocator: std.mem.Allocator,
    secret_provider: []u8,
    accounts: std.ArrayList(Account) = .empty,

    pub fn deinit(store: *Store) void {
        for (store.accounts.items) |*account| account.deinit();
        store.accounts.deinit(store.allocator);
        store.allocator.free(store.secret_provider);
        store.* = undefined;
    }

    pub fn find(store: *Store, id: []const u8) ?*Account {
        for (store.accounts.items) |*account| if (std.mem.eql(u8, account.id, id)) return account;
        return null;
    }
};

pub fn load(allocator: std.mem.Allocator, io: std.Io, data_dir: []const u8) !Store {
    const file_path = try path(allocator, data_dir);
    defer allocator.free(file_path);
    const document = std.Io.Dir.cwd().readFileAlloc(io, file_path, allocator, .limited(max_document_bytes)) catch |failure| switch (failure) {
        error.FileNotFound => return .{ .allocator = allocator, .secret_provider = try allocator.dupe(u8, "keyring") },
        else => return failure,
    };
    defer allocator.free(document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidAccountStore;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidAccountStore;
    const configured_provider = if (parsed.value.object.get("secretProvider")) |value|
        if (value == .string and value.string.len > 0 and value.string.len <= 512)
            value.string
        else
            "keyring"
    else
        "keyring";
    var store = Store{ .allocator = allocator, .secret_provider = try allocator.dupe(u8, configured_provider) };
    errdefer store.deinit();
    const accounts = parsed.value.object.get("accounts") orelse return store;
    if (accounts != .array or accounts.array.items.len > 10_000) return error.InvalidAccountStore;
    for (accounts.array.items) |value| {
        if (value != .object) return error.InvalidAccountStore;
        const object = value.object;
        try store.accounts.append(allocator, .{
            .allocator = allocator,
            .id = try dupeField(allocator, object, "id"),
            .provider = try dupeField(allocator, object, "provider"),
            .subject = try dupeField(allocator, object, "subject"),
            .label = try dupeField(allocator, object, "label"),
            .credential_kind = try dupeField(allocator, object, "credentialKind"),
            .configuration_json = if (object.get("configuration")) |configuration| try stringifyField(allocator, configuration) else try allocator.dupe(u8, "{}"),
            .secret_provider = try dupeField(allocator, object, "secretProvider"),
            .secret_ref = try dupeField(allocator, object, "secretRef"),
            .connected_at = try dupeField(allocator, object, "connectedAt"),
        });
    }
    return store;
}

pub fn save(allocator: std.mem.Allocator, io: std.Io, data_dir: []const u8, store: *const Store) !void {
    const file_path = try path(allocator, data_dir);
    defer allocator.free(file_path);
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try output.writer.writeAll("{\"version\":2,\"secretProvider\":");
    try std.json.Stringify.value(store.secret_provider, .{}, &output.writer);
    try output.writer.writeAll(",\"accounts\":[");
    for (store.accounts.items, 0..) |account, index| {
        if (index > 0) try output.writer.writeByte(',');
        try output.writer.writeAll("{\"id\":");
        try std.json.Stringify.value(account.id, .{}, &output.writer);
        try output.writer.writeAll(",\"provider\":");
        try std.json.Stringify.value(account.provider, .{}, &output.writer);
        try output.writer.writeAll(",\"subject\":");
        try std.json.Stringify.value(account.subject, .{}, &output.writer);
        try output.writer.writeAll(",\"label\":");
        try std.json.Stringify.value(account.label, .{}, &output.writer);
        try output.writer.writeAll(",\"credentialKind\":");
        try std.json.Stringify.value(account.credential_kind, .{}, &output.writer);
        try output.writer.writeAll(",\"configuration\":");
        try output.writer.writeAll(account.configuration_json);
        try output.writer.writeAll(",\"secretProvider\":");
        try std.json.Stringify.value(account.secret_provider, .{}, &output.writer);
        try output.writer.writeAll(",\"secretRef\":");
        try std.json.Stringify.value(account.secret_ref, .{}, &output.writer);
        try output.writer.writeAll(",\"connectedAt\":");
        try std.json.Stringify.value(account.connected_at, .{}, &output.writer);
        try output.writer.writeByte('}');
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
    try syncManifest(allocator, io, data_dir, store);
}

pub fn accountId(provider: []const u8, subject: []const u8, secret: []const u8) [12]u8 {
    var hash = std.crypto.hash.sha2.Sha256.init(.{});
    hash.update(provider);
    hash.update(&.{0});
    hash.update(subject);
    hash.update(&.{0});
    hash.update(secret);
    var digest: [32]u8 = undefined;
    hash.final(&digest);
    return std.fmt.bytesToHex(digest[0..6].*, .lower);
}

pub fn validId(value: []const u8) bool {
    if (value.len != 12) return false;
    for (value) |byte| if (!std.ascii.isHex(byte) or std.ascii.isUpper(byte)) return false;
    return true;
}

pub fn setSecret(allocator: std.mem.Allocator, io: std.Io, environment: *const std.process.Environ.Map, data_dir: []const u8, store: *const Store, secret_ref: []const u8, provider: []const u8, value: []const u8) !void {
    try syncManifest(allocator, io, data_dir, store);
    const executable = try resolveSecretSpec(allocator, io, environment);
    defer allocator.free(executable);
    const manifest = try manifestPath(allocator, data_dir);
    defer allocator.free(manifest);
    var child = try std.process.spawn(io, .{
        .argv = &.{ executable, "set", secret_ref, "--file", manifest, "--provider", provider, "--reason", "Connect a Local Studio account" },
        .environ_map = environment,
        .stdin = .pipe,
        .stdout = .ignore,
        .stderr = .ignore,
        .pgid = 0,
    });
    defer child.kill(io);
    try child.stdin.?.writeStreamingAll(io, value);
    try child.stdin.?.writeStreamingAll(io, "\n");
    child.stdin.?.close(io);
    child.stdin = null;
    const term = try child.wait(io);
    const ok = switch (term) {
        .exited => |code| code == 0,
        else => false,
    };
    if (!ok) return error.SecretStoreWriteFailed;
}

pub fn deleteSecret(allocator: std.mem.Allocator, io: std.Io, environment: *const std.process.Environ.Map, data_dir: []const u8, store: *const Store, secret_ref: []const u8, provider: []const u8) !void {
    try syncManifest(allocator, io, data_dir, store);
    const executable = try resolveSecretSpec(allocator, io, environment);
    defer allocator.free(executable);
    const manifest = try manifestPath(allocator, data_dir);
    defer allocator.free(manifest);
    const result = try std.process.run(allocator, io, .{
        .argv = &.{ executable, "delete", secret_ref, "--file", manifest, "--provider", provider, "--reason", "Disconnect a Local Studio account" },
        .environ_map = environment,
        .stdout_limit = .limited(64 * 1024),
        .stderr_limit = .limited(64 * 1024),
    });
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    const ok = switch (result.term) {
        .exited => |code| code == 0,
        else => false,
    };
    if (!ok) return error.SecretStoreDeleteFailed;
}

pub fn migrateSecretProvider(allocator: std.mem.Allocator, io: std.Io, environment: *const std.process.Environ.Map, data_dir: []const u8, store: *Store, provider: []const u8) !void {
    if (std.mem.eql(u8, store.secret_provider, provider)) return;
    var values: std.ArrayList([]u8) = .empty;
    defer {
        for (values.items) |value| allocator.free(value);
        values.deinit(allocator);
    }
    for (store.accounts.items) |account| {
        try values.append(allocator, try resolveSecret(allocator, io, environment, data_dir, store, account.secret_ref, account.secret_provider));
    }
    for (store.accounts.items, values.items) |account, value| {
        try setSecret(allocator, io, environment, data_dir, store, account.secret_ref, provider, value);
    }
    for (store.accounts.items) |*account| {
        if (!std.mem.eql(u8, account.secret_provider, provider)) {
            deleteSecret(allocator, io, environment, data_dir, store, account.secret_ref, account.secret_provider) catch {};
            allocator.free(account.secret_provider);
            account.secret_provider = try allocator.dupe(u8, provider);
        }
    }
    allocator.free(store.secret_provider);
    store.secret_provider = try allocator.dupe(u8, provider);
    try save(allocator, io, data_dir, store);
}

pub fn injectEnvironment(allocator: std.mem.Allocator, io: std.Io, data_dir: []const u8, connector: std.json.ObjectMap, base_environment: *const std.process.Environ.Map, environment: *std.process.Environ.Map) !void {
    const auth = connector.get("auth") orelse return;
    if (auth != .object) return;
    const provider = stringField(auth.object, "provider") orelse return;
    if (!std.mem.eql(u8, provider, "code-storage")) return;
    const account_id = stringField(auth.object, "account") orelse return error.AccountIdRequired;
    var store = try load(allocator, io, data_dir);
    defer store.deinit();
    const account = store.find(account_id) orelse return error.AccountNotFound;
    if (!std.mem.eql(u8, account.credential_kind, "pkcs8-pem")) return error.InvalidAccountCredential;
    const secret = try resolveSecret(allocator, io, base_environment, data_dir, &store, account.secret_ref, account.secret_provider);
    defer allocator.free(secret);
    try environment.put("CODE_STORAGE_ORGANIZATION", account.subject);
    try environment.put("CODE_STORAGE_PRIVATE_KEY", secret);
    try environment.put("CODE_STORAGE_ACCOUNT_ID", account.id);
}

fn path(allocator: std.mem.Allocator, data_dir: []const u8) ![]u8 {
    return std.fs.path.join(allocator, &.{ data_dir, "accounts", "accounts.json" });
}

fn manifestPath(allocator: std.mem.Allocator, data_dir: []const u8) ![]u8 {
    return std.fs.path.join(allocator, &.{ data_dir, "accounts", "secretspec.toml" });
}

fn syncManifest(allocator: std.mem.Allocator, io: std.Io, data_dir: []const u8, store: *const Store) !void {
    const manifest = try manifestPath(allocator, data_dir);
    defer allocator.free(manifest);
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try output.writer.writeAll("[project]\nname = \"local-studio-accounts\"\nrevision = \"1.0\"\n\n[profiles.default]\n");
    for (store.accounts.items) |account| {
        try output.writer.writeAll(account.secret_ref);
        try output.writer.writeAll(" = { description = \"Local Studio account credential\", required = true, type = \"password\" }\n");
    }
    var atomic_file = try std.Io.Dir.cwd().createFileAtomic(io, manifest, .{
        .permissions = @enumFromInt(0o600),
        .make_path = true,
        .replace = true,
    });
    defer atomic_file.deinit(io);
    try atomic_file.file.writeStreamingAll(io, output.writer.buffered());
    try atomic_file.file.sync(io);
    try atomic_file.replace(io);
}

pub fn resolveSecret(allocator: std.mem.Allocator, io: std.Io, environment: *const std.process.Environ.Map, data_dir: []const u8, store: *const Store, secret_ref: []const u8, provider: []const u8) ![]u8 {
    try syncManifest(allocator, io, data_dir, store);
    const executable = try resolveSecretSpec(allocator, io, environment);
    defer allocator.free(executable);
    const manifest = try manifestPath(allocator, data_dir);
    defer allocator.free(manifest);
    const result = try std.process.run(allocator, io, .{
        .argv = &.{ executable, "get", secret_ref, "--file", manifest, "--provider", provider, "--reason", "Start an authenticated Local Studio connector" },
        .environ_map = environment,
        .stdout_limit = .limited(max_field_bytes),
        .stderr_limit = .limited(64 * 1024),
    });
    defer allocator.free(result.stderr);
    const ok = switch (result.term) {
        .exited => |code| code == 0,
        else => false,
    };
    if (!ok) {
        allocator.free(result.stdout);
        return error.SecretStoreReadFailed;
    }
    const value = std.mem.trim(u8, result.stdout, " \t\r\n");
    const copy = try allocator.dupe(u8, value);
    allocator.free(result.stdout);
    return copy;
}

fn resolveSecretSpec(allocator: std.mem.Allocator, io: std.Io, environment: *const std.process.Environ.Map) ![]u8 {
    if (environment.get("LOCAL_STUDIO_SECRETSPEC_BIN")) |configured| {
        const value = std.mem.trim(u8, configured, " \t\r\n");
        if (value.len > 0 and std.fs.path.isAbsolute(value)) return allocator.dupe(u8, value);
    }
    const executable = try std.process.executablePathAlloc(io, allocator);
    defer allocator.free(executable);
    const sibling = try std.fs.path.join(allocator, &.{ std.fs.path.dirname(executable) orelse ".", if (@import("builtin").os.tag == .windows) "secretspec.exe" else "secretspec" });
    const sibling_status = std.Io.Dir.cwd().statFile(io, sibling, .{}) catch null;
    if (sibling_status) |status| if (status.kind == .file) return sibling;
    allocator.free(sibling);
    const path_value = environment.get("PATH") orelse return error.SecretSpecUnavailable;
    var paths = std.mem.splitScalar(u8, path_value, std.fs.path.delimiter);
    while (paths.next()) |directory| {
        if (directory.len == 0) continue;
        const candidate = try std.fs.path.join(allocator, &.{ directory, if (@import("builtin").os.tag == .windows) "secretspec.exe" else "secretspec" });
        const status = std.Io.Dir.cwd().statFile(io, candidate, .{}) catch {
            allocator.free(candidate);
            continue;
        };
        if (status.kind == .file) return candidate;
        allocator.free(candidate);
    }
    return error.SecretSpecUnavailable;
}

fn dupeField(allocator: std.mem.Allocator, object: std.json.ObjectMap, name: []const u8) ![]u8 {
    return allocator.dupe(u8, stringField(object, name) orelse return error.InvalidAccountStore);
}

fn stringifyField(allocator: std.mem.Allocator, value: std.json.Value) ![]u8 {
    if (value != .object) return error.InvalidAccountStore;
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(value, .{}, &output.writer);
    return output.toOwnedSlice();
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string or value.string.len == 0 or value.string.len > max_field_bytes) return null;
    return value.string;
}
