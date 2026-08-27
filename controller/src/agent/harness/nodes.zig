const std = @import("std");
const credentials = @import("../../topology/credential_store.zig");
const rigs = @import("../../topology/rig_store.zig");
const sqlite = @import("../../storage/sqlite.zig");

const Io = std.Io;

pub const Target = struct {
    allocator: std.mem.Allocator,
    id: []u8,
    name: []u8,
    address: []u8,
    api_key: []u8,
    harness_version: ?[]u8,
    capabilities_json: []u8,

    pub fn deinit(target: *Target) void {
        target.allocator.free(target.id);
        target.allocator.free(target.name);
        target.allocator.free(target.address);
        target.allocator.free(target.api_key);
        if (target.harness_version) |value| target.allocator.free(value);
        target.allocator.free(target.capabilities_json);
        target.* = undefined;
    }
};

pub fn select(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, harness: []const u8, preferred_node_id: ?[]const u8) !?Target {
    try database.lock(io);
    defer database.unlock(io);
    var documents = try rigs.list(allocator, database);
    defer documents.deinit();
    var fallback: ?Target = null;
    errdefer if (fallback) |*target| target.deinit();
    for (documents.items()) |document| {
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch continue;
        defer parsed.deinit();
        if (parsed.value != .object) continue;
        const nodes = parsed.value.object.get("nodes") orelse continue;
        if (nodes != .array) continue;
        for (nodes.array.items) |node| {
            if (!supportsHarness(node, harness)) continue;
            const id = stringField(node.object, "id") orelse continue;
            if (std.mem.eql(u8, id, "local")) continue;
            const address = nullableStringField(node.object, "address") orelse continue;
            const name = stringField(node.object, "name") orelse id;
            var target = try makeTarget(allocator, database, id, name, address, node.object, harness);
            if (preferred_node_id) |preferred| {
                if (std.mem.eql(u8, preferred, id)) {
                    if (fallback) |*existing| existing.deinit();
                    return target;
                }
                target.deinit();
                continue;
            }
            if (fallback == null) fallback = target else target.deinit();
        }
    }
    return fallback;
}

pub fn selectCapability(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, capability: []const u8, preferred_node_id: ?[]const u8) !?Target {
    try database.lock(io);
    defer database.unlock(io);
    var documents = try rigs.list(allocator, database);
    defer documents.deinit();
    var fallback: ?Target = null;
    errdefer if (fallback) |*target| target.deinit();
    for (documents.items()) |document| {
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch continue;
        defer parsed.deinit();
        if (parsed.value != .object) continue;
        const nodes = parsed.value.object.get("nodes") orelse continue;
        if (nodes != .array) continue;
        for (nodes.array.items) |node| {
            if (!supportsCapability(node, capability)) continue;
            const id = stringField(node.object, "id") orelse continue;
            if (std.mem.eql(u8, id, "local")) continue;
            const address = nullableStringField(node.object, "address") orelse continue;
            const name = stringField(node.object, "name") orelse id;
            var target = try makeTarget(allocator, database, id, name, address, node.object, "");
            if (preferred_node_id) |preferred| {
                if (std.mem.eql(u8, preferred, id)) {
                    if (fallback) |*existing| existing.deinit();
                    return target;
                }
                target.deinit();
                continue;
            }
            if (fallback == null) fallback = target else target.deinit();
        }
    }
    return fallback;
}

pub fn count(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, harness: []const u8) !usize {
    try database.lock(io);
    defer database.unlock(io);
    var documents = try rigs.list(allocator, database);
    defer documents.deinit();
    var total: usize = 0;
    for (documents.items()) |document| {
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch continue;
        defer parsed.deinit();
        if (parsed.value != .object) continue;
        const nodes = parsed.value.object.get("nodes") orelse continue;
        if (nodes != .array) continue;
        for (nodes.array.items) |node| {
            if (!supportsHarness(node, harness)) continue;
            const id = stringField(node.object, "id") orelse continue;
            if (std.mem.eql(u8, id, "local")) continue;
            if (nullableStringField(node.object, "address") != null) total += 1;
        }
    }
    return total;
}

pub fn countCapability(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, capability: []const u8) !usize {
    try database.lock(io);
    defer database.unlock(io);
    var documents = try rigs.list(allocator, database);
    defer documents.deinit();
    var total: usize = 0;
    for (documents.items()) |document| {
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch continue;
        defer parsed.deinit();
        if (parsed.value != .object) continue;
        const nodes = parsed.value.object.get("nodes") orelse continue;
        if (nodes != .array) continue;
        for (nodes.array.items) |node| {
            if (!supportsCapability(node, capability)) continue;
            const id = stringField(node.object, "id") orelse continue;
            if (std.mem.eql(u8, id, "local")) continue;
            if (nullableStringField(node.object, "address") != null) total += 1;
        }
    }
    return total;
}

