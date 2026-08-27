const std = @import("std");
const studio_settings = @import("../system/settings/studio_store.zig");

const max_document_bytes = 1024 * 1024;
const max_providers = 1024;
const max_field_bytes = 16 * 1024;

pub const Protocol = enum {
    auto,
    chat_completions,
    responses,

    pub fn parse(value: []const u8) ?Protocol {
        return std.meta.stringToEnum(Protocol, value);
    }
};

pub const Provider = struct {
    allocator: std.mem.Allocator,
    id: []u8,
    name: []u8,
    base_url: []u8,
    api_key: []u8,
    enabled: bool,
    protocol: Protocol,

    pub fn clone(provider: Provider, allocator: std.mem.Allocator) !Provider {
        const id = try allocator.dupe(u8, provider.id);
        errdefer allocator.free(id);
        const name = try allocator.dupe(u8, provider.name);
        errdefer allocator.free(name);
        const base_url = try allocator.dupe(u8, provider.base_url);
        errdefer allocator.free(base_url);
        const api_key = try allocator.dupe(u8, provider.api_key);
        return .{ .allocator = allocator, .id = id, .name = name, .base_url = base_url, .api_key = api_key, .enabled = provider.enabled, .protocol = provider.protocol };
    }

    pub fn deinit(provider: *Provider) void {
        provider.allocator.free(provider.id);
        provider.allocator.free(provider.name);
        provider.allocator.free(provider.base_url);
        provider.allocator.free(provider.api_key);
        provider.* = undefined;
    }
};

pub const Snapshot = struct {
    allocator: std.mem.Allocator,
    providers: []Provider,

    pub fn deinit(snapshot: *Snapshot) void {
        for (snapshot.providers) |*provider| provider.deinit();
        snapshot.allocator.free(snapshot.providers);
        snapshot.* = undefined;
    }
};

pub fn load(allocator: std.mem.Allocator, io: std.Io, data_dir: []const u8) !Snapshot {
    const settings_path = try studio_settings.path(allocator, data_dir);
    defer allocator.free(settings_path);
    const document = std.Io.Dir.cwd().readFileAlloc(io, settings_path, allocator, .limited(max_document_bytes)) catch |failure| switch (failure) {
        error.FileNotFound => return empty(allocator),
        else => return failure,
    };
    defer allocator.free(document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return empty(allocator);
    defer parsed.deinit();
    if (parsed.value != .object) return empty(allocator);
    const providers_value = parsed.value.object.get("providers") orelse return empty(allocator);
    if (providers_value != .array or providers_value.array.items.len > max_providers) return empty(allocator);
    var providers: std.ArrayList(Provider) = .empty;
    errdefer {
        for (providers.items) |*provider| provider.deinit();
        providers.deinit(allocator);
    }
    for (providers_value.array.items) |value| {
        const provider = try decode(allocator, value) orelse continue;
        try providers.append(allocator, provider);
    }
    return .{ .allocator = allocator, .providers = try providers.toOwnedSlice(allocator) };
}

pub fn replace(allocator: std.mem.Allocator, io: std.Io, data_dir: []const u8, providers: []const Provider) !void {
    if (providers.len > max_providers) return error.TooManyProviders;
    const settings_path = try studio_settings.path(allocator, data_dir);
    defer allocator.free(settings_path);
    const document = std.Io.Dir.cwd().readFileAlloc(io, settings_path, allocator, .limited(max_document_bytes)) catch |failure| switch (failure) {
        error.FileNotFound => null,
        else => return failure,
    };
    defer if (document) |value| allocator.free(value);
    var parsed = if (document) |value| std.json.parseFromSlice(std.json.Value, allocator, value, .{}) catch try emptyObject(allocator) else try emptyObject(allocator);
    defer parsed.deinit();
    if (parsed.value != .object) {
        parsed.deinit();
        parsed = try emptyObject(allocator);
    }
    const storage = parsed.arena.allocator();
    var array: std.json.Array = .init(storage);
    for (providers) |provider| {
        try validate(provider);
        var object: std.json.ObjectMap = .empty;
        try object.put(storage, "id", .{ .string = try storage.dupe(u8, provider.id) });
        try object.put(storage, "name", .{ .string = try storage.dupe(u8, provider.name) });
        try object.put(storage, "base_url", .{ .string = try storage.dupe(u8, provider.base_url) });
        try object.put(storage, "api_key", .{ .string = try storage.dupe(u8, provider.api_key) });
        try object.put(storage, "enabled", .{ .bool = provider.enabled });
        try object.put(storage, "protocol", .{ .string = @tagName(provider.protocol) });
        try array.append(.{ .object = object });
    }
    try parsed.value.object.put(storage, "providers", .{ .array = array });
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try std.json.Stringify.value(parsed.value, .{}, &output.writer);
    if (output.writer.buffered().len > max_document_bytes) return error.ProviderSettingsTooLarge;
    var atomic_file = try std.Io.Dir.cwd().createFileAtomic(io, settings_path, .{
        .permissions = @enumFromInt(0o600),
        .make_path = true,
        .replace = true,
    });
    defer atomic_file.deinit(io);
    try atomic_file.file.writeStreamingAll(io, output.writer.buffered());
    try atomic_file.file.sync(io);
    try atomic_file.replace(io);
    const data_dir_z = try allocator.dupeZ(u8, data_dir);
    defer allocator.free(data_dir_z);
    _ = std.c.chmod(data_dir_z.ptr, 0o700);
}

fn decode(allocator: std.mem.Allocator, value: std.json.Value) !?Provider {
    if (value != .object) return null;
    const id = validString(value.object.get("id")) orelse return null;
    const name = validString(value.object.get("name")) orelse return null;
    const base_url = validString(value.object.get("base_url")) orelse return null;
    const api_key = validString(value.object.get("api_key")) orelse return null;
    const enabled_value = value.object.get("enabled") orelse return null;
    if (enabled_value != .bool) return null;
    const protocol = if (value.object.get("protocol")) |protocol_value|
        if (protocol_value == .string) Protocol.parse(protocol_value.string) orelse return null else return null
    else
        .auto;
    const id_copy = try allocator.dupe(u8, id);
    errdefer allocator.free(id_copy);
    const name_copy = try allocator.dupe(u8, name);
    errdefer allocator.free(name_copy);
    const base_url_copy = try allocator.dupe(u8, base_url);
    errdefer allocator.free(base_url_copy);
    const api_key_copy = try allocator.dupe(u8, api_key);
    return .{ .allocator = allocator, .id = id_copy, .name = name_copy, .base_url = base_url_copy, .api_key = api_key_copy, .enabled = enabled_value.bool, .protocol = protocol };
}

fn validate(provider: Provider) !void {
    if (provider.id.len == 0 or provider.name.len == 0 or provider.base_url.len == 0) return error.InvalidProvider;
    if (provider.id.len > max_field_bytes or provider.name.len > max_field_bytes or provider.base_url.len > max_field_bytes or provider.api_key.len > max_field_bytes) return error.ProviderFieldTooLarge;
}

fn validString(value: ?std.json.Value) ?[]const u8 {
    const present = value orelse return null;
    if (present != .string or present.string.len > max_field_bytes) return null;
    return present.string;
}

fn empty(allocator: std.mem.Allocator) !Snapshot {
    return .{ .allocator = allocator, .providers = try allocator.alloc(Provider, 0) };
}

fn emptyObject(allocator: std.mem.Allocator) !std.json.Parsed(std.json.Value) {
    return std.json.parseFromSlice(std.json.Value, allocator, "{}", .{});
}
