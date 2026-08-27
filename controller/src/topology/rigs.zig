const std = @import("std");
const config = @import("../app/config.zig");
const system_info = @import("../system/platform/system_info.zig");
const repository = @import("rig_store.zig");
const sqlite = @import("../storage/sqlite.zig");

pub fn payload(allocator: std.mem.Allocator, io: std.Io, mode: config.Mode, system: *const system_info.Snapshot, database: *sqlite.Database, pi_available: bool) ![]u8 {
    try database.lock(io);
    defer database.unlock(io);
    var stored = try repository.list(allocator, database);
    defer stored.deinit();

    var found_local = false;
    for (stored.storage[0..stored.len]) |*document| {
        const reconciled = try reconcileDocument(allocator, mode, system, pi_available, document.*);
        if (reconciled) |updated| {
            allocator.free(document.*);
            document.* = updated.data;
            try repository.save(database, updated.id, updated.data);
            found_local = true;
            break;
        }
    }

    const seed = if (found_local) null else try seedDocument(allocator, io, mode, system, pi_available);
    defer if (seed) |document| allocator.free(document);
    if (seed) |document| try repository.save(database, "default", document);

    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"rigs\":[");
    for (stored.items(), 0..) |document, index| {
        if (index > 0) try output.writer.writeByte(',');
        try output.writer.writeAll(document);
    }
    if (seed) |document| {
        if (stored.len > 0) try output.writer.writeByte(',');
        try output.writer.writeAll(document);
    }
    try output.writer.writeAll("],\"local_node_id\":\"local\"}");
    return try output.toOwnedSlice();
}

const UpdatedDocument = struct {
    id: []const u8,
    data: []u8,
};

fn reconcileDocument(allocator: std.mem.Allocator, mode: config.Mode, system: *const system_info.Snapshot, pi_available: bool, document: []const u8) !?UpdatedDocument {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return null;
    defer parsed.deinit();
    if (parsed.value != .object) return null;
    const id_value = parsed.value.object.get("id") orelse return null;
    if (id_value != .string) return null;
    const nodes_value = parsed.value.object.getPtr("nodes") orelse return null;
    if (nodes_value.* != .array) return null;
    for (nodes_value.array.items) |*node_value| {
        if (node_value.* != .object) continue;
        const node_id = node_value.object.get("id") orelse continue;
        if (node_id != .string or !std.mem.eql(u8, node_id.string, "local")) continue;
        const arena = parsed.arena.allocator();
        try node_value.object.put(arena, "role", .{ .string = @tagName(mode) });
        try node_value.object.put(arena, "hostname", .{ .string = system.hostname });
        try node_value.object.put(arena, "os", .{ .string = system.os });
        try node_value.object.put(arena, "cpu_model", if (system.cpu_model) |model| .{ .string = model } else .null);
        try node_value.object.put(arena, "cpu_cores", .{ .integer = @intCast(system.cpu_cores) });
        try node_value.object.put(arena, "memory_gb", .{ .integer = @intCast(system.memory_gb) });
        try node_value.object.put(arena, "accelerators", try acceleratorsValue(arena, system));
        try node_value.object.put(arena, "capabilities", try capabilitiesValue(arena, mode, pi_available));

        var output: std.Io.Writer.Allocating = .init(allocator);
        errdefer output.deinit();
        try std.json.Stringify.value(parsed.value, .{}, &output.writer);
        return .{ .id = id_value.string, .data = try output.toOwnedSlice() };
    }
    return null;
}

fn acceleratorsValue(allocator: std.mem.Allocator, system: *const system_info.Snapshot) !std.json.Value {
    var values = std.json.Array.init(allocator);
    if (system.apple_silicon) {
        var accelerator: std.json.ObjectMap = .empty;
        try accelerator.put(allocator, "name", .{ .string = system.cpu_model orelse "Apple Silicon" });
        try accelerator.put(allocator, "count", .{ .integer = 1 });
        try accelerator.put(allocator, "memory_gb", .{ .integer = @intCast(system.memory_gb) });
        try accelerator.put(allocator, "memory_type", .{ .string = "unified" });
        try accelerator.put(allocator, "memory_bandwidth_gbs", .null);
        try accelerator.put(allocator, "unified_memory", .{ .bool = true });
        try values.append(.{ .object = accelerator });
    }
    return .{ .array = values };
}

