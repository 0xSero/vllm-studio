const std = @import("std");
const sqlite = @import("../../storage/sqlite.zig");

pub const Run = struct {
    allocator: std.mem.Allocator,
    id: []u8,
    parent_session_id: []u8,
    name: []u8,
    task: []u8,
    runtime_session_id: []u8,
    native_session_id: ?[]u8,
    model_id: ?[]u8,
    model_route_id: ?[]u8,
    harness: ?[]u8,
    cwd: []u8,
    status: []u8,
    started_at: []u8,
    finished_at: ?[]u8,
    failure: ?[]u8,
    report: []u8,

    pub fn deinit(run: *Run) void {
        run.allocator.free(run.id);
        run.allocator.free(run.parent_session_id);
        run.allocator.free(run.name);
        run.allocator.free(run.task);
        run.allocator.free(run.runtime_session_id);
        if (run.native_session_id) |value| run.allocator.free(value);
        if (run.model_id) |value| run.allocator.free(value);
        if (run.model_route_id) |value| run.allocator.free(value);
        if (run.harness) |value| run.allocator.free(value);
        run.allocator.free(run.cwd);
        run.allocator.free(run.status);
        run.allocator.free(run.started_at);
        if (run.finished_at) |value| run.allocator.free(value);
        if (run.failure) |value| run.allocator.free(value);
        run.allocator.free(run.report);
        run.* = undefined;
    }
};

pub const List = struct {
    allocator: std.mem.Allocator,
    records: []Run,

    pub fn deinit(run_list: *List) void {
        for (run_list.records) |*record| record.deinit();
        run_list.allocator.free(run_list.records);
        run_list.* = undefined;
    }
};

pub fn initialize(database: *sqlite.Database) !void {
    try database.executeScript(
        \\CREATE TABLE IF NOT EXISTS agent_subagents (
        \\  run_id TEXT PRIMARY KEY,
        \\  parent_session_id TEXT NOT NULL,
        \\  name TEXT NOT NULL,
        \\  task TEXT NOT NULL,
        \\  runtime_session_id TEXT NOT NULL UNIQUE,
        \\  native_session_id TEXT,
        \\  model_id TEXT,
        \\  model_route_id TEXT,
        \\  harness TEXT,
        \\  cwd TEXT NOT NULL,
        \\  status TEXT NOT NULL,
        \\  started_at TEXT NOT NULL,
        \\  finished_at TEXT,
        \\  error TEXT,
        \\  report TEXT NOT NULL DEFAULT ''
        \\);
        \\CREATE INDEX IF NOT EXISTS idx_agent_subagents_parent ON agent_subagents(parent_session_id, started_at);
    );
    try ensureColumn(database, "model_id", "ALTER TABLE agent_subagents ADD COLUMN model_id TEXT");
    try ensureColumn(database, "model_route_id", "ALTER TABLE agent_subagents ADD COLUMN model_route_id TEXT");
    try ensureColumn(database, "harness", "ALTER TABLE agent_subagents ADD COLUMN harness TEXT");
}

pub fn list(allocator: std.mem.Allocator, database: *sqlite.Database, parent_session_id: []const u8) !List {
    var records: std.ArrayList(Run) = .empty;
    errdefer {
        for (records.items) |*record| record.deinit();
        records.deinit(allocator);
    }
    var statement = try database.prepare("SELECT run_id, parent_session_id, name, task, runtime_session_id, native_session_id, model_id, model_route_id, harness, cwd, status, started_at, finished_at, error, report FROM agent_subagents WHERE parent_session_id = ? ORDER BY started_at");
    defer statement.deinit();
    try statement.bindText(1, parent_session_id);
    while (try statement.step() == .row) try records.append(allocator, try readRun(allocator, &statement));
    return .{ .allocator = allocator, .records = try records.toOwnedSlice(allocator) };
}

pub fn get(allocator: std.mem.Allocator, database: *sqlite.Database, parent_session_id: []const u8, run_id: []const u8) !?Run {
    var statement = try database.prepare("SELECT run_id, parent_session_id, name, task, runtime_session_id, native_session_id, model_id, model_route_id, harness, cwd, status, started_at, finished_at, error, report FROM agent_subagents WHERE parent_session_id = ? AND run_id = ?");
    defer statement.deinit();
    try statement.bindText(1, parent_session_id);
    try statement.bindText(2, run_id);
    if (try statement.step() != .row) return null;
    return try readRun(allocator, &statement);
}

pub fn isChild(database: *sqlite.Database, native_session_id: []const u8) !bool {
    var statement = try database.prepare("SELECT 1 FROM agent_subagents WHERE native_session_id = ? LIMIT 1");
    defer statement.deinit();
    try statement.bindText(1, native_session_id);
    return try statement.step() == .row;
}

