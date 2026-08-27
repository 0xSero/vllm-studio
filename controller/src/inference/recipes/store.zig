const std = @import("std");
const sqlite = @import("../../storage/sqlite.zig");

pub const PayloadColumn = enum {
    data,
    json,

    fn name(column: PayloadColumn) []const u8 {
        return @tagName(column);
    }
};

pub const List = struct {
    allocator: std.mem.Allocator,
    storage: [][]u8,

    pub fn items(documents: *const List) []const []const u8 {
        return documents.storage;
    }

    pub fn deinit(documents: *List) void {
        for (documents.storage) |document| documents.allocator.free(document);
        documents.allocator.free(documents.storage);
        documents.* = undefined;
    }
};

pub fn initialize(database: *sqlite.Database) !PayloadColumn {
    var table_statement = try database.prepare("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'recipes'");
    defer table_statement.deinit();
    if (try table_statement.step() != .row) return error.DatabaseQueryFailed;
    if (table_statement.columnInt(0) == 0) {
        try database.executeScript(
            \\CREATE TABLE recipes (
            \\  id TEXT PRIMARY KEY,
            \\  data TEXT NOT NULL,
            \\  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            \\  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            \\);
        );
        return .data;
    }

    var has_data = false;
    var has_json = false;
    var column_statement = try database.prepare("PRAGMA table_info(recipes)");
    defer column_statement.deinit();
    while (try column_statement.step() == .row) {
        const column_name = column_statement.columnText(1) orelse continue;
        if (std.mem.eql(u8, column_name, "data")) has_data = true;
        if (std.mem.eql(u8, column_name, "json")) has_json = true;
    }
    if (has_data) return .data;
    if (has_json) return .json;
    return error.RecipePayloadColumnMissing;
}

pub fn list(allocator: std.mem.Allocator, database: *sqlite.Database, column: PayloadColumn) !List {
    const query = switch (column) {
        .data => "SELECT data FROM recipes ORDER BY id",
        .json => "SELECT json FROM recipes ORDER BY id",
    };
    var documents: std.ArrayList([]u8) = .empty;
    errdefer {
        for (documents.items) |document| allocator.free(document);
        documents.deinit(allocator);
    }
    var statement = try database.prepare(query);
    defer statement.deinit();
    while (try statement.step() == .row) {
        const document = statement.columnText(0) orelse continue;
        if (!try std.json.validate(allocator, document)) continue;
        try documents.append(allocator, try allocator.dupe(u8, document));
    }
    return .{ .allocator = allocator, .storage = try documents.toOwnedSlice(allocator) };
}

pub fn get(allocator: std.mem.Allocator, database: *sqlite.Database, column: PayloadColumn, id: []const u8) !?[]u8 {
    const query = switch (column) {
        .data => "SELECT data FROM recipes WHERE id = ?",
        .json => "SELECT json FROM recipes WHERE id = ?",
    };
    var statement = try database.prepare(query);
    defer statement.deinit();
    try statement.bindText(1, id);
    if (try statement.step() != .row) return null;
    const document = statement.columnText(0) orelse return null;
    if (!try std.json.validate(allocator, document)) return null;
    return try allocator.dupe(u8, document);
}

pub fn save(database: *sqlite.Database, column: PayloadColumn, id: []const u8, document: []const u8) !void {
    const query = switch (column) {
        .data =>
        \\INSERT INTO recipes (id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
        \\ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP
        ,
        .json =>
        \\INSERT INTO recipes (id, json, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        \\ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = CURRENT_TIMESTAMP
        ,
    };
    var statement = try database.prepare(query);
    defer statement.deinit();
    try statement.bindText(1, id);
    try statement.bindText(2, document);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn delete(database: *sqlite.Database, id: []const u8) !bool {
    var statement = try database.prepare("DELETE FROM recipes WHERE id = ?");
    defer statement.deinit();
    try statement.bindText(1, id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
    return database.changes() > 0;
}