fn supportsHarness(node: std.json.Value, harness: []const u8) bool {
    if (node != .object) return false;
    const capabilities = node.object.get("capabilities") orelse return false;
    if (capabilities != .object) return false;
    const configured = capabilities.object.get("harnesses") orelse return false;
    if (configured != .array) return false;
    for (configured.array.items) |entry| {
        if (entry == .string and std.mem.eql(u8, entry.string, harness)) return true;
    }
    return false;
}

fn supportsCapability(node: std.json.Value, capability: []const u8) bool {
    if (node != .object) return false;
    const capabilities = node.object.get("capabilities") orelse return false;
    if (capabilities != .object) return false;
    const value = capabilities.object.get(capability) orelse return false;
    return value == .bool and value.bool;
}

fn makeTarget(allocator: std.mem.Allocator, database: *sqlite.Database, id: []const u8, name: []const u8, address: []const u8, node: std.json.ObjectMap, harness: []const u8) !Target {
    const owned_id = try allocator.dupe(u8, id);
    errdefer allocator.free(owned_id);
    const owned_name = try allocator.dupe(u8, name);
    errdefer allocator.free(owned_name);
    const normalized_address = try normalizeAddress(allocator, address);
    errdefer allocator.free(normalized_address);
    const details = try harnessDetails(allocator, node, harness);
    errdefer {
        if (details.version) |value| allocator.free(value);
        allocator.free(details.capabilities_json);
    }
    return .{
        .allocator = allocator,
        .id = owned_id,
        .name = owned_name,
        .address = normalized_address,
        .api_key = try credentials.get(allocator, database, id),
        .harness_version = details.version,
        .capabilities_json = details.capabilities_json,
    };
}

const HarnessDetails = struct {
    version: ?[]u8,
    capabilities_json: []u8,
};

fn harnessDetails(allocator: std.mem.Allocator, node: std.json.ObjectMap, harness: []const u8) !HarnessDetails {
    const capabilities = node.get("capabilities") orelse return emptyHarnessDetails(allocator);
    if (capabilities != .object) return emptyHarnessDetails(allocator);
    const details = capabilities.object.get("harnessDetails") orelse return emptyHarnessDetails(allocator);
    if (details != .array) return emptyHarnessDetails(allocator);
    for (details.array.items) |entry| {
        if (entry != .object) continue;
        const id = stringField(entry.object, "id") orelse continue;
        if (!std.mem.eql(u8, id, harness)) continue;
        const version = if (nullableStringField(entry.object, "version")) |value| try allocator.dupe(u8, value) else null;
        errdefer if (version) |value| allocator.free(value);
        const advertised = entry.object.get("capabilities") orelse return .{ .version = version, .capabilities_json = try allocator.dupe(u8, "[]") };
        var output: Io.Writer.Allocating = .init(allocator);
        errdefer output.deinit();
        try std.json.Stringify.value(advertised, .{}, &output.writer);
        return .{ .version = version, .capabilities_json = try output.toOwnedSlice() };
    }
    return emptyHarnessDetails(allocator);
}

fn emptyHarnessDetails(allocator: std.mem.Allocator) !HarnessDetails {
    return .{ .version = null, .capabilities_json = try allocator.dupe(u8, "[]") };
}

fn normalizeAddress(allocator: std.mem.Allocator, address: []const u8) ![]u8 {
    const trimmed = std.mem.trim(u8, address, " \t\r\n");
    if (trimmed.len == 0) return error.InvalidHarnessAddress;
    const candidate = if (std.ascii.startsWithIgnoreCase(trimmed, "http://") or std.ascii.startsWithIgnoreCase(trimmed, "https://"))
        try allocator.dupe(u8, trimmed)
    else
        try std.fmt.allocPrint(allocator, "http://{s}", .{trimmed});
    defer allocator.free(candidate);
    const uri = std.Uri.parse(candidate) catch return error.InvalidHarnessAddress;
    if (!std.ascii.eqlIgnoreCase(uri.scheme, "http") and !std.ascii.eqlIgnoreCase(uri.scheme, "https")) return error.InvalidHarnessAddress;
    const host = uri.host orelse return error.InvalidHarnessAddress;
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    const scheme = if (std.ascii.eqlIgnoreCase(uri.scheme, "https")) "https" else "http";
    try output.writer.print("{s}://", .{scheme});
    try host.formatHost(&output.writer);
    if (uri.port) |port| {
        if ((std.mem.eql(u8, scheme, "http") and port != 80) or (std.mem.eql(u8, scheme, "https") and port != 443)) {
            try output.writer.print(":{d}", .{port});
        }
    }
    return try output.toOwnedSlice();
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len > 0) trimmed else null;
}

fn nullableStringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value == .null) return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len > 0) trimmed else null;
}
