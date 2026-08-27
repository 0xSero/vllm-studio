const std = @import("std");
const sqlite = @import("../storage/sqlite.zig");

pub fn initialize(database: *sqlite.Database) !void {
    try database.executeScript(
        \\CREATE TABLE IF NOT EXISTS rig_node_credentials (
        \\  node_id TEXT PRIMARY KEY,
        \\  api_key TEXT NOT NULL,
        \\  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        \\);
    );
}

pub fn get(allocator: std.mem.Allocator, database: *sqlite.Database, node_id: []const u8) ![]u8 {
    var statement = try database.prepare("SELECT api_key FROM rig_node_credentials WHERE node_id = ?");
    defer statement.deinit();
    try statement.bindText(1, node_id);
    if (try statement.step() != .row) return try allocator.dupe(u8, "");
    return try allocator.dupe(u8, statement.columnText(0) orelse "");
}

pub fn save(database: *sqlite.Database, node_id: []const u8, api_key: []const u8) !void {
    const normalized = std.mem.trim(u8, api_key, " \t\r\n");
    if (normalized.len == 0) return;
    var statement = try database.prepare(
        \\INSERT INTO rig_node_credentials (node_id, api_key, updated_at)
        \\VALUES (?, ?, CURRENT_TIMESTAMP)
        \\ON CONFLICT(node_id) DO UPDATE SET
        \\  api_key = excluded.api_key,
        \\  updated_at = CURRENT_TIMESTAMP
    );
    defer statement.deinit();
    try statement.bindText(1, node_id);
    try statement.bindText(2, normalized);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn delete(database: *sqlite.Database, node_id: []const u8) !void {
    var statement = try database.prepare("DELETE FROM rig_node_credentials WHERE node_id = ?");
    defer statement.deinit();
    try statement.bindText(1, node_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}
