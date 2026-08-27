const std = @import("std");
const provider_settings = @import("store.zig");
const studio_settings = @import("../system/settings/service.zig");

const max_field_bytes = 16 * 1024;

pub fn listPayload(allocator: std.mem.Allocator, io: std.Io, state: *studio_settings.State, data_dir: []const u8) ![]u8 {
    try state.lockSettings(io);
    defer state.unlockSettings(io);
    var snapshot = try provider_settings.load(allocator, io, data_dir);
    defer snapshot.deinit();
    return viewsPayload(allocator, snapshot.providers);
}

pub fn createPayload(allocator: std.mem.Allocator, io: std.Io, state: *studio_settings.State, data_dir: []const u8, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidProviderPayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidProviderPayload;
    const object = parsed.value.object;
    const raw_id = requiredString(object, "id") orelse return error.ProviderIdRequired;
    const raw_name = requiredString(object, "name") orelse return error.ProviderNameRequired;
    const raw_base_url = requiredString(object, "base_url") orelse return error.ProviderBaseUrlRequired;
    const api_key_value = object.get("api_key");
    if (api_key_value != null and api_key_value.? != .string) return error.InvalidProviderPayload;
    const enabled_value = object.get("enabled");
    if (enabled_value != null and enabled_value.? != .bool) return error.InvalidProviderPayload;
    const protocol = try optionalProtocol(object, "protocol") orelse .auto;
    const id_trimmed = requiredTrimmed(raw_id) orelse return error.ProviderIdRequired;
    const name = requiredTrimmed(raw_name) orelse return error.ProviderNameRequired;
    const base_url = requiredTrimmed(raw_base_url) orelse return error.ProviderBaseUrlRequired;
    const id = try asciiLower(allocator, id_trimmed);
    defer allocator.free(id);
    const api_key = if (api_key_value) |value| std.mem.trim(u8, value.string, " \t\r\n") else "";
    try state.lockSettings(io);
    defer state.unlockSettings(io);
    var snapshot = try provider_settings.load(allocator, io, data_dir);
    defer snapshot.deinit();
    for (snapshot.providers) |provider| if (std.mem.eql(u8, provider.id, id)) return error.ProviderExists;
    var provider = try ownedProvider(allocator, id, name, base_url, api_key, if (enabled_value) |value| value.bool else true, protocol);
    var provider_transferred = false;
    defer if (!provider_transferred) provider.deinit();
    const previous_len = snapshot.providers.len;
    snapshot.providers = try allocator.realloc(snapshot.providers, previous_len + 1);
    snapshot.providers[previous_len] = provider;
    provider_transferred = true;
    try provider_settings.replace(allocator, io, data_dir, snapshot.providers);
    return mutationPayload(allocator, &snapshot.providers[previous_len]);
}

pub fn updatePayload(allocator: std.mem.Allocator, io: std.Io, state: *studio_settings.State, data_dir: []const u8, provider_id: []const u8, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidProviderPayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidProviderPayload;
    const object = parsed.value.object;
    const name_value = try optionalString(object, "name");
    const base_url_value = try optionalString(object, "base_url");
    const api_key_value = try optionalString(object, "api_key");
    const enabled_value = object.get("enabled");
    if (enabled_value != null and enabled_value.? != .bool) return error.InvalidProviderPayload;
    const protocol = try optionalProtocol(object, "protocol");
    const name = if (name_value) |value| requiredTrimmed(value) orelse return error.ProviderNameRequired else null;
    const base_url = if (base_url_value) |value| requiredTrimmed(value) orelse return error.ProviderBaseUrlRequired else null;
    const api_key = if (api_key_value) |value| std.mem.trim(u8, value, " \t\r\n") else null;
    try state.lockSettings(io);
    defer state.unlockSettings(io);
    var snapshot = try provider_settings.load(allocator, io, data_dir);
    defer snapshot.deinit();
    const index = providerIndex(snapshot.providers, provider_id) orelse return error.ProviderNotFound;
    var current = &snapshot.providers[index];
    if (name) |value| try replaceString(allocator, &current.name, value);
    if (base_url) |value| try replaceString(allocator, &current.base_url, value);
    if (api_key) |value| try replaceString(allocator, &current.api_key, value);
    if (enabled_value) |value| current.enabled = value.bool;
    if (protocol) |value| current.protocol = value;
    try provider_settings.replace(allocator, io, data_dir, snapshot.providers);
    return mutationPayload(allocator, current);
}

