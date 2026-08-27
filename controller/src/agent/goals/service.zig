const std = @import("std");
const repository = @import("store.zig");
const sqlite = @import("../../storage/sqlite.zig");

const Io = std.Io;

pub fn getPayload(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, session_id: []const u8) ![]u8 {
    try validateSessionId(session_id);
    try database.lock(io);
    defer database.unlock(io);
    const document = try repository.get(allocator, database, session_id);
    defer if (document) |value| allocator.free(value);
    return if (document) |value| std.fmt.allocPrint(allocator, "{{\"goal\":{s}}}", .{value}) else allocator.dupe(u8, "{\"goal\":null}");
}

pub fn putPayload(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, session_id: []const u8, document: []const u8) ![]u8 {
    try validateSessionId(session_id);
    var patch = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidGoalPayload;
    defer patch.deinit();
    if (patch.value != .object) return error.InvalidGoalPayload;
    try database.lock(io);
    defer database.unlock(io);
    const stored = try repository.get(allocator, database, session_id);
    defer if (stored) |value| allocator.free(value);
    var goal = if (stored) |value|
        std.json.parseFromSlice(std.json.Value, allocator, value, .{}) catch return error.InvalidGoalRecord
    else
        try emptyGoal(allocator, io);
    defer goal.deinit();
    const object = patch.value.object;
    const arena = goal.arena.allocator();
    if (object.get("objective")) |value| {
        if (value != .string) return error.InvalidGoalPayload;
        try goal.value.object.put(arena, "objective", .{ .string = try arena.dupe(u8, std.mem.trim(u8, value.string, " \t\r\n")) });
    }
    if (object.get("status")) |value| {
        if (value != .string or !validStatus(value.string)) return error.InvalidGoalStatus;
        try goal.value.object.put(arena, "status", .{ .string = try arena.dupe(u8, value.string) });
    }
    if (object.get("turnBudget")) |value| switch (value) {
        .null => try goal.value.object.put(arena, "turnBudget", .null),
        .integer => |number| if (number > 0) try goal.value.object.put(arena, "turnBudget", .{ .integer = number }) else return error.InvalidGoalBudget,
        .float => |number| if (number > 0 and number <= @as(f64, @floatFromInt(std.math.maxInt(i64)))) try goal.value.object.put(arena, "turnBudget", .{ .integer = @intFromFloat(@round(number)) }) else return error.InvalidGoalBudget,
        else => return error.InvalidGoalBudget,
    };
    var now_buffer: [24]u8 = undefined;
    const now = timestamp(io, &now_buffer);
    const reset_turns = if (object.get("resetTurns")) |value| value == .bool and value.bool else false;
    if (reset_turns) {
        try goal.value.object.put(arena, "turnsUsed", .{ .integer = 0 });
        try goal.value.object.put(arena, "timeUsedSeconds", .{ .integer = 0 });
        try goal.value.object.put(arena, "activeRunStartedAt", .null);
        try goal.value.object.put(arena, "createdAt", .{ .string = try arena.dupe(u8, now) });
    }
    try goal.value.object.put(arena, "updatedAt", .{ .string = try arena.dupe(u8, now) });
    const serialized = try serialize(allocator, goal.value);
    defer allocator.free(serialized);
    const objective = stringField(goal.value.object, "objective") orelse "";
    if (objective.len == 0) {
        try repository.delete(database, session_id);
        return allocator.dupe(u8, "{\"goal\":null}");
    }
    try repository.save(database, session_id, serialized);
    return std.fmt.allocPrint(allocator, "{{\"goal\":{s}}}", .{serialized});
}

pub fn deletePayload(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, session_id: []const u8) ![]u8 {
    try validateSessionId(session_id);
    try database.lock(io);
    defer database.unlock(io);
    try repository.delete(database, session_id);
    return allocator.dupe(u8, "{\"ok\":true}");
}

fn emptyGoal(allocator: std.mem.Allocator, io: Io) !std.json.Parsed(std.json.Value) {
    var buffer: [24]u8 = undefined;
    const now = timestamp(io, &buffer);
    const document = try std.fmt.allocPrint(allocator, "{{\"version\":1,\"objective\":\"\",\"status\":\"active\",\"turnBudget\":null,\"turnsUsed\":0,\"timeUsedSeconds\":0,\"activeRunStartedAt\":null,\"createdAt\":\"{s}\",\"updatedAt\":\"{s}\"}}", .{ now, now });
    defer allocator.free(document);
    return std.json.parseFromSlice(std.json.Value, allocator, document, .{});
}

fn validateSessionId(value: []const u8) !void {
    if (value.len == 0 or value.len > 256) return error.InvalidSessionId;
    for (value) |character| if (!std.ascii.isAlphanumeric(character) and character != '-' and character != '_' and character != ':' and character != '.') return error.InvalidSessionId;
}

fn validStatus(value: []const u8) bool {
    inline for ([_][]const u8{ "active", "paused", "blocked", "complete", "budget_limited" }) |status| if (std.mem.eql(u8, value, status)) return true;
    return false;
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    return if (value == .string) value.string else null;
}

fn serialize(allocator: std.mem.Allocator, value: std.json.Value) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(value, .{}, &output.writer);
    return output.toOwnedSlice();
}

fn timestamp(io: Io, buffer: *[24]u8) []const u8 {
    const seconds = @max(Io.Clock.real.now(io).toSeconds(), 0);
    const epoch = std.time.epoch.EpochSeconds{ .secs = @intCast(seconds) };
    const year_day = epoch.getEpochDay().calculateYearDay();
    const month_day = year_day.calculateMonthDay();
    const day_seconds = epoch.getDaySeconds();
    return std.fmt.bufPrint(buffer, "{d:0>4}-{d:0>2}-{d:0>2}T{d:0>2}:{d:0>2}:{d:0>2}.000Z", .{
        year_day.year, month_day.month.numeric(), month_day.day_index + 1,
        day_seconds.getHoursIntoDay(), day_seconds.getMinutesIntoHour(), day_seconds.getSecondsIntoMinute(),
    }) catch unreachable;
}
