const std = @import("std");
const credentials = @import("credential_store.zig");
const rigs = @import("rig_store.zig");
const sqlite = @import("../storage/sqlite.zig");

const Io = std.Io;
const rig_id = "enrolled-harnesses";

pub fn upsertPayload(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, document: []const u8) ![]u8 {
    var body = try parseObject(allocator, document);
    defer body.deinit();
    const object = body.value.object;
    const node_id = requiredString(object, "nodeId") orelse return error.EnrollmentNodeIdRequired;
    const name = requiredString(object, "name") orelse return error.EnrollmentNodeNameRequired;
    const address = requiredString(object, "address") orelse return error.EnrollmentNodeAddressRequired;
    const api_key = requiredString(object, "apiKey") orelse return error.EnrollmentNodeCredentialRequired;
    const role = requiredString(object, "role") orelse "standalone";
    if (!validNodeId(node_id)) return error.InvalidEnrollmentNodeId;
    if (!std.mem.eql(u8, role, "standalone") and !std.mem.eql(u8, role, "worker")) return error.InvalidEnrollmentRole;
    const normalized_address = try normalizeUrl(allocator, address);
    defer allocator.free(normalized_address);
    try database.lock(io);
    defer database.unlock(io);
    var rig = try loadRig(allocator, io, database);
    defer rig.deinit();
    const arena = rig.arena.allocator();
    const nodes = rig.value.object.getPtr("nodes") orelse return error.InvalidRigRecord;
    if (nodes.* != .array) return error.InvalidRigRecord;
    const node = try nodeValue(arena, object, node_id, name, normalized_address, role);
    var replaced = false;
    for (nodes.array.items) |*existing| {
        if (existing.* != .object) continue;
        const existing_id = requiredString(existing.object, "id") orelse continue;
        if (!std.mem.eql(u8, existing_id, node_id)) continue;
        existing.* = node;
        replaced = true;
        break;
    }
    if (!replaced) try nodes.array.append(node);
    try touch(arena, io, &rig.value);
    const updated = try serialize(allocator, rig.value);
    defer allocator.free(updated);
    try rigs.save(database, rig_id, updated);
    try credentials.save(database, node_id, api_key);
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"success\":true,\"nodeId\":");
    try std.json.Stringify.value(node_id, .{}, &output.writer);
    try output.writer.writeAll(",\"rig\":");
    try output.writer.writeAll(updated);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

pub fn deletePayload(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, node_id: []const u8) ![]u8 {
    if (!validNodeId(node_id)) return error.InvalidEnrollmentNodeId;
    try database.lock(io);
    defer database.unlock(io);
    const stored = (try rigs.get(allocator, database, rig_id)) orelse return error.EnrollmentNotFound;
    defer allocator.free(stored);
    var rig = try parseObject(allocator, stored);
    defer rig.deinit();
    const nodes = rig.value.object.getPtr("nodes") orelse return error.InvalidRigRecord;
    if (nodes.* != .array) return error.InvalidRigRecord;
    var index: ?usize = null;
    for (nodes.array.items, 0..) |node, candidate| {
        if (node != .object) continue;
        const id = requiredString(node.object, "id") orelse continue;
        if (std.mem.eql(u8, id, node_id)) {
            index = candidate;
            break;
        }
    }
    if (index == null) return error.EnrollmentNotFound;
    _ = nodes.array.orderedRemove(index.?);
    try touch(rig.arena.allocator(), io, &rig.value);
    const updated = try serialize(allocator, rig.value);
    defer allocator.free(updated);
    try rigs.save(database, rig_id, updated);
    try credentials.delete(database, node_id);
    return allocator.dupe(u8, "{\"success\":true}");
}

