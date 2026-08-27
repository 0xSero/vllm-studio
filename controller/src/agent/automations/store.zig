const std = @import("std");
const sqlite = @import("../../storage/sqlite.zig");

pub const List = struct {
    allocator: std.mem.Allocator,
    documents: [][]u8,

    pub fn deinit(automation_list: *List) void {
        for (automation_list.documents) |document| automation_list.allocator.free(document);
        automation_list.allocator.free(automation_list.documents);
        automation_list.* = undefined;
    }
};

pub fn initialize(database: *sqlite.Database) !void {
    try database.executeScript(
        \\CREATE TABLE IF NOT EXISTS agent_automations (
        \\  automation_id TEXT PRIMARY KEY,
        \\  status TEXT NOT NULL,
        \\  next_run_at TEXT,
        \\  data TEXT NOT NULL,
        \\  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \\  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        \\);
        \\CREATE INDEX IF NOT EXISTS idx_agent_automations_due ON agent_automations(status, next_run_at);
    );
}

pub fn list(allocator: std.mem.Allocator, database: *sqlite.Database) !List {
    var records: std.ArrayList([]u8) = .empty;
    errdefer {
        for (records.items) |document| allocator.free(document);
        records.deinit(allocator);
    }
    var statement = try database.prepare("SELECT data FROM agent_automations ORDER BY json_extract(data, '$.name'), automation_id LIMIT 10000");
    defer statement.deinit();
    while (try statement.step() == .row) {
        const document = statement.columnText(0) orelse continue;
        if (!try std.json.validate(allocator, document)) continue;
        try records.append(allocator, try allocator.dupe(u8, document));
    }
    return .{ .allocator = allocator, .documents = try records.toOwnedSlice(allocator) };
}

pub fn due(allocator: std.mem.Allocator, database: *sqlite.Database, timestamp: []const u8) !List {
    var records: std.ArrayList([]u8) = .empty;
    errdefer {
        for (records.items) |document| allocator.free(document);
        records.deinit(allocator);
    }
    var statement = try database.prepare("SELECT data FROM agent_automations WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at LIMIT 100");
    defer statement.deinit();
    try statement.bindText(1, timestamp);
    while (try statement.step() == .row) {
        const document = statement.columnText(0) orelse continue;
        if (!try std.json.validate(allocator, document)) continue;
        try records.append(allocator, try allocator.dupe(u8, document));
    }
    return .{ .allocator = allocator, .documents = try records.toOwnedSlice(allocator) };
}

pub fn get(allocator: std.mem.Allocator, database: *sqlite.Database, automation_id: []const u8) !?[]u8 {
    var statement = try database.prepare("SELECT data FROM agent_automations WHERE automation_id = ?");
    defer statement.deinit();
    try statement.bindText(1, automation_id);
    if (try statement.step() != .row) return null;
    const document = statement.columnText(0) orelse return null;
    if (!try std.json.validate(allocator, document)) return error.InvalidAutomationRecord;
    return @as(?[]u8, try allocator.dupe(u8, document));
}

pub fn save(database: *sqlite.Database, automation_id: []const u8, status: []const u8, next_run_at: ?[]const u8, document: []const u8) !void {
    var statement = try database.prepare(
        \\INSERT INTO agent_automations (automation_id, status, next_run_at, data, updated_at)
        \\VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        \\ON CONFLICT(automation_id) DO UPDATE SET
        \\  status = excluded.status,
        \\  next_run_at = excluded.next_run_at,
        \\  data = excluded.data,
        \\  updated_at = CURRENT_TIMESTAMP
    );
    defer statement.deinit();
    try statement.bindText(1, automation_id);
    try statement.bindText(2, status);
    if (next_run_at) |value| try statement.bindText(3, value) else try statement.bindNull(3);
    try statement.bindText(4, document);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn delete(database: *sqlite.Database, automation_id: []const u8) !bool {
    var statement = try database.prepare("DELETE FROM agent_automations WHERE automation_id = ?");
    defer statement.deinit();
    try statement.bindText(1, automation_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
    return database.changes() > 0;
}
