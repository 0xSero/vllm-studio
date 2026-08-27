const std = @import("std");
const sqlite = @import("../../storage/sqlite.zig");

const ui_preferences_key = "ui_preferences";

pub fn initialize(database: *sqlite.Database) !void {
    try database.executeScript(
        \\CREATE TABLE IF NOT EXISTS controller_settings (
        \\  key TEXT PRIMARY KEY,
        \\  value TEXT NOT NULL,
        \\  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        \\);
    );
}

pub fn getUiPreferences(allocator: std.mem.Allocator, database: *sqlite.Database) ![]u8 {
    var statement = try database.prepare("SELECT value FROM controller_settings WHERE key = ?");
    defer statement.deinit();
    try statement.bindText(1, ui_preferences_key);
    if (try statement.step() != .row) return try allocator.dupe(u8, "{}");
    const document = statement.columnText(0) orelse return try allocator.dupe(u8, "{}");
    return normalizeUiPreferences(allocator, document) catch try allocator.dupe(u8, "{}");
}

pub fn saveUiPreferences(allocator: std.mem.Allocator, database: *sqlite.Database, document: []const u8) ![]u8 {
    const normalized = try normalizeUiPreferences(allocator, document);
    errdefer allocator.free(normalized);
    var statement = try database.prepare(
        \\INSERT INTO controller_settings (key, value, updated_at)
        \\VALUES (?, ?, CURRENT_TIMESTAMP)
        \\ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    );
    defer statement.deinit();
    try statement.bindText(1, ui_preferences_key);
    try statement.bindText(2, normalized);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
    return normalized;
}

fn normalizeUiPreferences(allocator: std.mem.Allocator, document: []const u8) ![]u8 {
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, document, .{});
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidUiPreferences;
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeByte('{');
    var count: usize = 0;
    var iterator = parsed.value.object.iterator();
    while (iterator.next()) |entry| {
        if (entry.key_ptr.len == 0) continue;
        if (entry.value_ptr.* != .string) return error.InvalidUiPreferences;
        if (count > 0) try output.writer.writeByte(',');
        count += 1;
        try std.json.Stringify.value(entry.key_ptr.*, .{}, &output.writer);
        try output.writer.writeByte(':');
        try std.json.Stringify.value(entry.value_ptr.string, .{}, &output.writer);
    }
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}
