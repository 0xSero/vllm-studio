const std = @import("std");
const config = @import("../app/config.zig");
const credentials = @import("credential_store.zig");
const repository = @import("rig_store.zig");
const sqlite = @import("../storage/sqlite.zig");

const Io = std.Io;

pub fn createRig(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, document: []const u8) ![]u8 {
    var body = try parseObject(allocator, document);
    defer body.deinit();
    const name = requiredString(body.value.object, "name") orelse return error.RigNameRequired;
    const description = try nullableString(body.value.object, "description");
    var random: [16]u8 = undefined;
    io.random(&random);
    const id = std.fmt.bytesToHex(random, .lower);
    var timestamp_buffer: [24]u8 = undefined;
    const timestamp = formatTimestamp(io, &timestamp_buffer);
    var output: Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try output.writer.writeAll("{\"id\":");
    try std.json.Stringify.value(id[0..], .{}, &output.writer);
    try output.writer.writeAll(",\"name\":");
    try std.json.Stringify.value(name, .{}, &output.writer);
    try output.writer.writeAll(",\"description\":");
    if (description) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
    try output.writer.writeAll(",\"nodes\":[],\"created_at\":");
    try std.json.Stringify.value(timestamp, .{}, &output.writer);
    try output.writer.writeAll(",\"updated_at\":");
    try std.json.Stringify.value(timestamp, .{}, &output.writer);
    try output.writer.writeByte('}');
    const rig_document = try allocator.dupe(u8, output.writer.buffered());
    defer allocator.free(rig_document);
    try database.lock(io);
    defer database.unlock(io);
    try repository.save(database, id[0..], rig_document);
    return responseWithRig(allocator, rig_document, null);
}

pub fn updateRig(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, rig_id: []const u8, document: []const u8) ![]u8 {
    var body = try parseObject(allocator, document);
    defer body.deinit();
    try database.lock(io);
    defer database.unlock(io);
    const stored = (try repository.get(allocator, database, rig_id)) orelse return error.RigNotFound;
    defer allocator.free(stored);
    var rig = try parseObject(allocator, stored);
    defer rig.deinit();
    const arena = rig.arena.allocator();
    if (body.value.object.get("name")) |value| {
        if (value != .string or std.mem.trim(u8, value.string, " \t\r\n").len == 0) return error.RigNameRequired;
        try rig.value.object.put(arena, "name", value);
    }
    if (body.value.object.get("description")) |value| {
        if (value != .string and value != .null) return error.InvalidRigPayload;
        try rig.value.object.put(arena, "description", value);
    }
    try touch(arena, io, &rig.value);
    const updated = try serialize(allocator, rig.value);
    defer allocator.free(updated);
    try repository.save(database, rig_id, updated);
    return responseWithRig(allocator, updated, null);
}

pub fn deleteRig(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, rig_id: []const u8) ![]u8 {
    try database.lock(io);
    defer database.unlock(io);
    const stored = (try repository.get(allocator, database, rig_id)) orelse return error.RigNotFound;
    defer allocator.free(stored);
    var rig = try parseObject(allocator, stored);
    defer rig.deinit();
    if (rig.value.object.get("nodes")) |nodes| if (nodes == .array) for (nodes.array.items) |node| {
        if (node != .object) continue;
        const id = requiredString(node.object, "id") orelse continue;
        try credentials.delete(database, id);
    };
    if (!try repository.delete(database, rig_id)) return error.RigNotFound;
    return allocator.dupe(u8, "{\"success\":true}");
}

