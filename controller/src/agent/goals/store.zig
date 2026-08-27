const std = @import("std");
const sqlite = @import("../../storage/sqlite.zig");

pub fn initialize(database: *sqlite.Database) !void {
    try database.executeScript(
        \\CREATE TABLE IF NOT EXISTS agent_goals (
        \\  session_id TEXT PRIMARY KEY,
        \\  data TEXT NOT NULL,
        \\  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        \\);
        \\CREATE TABLE IF NOT EXISTS agent_goal_drivers (
        \\  runtime_session_id TEXT PRIMARY KEY,
        \\  saw_tool INTEGER NOT NULL DEFAULT 0,
        \\  assistant_text TEXT NOT NULL DEFAULT '',
        \\  was_continuation INTEGER NOT NULL DEFAULT 0,
        \\  run_started_at INTEGER
        \\);
    );
}

pub const Driver = struct {
    allocator: std.mem.Allocator,
    saw_tool: bool,
    assistant_text: []u8,
    was_continuation: bool,
    run_started_at: ?i64,

    pub fn deinit(driver_state: *Driver) void {
        driver_state.allocator.free(driver_state.assistant_text);
        driver_state.* = undefined;
    }
};

pub fn driver(allocator: std.mem.Allocator, database: *sqlite.Database, runtime_session_id: []const u8) !Driver {
    var statement = try database.prepare("SELECT saw_tool, assistant_text, was_continuation, run_started_at FROM agent_goal_drivers WHERE runtime_session_id = ?");
    defer statement.deinit();
    try statement.bindText(1, runtime_session_id);
    if (try statement.step() != .row) return .{ .allocator = allocator, .saw_tool = false, .assistant_text = try allocator.dupe(u8, ""), .was_continuation = false, .run_started_at = null };
    return .{
        .allocator = allocator,
        .saw_tool = statement.columnInt(0) != 0,
        .assistant_text = try allocator.dupe(u8, statement.columnText(1) orelse ""),
        .was_continuation = statement.columnInt(2) != 0,
        .run_started_at = if (statement.columnType(3) == .null) null else statement.columnInt(3),
    };
}

pub fn saveDriver(database: *sqlite.Database, runtime_session_id: []const u8, value: *const Driver) !void {
    var statement = try database.prepare("INSERT INTO agent_goal_drivers (runtime_session_id, saw_tool, assistant_text, was_continuation, run_started_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(runtime_session_id) DO UPDATE SET saw_tool = excluded.saw_tool, assistant_text = excluded.assistant_text, was_continuation = excluded.was_continuation, run_started_at = excluded.run_started_at");
    defer statement.deinit();
    try statement.bindText(1, runtime_session_id);
    try statement.bindInt(2, if (value.saw_tool) 1 else 0);
    try statement.bindText(3, value.assistant_text);
    try statement.bindInt(4, if (value.was_continuation) 1 else 0);
    if (value.run_started_at) |seconds| try statement.bindInt(5, seconds) else try statement.bindNull(5);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn get(allocator: std.mem.Allocator, database: *sqlite.Database, session_id: []const u8) !?[]u8 {
    var statement = try database.prepare("SELECT data FROM agent_goals WHERE session_id = ?");
    defer statement.deinit();
    try statement.bindText(1, session_id);
    if (try statement.step() != .row) return null;
    const document = statement.columnText(0) orelse return null;
    if (!try std.json.validate(allocator, document)) return error.InvalidGoalRecord;
    return @as(?[]u8, try allocator.dupe(u8, document));
}

pub fn save(database: *sqlite.Database, session_id: []const u8, document: []const u8) !void {
    var statement = try database.prepare(
        \\INSERT INTO agent_goals (session_id, data, updated_at)
        \\VALUES (?, ?, CURRENT_TIMESTAMP)
        \\ON CONFLICT(session_id) DO UPDATE SET
        \\  data = excluded.data,
        \\  updated_at = CURRENT_TIMESTAMP
    );
    defer statement.deinit();
    try statement.bindText(1, session_id);
    try statement.bindText(2, document);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn delete(database: *sqlite.Database, session_id: []const u8) !void {
    var statement = try database.prepare("DELETE FROM agent_goals WHERE session_id = ?");
    defer statement.deinit();
    try statement.bindText(1, session_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}