fn loadRig(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database) !std.json.Parsed(std.json.Value) {
    if (try rigs.get(allocator, database, rig_id)) |stored| {
        defer allocator.free(stored);
        return parseObject(allocator, stored);
    }
    var timestamp_buffer: [24]u8 = undefined;
    const timestamp = formatTimestamp(io, &timestamp_buffer);
    var output: Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try output.writer.writeAll("{\"id\":\"enrolled-harnesses\",\"name\":\"Enrolled harness nodes\",\"description\":\"Machines connected to this Head\",\"nodes\":[],\"created_at\":");
    try std.json.Stringify.value(timestamp, .{}, &output.writer);
    try output.writer.writeAll(",\"updated_at\":");
    try std.json.Stringify.value(timestamp, .{}, &output.writer);
    try output.writer.writeByte('}');
    return parseObject(allocator, output.writer.buffered());
}

fn nodeValue(allocator: std.mem.Allocator, body: std.json.ObjectMap, node_id: []const u8, name: []const u8, address: []const u8, role: []const u8) !std.json.Value {
    var node: std.json.ObjectMap = .empty;
    try node.put(allocator, "id", .{ .string = try allocator.dupe(u8, node_id) });
    try node.put(allocator, "name", .{ .string = try allocator.dupe(u8, name) });
    try node.put(allocator, "hardware_type", .{ .string = "custom" });
    try node.put(allocator, "role", .{ .string = try allocator.dupe(u8, role) });
    try node.put(allocator, "source", .{ .string = "enrolled" });
    try node.put(allocator, "hostname", try copyOptional(allocator, body, "hostname"));
    try node.put(allocator, "address", .{ .string = try allocator.dupe(u8, address) });
    try node.put(allocator, "os", try copyOptional(allocator, body, "os"));
    try node.put(allocator, "cpu_model", .null);
    try node.put(allocator, "cpu_cores", .null);
    try node.put(allocator, "memory_gb", .null);
    try node.put(allocator, "accelerators", .{ .array = .init(allocator) });
    try node.put(allocator, "notes", .null);
    try node.put(allocator, "capabilities", try capabilitiesValue(allocator, body.get("capabilities")));
    return .{ .object = node };
}

fn capabilitiesValue(allocator: std.mem.Allocator, value: ?std.json.Value) !std.json.Value {
    const source = value orelse return error.EnrollmentCapabilitiesRequired;
    if (source != .object) return error.InvalidEnrollmentCapabilities;
    const harnesses = source.object.get("harnesses") orelse return error.InvalidEnrollmentCapabilities;
    if (harnesses != .array) return error.InvalidEnrollmentCapabilities;
    var copied_harnesses: std.json.Array = .init(allocator);
    for (harnesses.array.items) |entry| {
        if (entry != .string or entry.string.len == 0 or entry.string.len > 64) return error.InvalidEnrollmentCapabilities;
        try copied_harnesses.append(.{ .string = try allocator.dupe(u8, entry.string) });
    }
    var capabilities: std.json.ObjectMap = .empty;
    for ([_][]const u8{ "compute", "mcp", "terminal", "browser" }) |name| {
        const entry = source.object.get(name) orelse return error.InvalidEnrollmentCapabilities;
        if (entry != .bool) return error.InvalidEnrollmentCapabilities;
        try capabilities.put(allocator, name, entry);
    }
    try capabilities.put(allocator, "harnesses", .{ .array = copied_harnesses });
    try capabilities.put(allocator, "harnessDetails", try harnessDetailsValue(allocator, source.object.get("harnessDetails")));
    return .{ .object = capabilities };
}