pub fn deletePayload(allocator: std.mem.Allocator, io: std.Io, state: *studio_settings.State, data_dir: []const u8, provider_id: []const u8) ![]u8 {
    try state.lockSettings(io);
    defer state.unlockSettings(io);
    var snapshot = try provider_settings.load(allocator, io, data_dir);
    defer snapshot.deinit();
    const index = providerIndex(snapshot.providers, provider_id) orelse return error.ProviderNotFound;
    const replacement = try allocator.alloc(provider_settings.Provider, snapshot.providers.len - 1);
    errdefer allocator.free(replacement);
    @memcpy(replacement[0..index], snapshot.providers[0..index]);
    @memcpy(replacement[index..], snapshot.providers[index + 1 ..]);
    snapshot.providers[index].deinit();
    allocator.free(snapshot.providers);
    snapshot.providers = replacement;
    try provider_settings.replace(allocator, io, data_dir, snapshot.providers);
    return allocator.dupe(u8, "{\"success\":true}");
}

pub fn loadSnapshot(allocator: std.mem.Allocator, io: std.Io, state: *studio_settings.State, data_dir: []const u8) !provider_settings.Snapshot {
    try state.lockSettings(io);
    defer state.unlockSettings(io);
    return provider_settings.load(allocator, io, data_dir);
}

fn viewsPayload(allocator: std.mem.Allocator, providers: []const provider_settings.Provider) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"providers\":[");
    for (providers, 0..) |*provider, index| {
        if (index > 0) try output.writer.writeByte(',');
        try writeView(&output.writer, provider);
    }
    try output.writer.writeAll("]}");
    return output.toOwnedSlice();
}

fn mutationPayload(allocator: std.mem.Allocator, provider: *const provider_settings.Provider) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"success\":true,\"provider\":");
    try writeView(&output.writer, provider);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn writeView(writer: *std.Io.Writer, provider: *const provider_settings.Provider) !void {
    try writer.writeAll("{\"id\":");
    try std.json.Stringify.value(provider.id, .{}, writer);
    try writer.writeAll(",\"name\":");
    try std.json.Stringify.value(provider.name, .{}, writer);
    try writer.writeAll(",\"base_url\":");
    try std.json.Stringify.value(provider.base_url, .{}, writer);
    try writer.print(",\"enabled\":{},\"has_api_key\":{},\"protocol\":\"{t}\"}}", .{ provider.enabled, provider.api_key.len > 0, provider.protocol });
}

fn ownedProvider(allocator: std.mem.Allocator, id: []const u8, name: []const u8, base_url: []const u8, api_key: []const u8, enabled: bool, protocol: provider_settings.Protocol) !provider_settings.Provider {
    const id_copy = try allocator.dupe(u8, id);
    errdefer allocator.free(id_copy);
    const name_copy = try allocator.dupe(u8, name);
    errdefer allocator.free(name_copy);
    const base_url_copy = try allocator.dupe(u8, base_url);
    errdefer allocator.free(base_url_copy);
    const api_key_copy = try allocator.dupe(u8, api_key);
    return .{ .allocator = allocator, .id = id_copy, .name = name_copy, .base_url = base_url_copy, .api_key = api_key_copy, .enabled = enabled, .protocol = protocol };
}

fn requiredString(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string or value.string.len > max_field_bytes) return null;
    return value.string;
}

fn optionalString(object: std.json.ObjectMap, name: []const u8) !?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string or value.string.len > max_field_bytes) return error.InvalidProviderPayload;
    return value.string;
}

fn optionalProtocol(object: std.json.ObjectMap, name: []const u8) !?provider_settings.Protocol {
    const value = object.get(name) orelse return null;
    if (value != .string) return error.InvalidProviderPayload;
    return provider_settings.Protocol.parse(value.string) orelse error.InvalidProviderPayload;
}

fn requiredTrimmed(value: []const u8) ?[]const u8 {
    const trimmed = std.mem.trim(u8, value, " \t\r\n");
    return if (trimmed.len > 0) trimmed else null;
}

fn asciiLower(allocator: std.mem.Allocator, value: []const u8) ![]u8 {
    const lowered = try allocator.dupe(u8, value);
    for (lowered) |*character| character.* = std.ascii.toLower(character.*);
    return lowered;
}

fn providerIndex(providers: []const provider_settings.Provider, id: []const u8) ?usize {
    for (providers, 0..) |provider, index| if (std.mem.eql(u8, provider.id, id)) return index;
    return null;
}

fn replaceString(allocator: std.mem.Allocator, current: *[]u8, value: []const u8) !void {
    const replacement = try allocator.dupe(u8, value);
    allocator.free(current.*);
    current.* = replacement;
}