fn seedDocument(allocator: std.mem.Allocator, io: std.Io, mode: config.Mode, system: *const system_info.Snapshot, pi_available: bool) ![]u8 {
    const Accelerator = struct {
        name: []const u8,
        count: u8,
        memory_gb: u64,
        memory_type: []const u8,
        memory_bandwidth_gbs: ?u64,
        unified_memory: bool,
    };
    const Capabilities = struct {
        compute: bool,
        harnesses: []const []const u8,
        mcp: bool,
        terminal: bool,
        browser: bool,
    };
    const Node = struct {
        id: []const u8,
        name: []const u8,
        hardware_type: []const u8,
        role: []const u8,
        source: []const u8,
        hostname: []const u8,
        address: ?[]const u8,
        os: []const u8,
        cpu_model: ?[]const u8,
        cpu_cores: usize,
        memory_gb: u64,
        accelerators: []const Accelerator,
        notes: ?[]const u8,
        capabilities: Capabilities,
    };
    const Rig = struct {
        id: []const u8,
        name: []const u8,
        description: ?[]const u8,
        nodes: []const Node,
        created_at: []const u8,
        updated_at: []const u8,
    };

    const accelerator = Accelerator{
        .name = system.cpu_model orelse "Apple Silicon",
        .count = 1,
        .memory_gb = system.memory_gb,
        .memory_type = "unified",
        .memory_bandwidth_gbs = null,
        .unified_memory = true,
    };
    const accelerator_list: []const Accelerator = if (system.apple_silicon) &.{accelerator} else &.{};
    const node = Node{
        .id = "local",
        .name = system.hostname,
        .hardware_type = if (system.apple_silicon) "mac" else "custom",
        .role = @tagName(mode),
        .source = "detected",
        .hostname = system.hostname,
        .address = null,
        .os = system.os,
        .cpu_model = system.cpu_model,
        .cpu_cores = system.cpu_cores,
        .memory_gb = system.memory_gb,
        .accelerators = accelerator_list,
        .notes = null,
        .capabilities = .{
            .compute = mode != .head,
            .harnesses = if (mode != .head and pi_available) &.{"pi"} else &.{},
            .mcp = mode != .head,
            .terminal = mode != .head,
            .browser = false,
        },
    };
    var timestamp_buffer: [24]u8 = undefined;
    const timestamp = formatTimestamp(io, &timestamp_buffer);
    const rig = Rig{
        .id = "default",
        .name = "My Rig",
        .description = null,
        .nodes = &.{node},
        .created_at = timestamp,
        .updated_at = timestamp,
    };
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(rig, .{}, &output.writer);
    return try output.toOwnedSlice();
}

fn capabilitiesValue(allocator: std.mem.Allocator, mode: config.Mode, pi_available: bool) !std.json.Value {
    const enabled = mode != .head and pi_available;
    var harnesses: std.json.Array = .init(allocator);
    if (enabled) try harnesses.append(.{ .string = "pi" });
    var capabilities: std.json.ObjectMap = .empty;
    try capabilities.put(allocator, "compute", .{ .bool = mode != .head });
    try capabilities.put(allocator, "harnesses", .{ .array = harnesses });
    try capabilities.put(allocator, "mcp", .{ .bool = mode != .head });
    try capabilities.put(allocator, "terminal", .{ .bool = mode != .head });
    try capabilities.put(allocator, "browser", .{ .bool = false });
    return .{ .object = capabilities };
}

fn formatTimestamp(io: std.Io, buffer: *[24]u8) []const u8 {
    const seconds = std.Io.Clock.real.now(io).toSeconds();
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
