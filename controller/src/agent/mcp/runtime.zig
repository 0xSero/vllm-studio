const std = @import("std");
const client = @import("client.zig");
const connectors = @import("../connectors/store.zig");
const sqlite = @import("../../storage/sqlite.zig");

const Io = std.Io;

const Instance = struct {
    fingerprint: []u8,
    session: *client.StdioSession,
};

pub const Manager = struct {
    allocator: std.mem.Allocator,
    io: Io,
    environment: *const std.process.Environ.Map,
    data_dir: []u8,
    mutex: Io.Mutex = .init,
    instances: std.StringHashMapUnmanaged(Instance) = .empty,

    pub fn init(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, data_dir: []const u8) !Manager {
        return .{
            .allocator = allocator,
            .io = io,
            .environment = environment,
            .data_dir = try allocator.dupe(u8, data_dir),
        };
    }

    pub fn deinit(manager: *Manager) void {
        var iterator = manager.instances.iterator();
        while (iterator.next()) |entry| {
            manager.allocator.free(entry.key_ptr.*);
            manager.allocator.free(entry.value_ptr.fingerprint);
            entry.value_ptr.session.close();
        }
        manager.instances.deinit(manager.allocator);
        manager.allocator.free(manager.data_dir);
        manager.* = undefined;
    }

    pub fn warm(manager: *Manager, database: *sqlite.Database) void {
        database.lock(manager.io) catch return;
        var records = connectors.listEnabled(manager.allocator, database) catch {
            database.unlock(manager.io);
            return;
        };
        database.unlock(manager.io);
        defer records.deinit();
        database.lock(manager.io) catch return;
        for (records.documents) |document| {
            var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, document, .{}) catch continue;
            defer parsed.deinit();
            if (parsed.value != .object) continue;
            const id = stringField(parsed.value.object, "id") orelse continue;
            var timestamp_buffer: [24]u8 = undefined;
            connectors.seedGrant(database, id, formatTimestamp(manager.io, &timestamp_buffer)) catch continue;
        }
        database.unlock(manager.io);
        for (records.documents) |document| {
            var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, document, .{}) catch continue;
            defer parsed.deinit();
            if (parsed.value != .object) continue;
            const transport = stringField(parsed.value.object, "transport") orelse continue;
            if (!std.mem.eql(u8, transport, "stdio")) continue;
            const result = manager.execute(parsed.value.object, .tools) catch |failure| {
                const id = stringField(parsed.value.object, "id") orelse "unknown";
                std.log.warn("MCP runtime {s} failed to start: {t}", .{ id, failure });
                continue;
            };
            manager.allocator.free(result);
        }
    }

    pub fn execute(manager: *Manager, connector: std.json.ObjectMap, operation: client.Operation) ![]u8 {
        const id = stringField(connector, "id") orelse return error.ConnectorIdRequired;
        const fingerprint = try documentFingerprint(manager.allocator, connector);
        defer manager.allocator.free(fingerprint);
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        if (manager.instances.getPtr(id)) |instance| {
            if (std.mem.eql(u8, instance.fingerprint, fingerprint)) return instance.session.execute(operation) catch |failure| {
                if (transportFailed(failure)) manager.removeLocked(id);
                return failure;
            };
            manager.removeLocked(id);
        }
        const session = try client.StdioSession.open(manager.allocator, manager.io, manager.environment, manager.data_dir, connector);
        errdefer session.close();
        const key = try manager.allocator.dupe(u8, id);
        errdefer manager.allocator.free(key);
        const owned_fingerprint = try manager.allocator.dupe(u8, fingerprint);
        errdefer manager.allocator.free(owned_fingerprint);
        try manager.instances.put(manager.allocator, key, .{ .fingerprint = owned_fingerprint, .session = session });
        return session.execute(operation) catch |failure| {
            if (transportFailed(failure)) manager.removeLocked(id);
            return failure;
        };
    }

    pub fn remove(manager: *Manager, id: []const u8) void {
        manager.mutex.lock(manager.io) catch return;
        defer manager.mutex.unlock(manager.io);
        manager.removeLocked(id);
    }

    fn removeLocked(manager: *Manager, id: []const u8) void {
        const removed = manager.instances.fetchRemove(id) orelse return;
        manager.allocator.free(removed.key);
        manager.allocator.free(removed.value.fingerprint);
        removed.value.session.close();
    }
};

fn documentFingerprint(allocator: std.mem.Allocator, connector: std.json.ObjectMap) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(std.json.Value{ .object = connector }, .{}, &output.writer);
    return output.toOwnedSlice();
}

fn transportFailed(failure: anyerror) bool {
    return failure == error.McpTransportClosed or failure == error.BrokenPipe or failure == error.ConnectionResetByPeer or failure == error.EndOfStream;
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len == 0) null else trimmed;
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