pub fn createNode(allocator: std.mem.Allocator, io: Io, mode: config.Mode, database: *sqlite.Database, rig_id: []const u8, document: []const u8) ![]u8 {
    var body = try parseObject(allocator, document);
    defer body.deinit();
    const name = requiredString(body.value.object, "name") orelse return error.NodeNameRequired;
    const role = optionalString(body.value.object, "role") orelse "standalone";
    try validateRole(mode, role);
    var random: [16]u8 = undefined;
    io.random(&random);
    const id = std.fmt.bytesToHex(random, .lower);
    try database.lock(io);
    defer database.unlock(io);
    const stored = (try repository.get(allocator, database, rig_id)) orelse return error.RigNotFound;
    defer allocator.free(stored);
    var rig = try parseObject(allocator, stored);
    defer rig.deinit();
    const arena = rig.arena.allocator();
    const nodes = rig.value.object.getPtr("nodes") orelse return error.InvalidRigRecord;
    if (nodes.* != .array) return error.InvalidRigRecord;
    const node = try newNode(arena, body.value.object, id[0..], name, role);
    try nodes.array.append(node);
    try touch(arena, io, &rig.value);
    const updated = try serialize(allocator, rig.value);
    defer allocator.free(updated);
    try repository.save(database, rig_id, updated);
    if (try nullableString(body.value.object, "api_key")) |api_key| try credentials.save(database, id[0..], api_key);
    const node_document = try serialize(allocator, node);
    defer allocator.free(node_document);
    return responseWithRig(allocator, updated, node_document);
}

pub fn updateNode(allocator: std.mem.Allocator, io: Io, mode: config.Mode, database: *sqlite.Database, rig_id: []const u8, node_id: []const u8, document: []const u8) ![]u8 {
    var body = try parseObject(allocator, document);
    defer body.deinit();
    try database.lock(io);
    defer database.unlock(io);
    const stored = (try repository.get(allocator, database, rig_id)) orelse return error.RigNotFound;
    defer allocator.free(stored);
    var rig = try parseObject(allocator, stored);
    defer rig.deinit();
    const nodes = rig.value.object.getPtr("nodes") orelse return error.InvalidRigRecord;
    if (nodes.* != .array) return error.InvalidRigRecord;
    var selected: ?*std.json.Value = null;
    for (nodes.array.items) |*node| {
        if (node.* != .object) continue;
        const id = requiredString(node.object, "id") orelse continue;
        if (std.mem.eql(u8, id, node_id)) {
            selected = node;
            break;
        }
    }
    const node = selected orelse return error.NodeNotFound;
    if (std.mem.eql(u8, node_id, "local")) return error.LocalNodeImmutable;
    const arena = rig.arena.allocator();
    const fields = [_][]const u8{ "name", "hardware_type", "role", "hostname", "address", "os", "cpu_model", "memory_gb", "accelerators", "notes", "capabilities" };
    for (fields) |field| if (body.value.object.get(field)) |value| {
        if (std.mem.eql(u8, field, "name") and (value != .string or std.mem.trim(u8, value.string, " \t\r\n").len == 0)) return error.NodeNameRequired;
        if (std.mem.eql(u8, field, "role")) {
            if (value != .string) return error.InvalidNodePayload;
            try validateRole(mode, value.string);
        }
        if (std.mem.eql(u8, field, "capabilities")) try validateCapabilities(value);
        try node.object.put(arena, field, value);
    };
    try touch(arena, io, &rig.value);
    const updated = try serialize(allocator, rig.value);
    defer allocator.free(updated);
    try repository.save(database, rig_id, updated);
    if (try nullableString(body.value.object, "api_key")) |api_key| try credentials.save(database, node_id, api_key);
    const node_document = try serialize(allocator, node.*);
    defer allocator.free(node_document);
    return responseWithRig(allocator, updated, node_document);
}

pub fn deleteNode(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, rig_id: []const u8, node_id: []const u8) ![]u8 {
    if (std.mem.eql(u8, node_id, "local")) return error.LocalNodeImmutable;
    try database.lock(io);
    defer database.unlock(io);
    const stored = (try repository.get(allocator, database, rig_id)) orelse return error.RigNotFound;
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
    if (index == null) return error.NodeNotFound;
    _ = nodes.array.orderedRemove(index.?);
    const arena = rig.arena.allocator();
    try touch(arena, io, &rig.value);
    const updated = try serialize(allocator, rig.value);
    defer allocator.free(updated);
    try repository.save(database, rig_id, updated);
    try credentials.delete(database, node_id);
    return responseWithRig(allocator, updated, null);
}