fn harnessDetailsValue(allocator: std.mem.Allocator, value: ?std.json.Value) !std.json.Value {
    const source = value orelse return .{ .array = .init(allocator) };
    if (source != .array or source.array.items.len > 16) return error.InvalidEnrollmentCapabilities;
    var details: std.json.Array = .init(allocator);
    for (source.array.items) |entry| {
        if (entry != .object) return error.InvalidEnrollmentCapabilities;
        const id = requiredString(entry.object, "id") orelse return error.InvalidEnrollmentCapabilities;
        if (id.len > 64) return error.InvalidEnrollmentCapabilities;
        const capabilities = entry.object.get("capabilities") orelse return error.InvalidEnrollmentCapabilities;
        if (capabilities != .array or capabilities.array.items.len > 64) return error.InvalidEnrollmentCapabilities;
        var copied_capabilities: std.json.Array = .init(allocator);
        for (capabilities.array.items) |capability| {
            if (capability != .string or capability.string.len == 0 or capability.string.len > 64) return error.InvalidEnrollmentCapabilities;
            try copied_capabilities.append(.{ .string = try allocator.dupe(u8, capability.string) });
        }
        var detail: std.json.ObjectMap = .empty;
        try detail.put(allocator, "id", .{ .string = try allocator.dupe(u8, id) });
        try detail.put(allocator, "version", try copyNullableString(allocator, entry.object, "version", 128));
        try detail.put(allocator, "source", try copyNullableString(allocator, entry.object, "source", 64));
        try detail.put(allocator, "capabilities", .{ .array = copied_capabilities });
        try details.append(.{ .object = detail });
    }
    return .{ .array = details };
}

fn copyNullableString(allocator: std.mem.Allocator, object: std.json.ObjectMap, name: []const u8, max_length: usize) !std.json.Value {
    const value = object.get(name) orelse return .null;
    if (value == .null) return .null;
    if (value != .string or value.string.len == 0 or value.string.len > max_length) return error.InvalidEnrollmentCapabilities;
    return .{ .string = try allocator.dupe(u8, value.string) };
}

fn copyOptional(allocator: std.mem.Allocator, object: std.json.ObjectMap, name: []const u8) !std.json.Value {
    const value = requiredString(object, name) orelse return .null;
    return .{ .string = try allocator.dupe(u8, value) };
}

fn touch(allocator: std.mem.Allocator, io: Io, rig: *std.json.Value) !void {
    var timestamp_buffer: [24]u8 = undefined;
    const timestamp = formatTimestamp(io, &timestamp_buffer);
    try rig.object.put(allocator, "updated_at", .{ .string = try allocator.dupe(u8, timestamp) });
}

fn parseObject(allocator: std.mem.Allocator, document: []const u8) !std.json.Parsed(std.json.Value) {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidEnrollmentPayload;
    errdefer parsed.deinit();
    if (parsed.value != .object) return error.InvalidEnrollmentPayload;
    return parsed;
}

fn normalizeUrl(allocator: std.mem.Allocator, value: []const u8) ![]u8 {
    const trimmed = std.mem.trimEnd(u8, std.mem.trim(u8, value, " \t\r\n"), "/");
    const uri = std.Uri.parse(trimmed) catch return error.InvalidEnrollmentAddress;
    if ((!std.ascii.eqlIgnoreCase(uri.scheme, "http") and !std.ascii.eqlIgnoreCase(uri.scheme, "https")) or uri.host == null) return error.InvalidEnrollmentAddress;
    return allocator.dupe(u8, trimmed);
}

fn requiredString(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len > 0) trimmed else null;
}

fn validNodeId(value: []const u8) bool {
    if (value.len == 0 or value.len > 128) return false;
    for (value) |byte| if (!std.ascii.isAlphanumeric(byte) and byte != '-' and byte != '_') return false;
    return true;
}

fn serialize(allocator: std.mem.Allocator, value: std.json.Value) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(value, .{}, &output.writer);
    return output.toOwnedSlice();
}

fn formatTimestamp(io: Io, buffer: *[24]u8) []const u8 {
    const seconds = Io.Clock.real.now(io).toSeconds();
    const epoch = std.time.epoch.EpochSeconds{ .secs = @intCast(@max(seconds, 0)) };
    const year_day = epoch.getEpochDay().calculateYearDay();
    const month_day = year_day.calculateMonthDay();
    const day_seconds = epoch.getDaySeconds();
    return std.fmt.bufPrint(buffer, "{d:0>4}-{d:0>2}-{d:0>2}T{d:0>2}:{d:0>2}:{d:0>2}.000Z", .{
        year_day.year,                 month_day.month.numeric(),        month_day.day_index + 1,
        day_seconds.getHoursIntoDay(), day_seconds.getMinutesIntoHour(), day_seconds.getSecondsIntoMinute(),
    }) catch unreachable;
}