pub fn runningCount(database: *sqlite.Database, parent_session_id: []const u8) !u64 {
    var statement = try database.prepare("SELECT COUNT(*) FROM agent_subagents WHERE parent_session_id = ? AND status = 'running'");
    defer statement.deinit();
    try statement.bindText(1, parent_session_id);
    if (try statement.step() != .row) return error.DatabaseUnexpectedRow;
    return @intCast(@max(statement.columnInt(0), 0));
}

pub fn create(database: *sqlite.Database, run_id: []const u8, parent_session_id: []const u8, name: []const u8, task: []const u8, runtime_session_id: []const u8, model_id: []const u8, model_route_id: []const u8, harness: []const u8, cwd: []const u8, started_at: []const u8) !void {
    var statement = try database.prepare("INSERT INTO agent_subagents (run_id, parent_session_id, name, task, runtime_session_id, model_id, model_route_id, harness, cwd, status, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)");
    defer statement.deinit();
    try statement.bindText(1, run_id);
    try statement.bindText(2, parent_session_id);
    try statement.bindText(3, name);
    try statement.bindText(4, task);
    try statement.bindText(5, runtime_session_id);
    try statement.bindText(6, model_id);
    try statement.bindText(7, model_route_id);
    try statement.bindText(8, harness);
    try statement.bindText(9, cwd);
    try statement.bindText(10, started_at);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn finish(database: *sqlite.Database, parent_session_id: []const u8, run_id: []const u8, status: []const u8, finished_at: []const u8, native_session_id: ?[]const u8, report: []const u8, failure: ?[]const u8) !bool {
    var statement = try database.prepare("UPDATE agent_subagents SET status = ?, finished_at = ?, native_session_id = COALESCE(?, native_session_id), report = ?, error = ? WHERE parent_session_id = ? AND run_id = ? AND status = 'running'");
    defer statement.deinit();
    try statement.bindText(1, status);
    try statement.bindText(2, finished_at);
    if (native_session_id) |value| try statement.bindText(3, value) else try statement.bindNull(3);
    try statement.bindText(4, report);
    if (failure) |value| try statement.bindText(5, value) else try statement.bindNull(5);
    try statement.bindText(6, parent_session_id);
    try statement.bindText(7, run_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
    return database.changes() > 0;
}

pub fn adopt(database: *sqlite.Database, parent_session_id: []const u8, run_id: []const u8, native_session_id: []const u8) !void {
    var statement = try database.prepare("UPDATE agent_subagents SET native_session_id = COALESCE(native_session_id, ?) WHERE parent_session_id = ? AND run_id = ?");
    defer statement.deinit();
    try statement.bindText(1, native_session_id);
    try statement.bindText(2, parent_session_id);
    try statement.bindText(3, run_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

fn readRun(allocator: std.mem.Allocator, statement: *const sqlite.Statement) !Run {
    return .{
        .allocator = allocator,
        .id = try required(allocator, statement, 0),
        .parent_session_id = try required(allocator, statement, 1),
        .name = try required(allocator, statement, 2),
        .task = try required(allocator, statement, 3),
        .runtime_session_id = try required(allocator, statement, 4),
        .native_session_id = try optional(allocator, statement, 5),
        .model_id = try optional(allocator, statement, 6),
        .model_route_id = try optional(allocator, statement, 7),
        .harness = try optional(allocator, statement, 8),
        .cwd = try required(allocator, statement, 9),
        .status = try required(allocator, statement, 10),
        .started_at = try required(allocator, statement, 11),
        .finished_at = try optional(allocator, statement, 12),
        .failure = try optional(allocator, statement, 13),
        .report = try required(allocator, statement, 14),
    };
}

fn required(allocator: std.mem.Allocator, statement: *const sqlite.Statement, index: u31) ![]u8 {
    return allocator.dupe(u8, statement.columnText(index) orelse return error.InvalidSubagentRecord);
}

fn optional(allocator: std.mem.Allocator, statement: *const sqlite.Statement, index: u31) !?[]u8 {
    const value = statement.columnText(index) orelse return null;
    return @as(?[]u8, try allocator.dupe(u8, value));
}

fn ensureColumn(database: *sqlite.Database, column: []const u8, statement_text: []const u8) !void {
    var statement = try database.prepare("PRAGMA table_info(agent_subagents)");
    defer statement.deinit();
    while (try statement.step() == .row) {
        const name = statement.columnText(1) orelse continue;
        if (std.mem.eql(u8, name, column)) return;
    }
    try database.execute(statement_text);
}