fn newNode(allocator: std.mem.Allocator, body: std.json.ObjectMap, id: []const u8, name: []const u8, role: []const u8) !std.json.Value {
    var node: std.json.ObjectMap = .empty;
    try node.put(allocator, "id", .{ .string = id });
    try node.put(allocator, "name", .{ .string = name });
    try node.put(allocator, "hardware_type", .{ .string = optionalString(body, "hardware_type") orelse "custom" });
    try node.put(allocator, "role", .{ .string = role });
    try node.put(allocator, "source", .{ .string = "manual" });
    for ([_][]const u8{ "hostname", "address", "os", "cpu_model", "memory_gb", "notes" }) |field| {
        try node.put(allocator, field, body.get(field) orelse .null);
    }
    try node.put(allocator, "cpu_cores", .null);
    try node.put(allocator, "accelerators", body.get("accelerators") orelse .{ .array = .init(allocator) });
    const capabilities = body.get("capabilities") orelse try defaultCapabilities(allocator, role);
    try validateCapabilities(capabilities);
    try node.put(allocator, "capabilities", capabilities);
    return .{ .object = node };
}

fn defaultCapabilities(allocator: std.mem.Allocator, role: []const u8) !std.json.Value {
    var capabilities: std.json.ObjectMap = .empty;
    try capabilities.put(allocator, "compute", .{ .bool = std.mem.eql(u8, role, "worker") });
    try capabilities.put(allocator, "harnesses", .{ .array = .init(allocator) });
    try capabilities.put(allocator, "mcp", .{ .bool = false });
    try capabilities.put(allocator, "terminal", .{ .bool = false });
    try capabilities.put(allocator, "browser", .{ .bool = false });
    return .{ .object = capabilities };
}

fn validateCapabilities(value: std.json.Value) !void {
    if (value != .object) return error.InvalidNodeCapabilities;
    const compute = value.object.get("compute") orelse return error.InvalidNodeCapabilities;
    const harnesses = value.object.get("harnesses") orelse return error.InvalidNodeCapabilities;
    const mcp = value.object.get("mcp") orelse return error.InvalidNodeCapabilities;
    const terminal = value.object.get("terminal") orelse return error.InvalidNodeCapabilities;
    const browser = value.object.get("browser") orelse return error.InvalidNodeCapabilities;
    if (compute != .bool or harnesses != .array or mcp != .bool or terminal != .bool or browser != .bool) return error.InvalidNodeCapabilities;
    for (harnesses.array.items) |entry| if (entry != .string or entry.string.len == 0 or entry.string.len > 64) return error.InvalidNodeCapabilities;
}

fn validateRole(mode: config.Mode, role: []const u8) !void {
    if (!std.mem.eql(u8, role, "head") and !std.mem.eql(u8, role, "worker") and !std.mem.eql(u8, role, "standalone")) return error.InvalidNodeRole;
    if (mode != .head and std.mem.eql(u8, role, "worker")) return error.HeadRequiredForWorker;
}

fn responseWithRig(allocator: std.mem.Allocator, rig: []const u8, node: ?[]const u8) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.print("{{\"success\":true,\"rig\":{s}", .{rig});
    if (node) |value| try output.writer.print(",\"node\":{s}", .{value});
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn touch(allocator: std.mem.Allocator, io: Io, rig: *std.json.Value) !void {
    var timestamp_buffer: [24]u8 = undefined;
    const timestamp = formatTimestamp(io, &timestamp_buffer);
    try rig.object.put(allocator, "updated_at", .{ .string = try allocator.dupe(u8, timestamp) });
}

fn parseObject(allocator: std.mem.Allocator, document: []const u8) !std.json.Parsed(std.json.Value) {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidRigPayload;
    errdefer parsed.deinit();
    if (parsed.value != .object) return error.InvalidRigPayload;
    return parsed;
}

fn requiredString(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    return optionalString(object, name);
}

fn optionalString(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len > 0) trimmed else null;
}

fn nullableString(object: std.json.ObjectMap, name: []const u8) !?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value == .null) return null;
    if (value != .string) return error.InvalidRigPayload;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len > 0) trimmed else null;
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
        year_day.year,
        month_day.month.numeric(),
        month_day.day_index + 1,
        day_seconds.getHoursIntoDay(),
        day_seconds.getMinutesIntoHour(),
        day_seconds.getSecondsIntoMinute(),
    }) catch unreachable;
}
