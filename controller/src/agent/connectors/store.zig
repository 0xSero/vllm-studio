const std = @import("std");
const sqlite = @import("../../storage/sqlite.zig");

pub const DocumentList = struct {
    allocator: std.mem.Allocator,
    documents: [][]u8,

    pub fn deinit(document_list: *DocumentList) void {
        for (document_list.documents) |document| document_list.allocator.free(document);
        document_list.allocator.free(document_list.documents);
        document_list.* = undefined;
    }
};

pub const Grant = struct {
    allocator: std.mem.Allocator,
    model_id: []u8,
    connector_id: []u8,
    tools_json: []u8,
    created_at: []u8,

    pub fn deinit(grant: *Grant) void {
        grant.allocator.free(grant.model_id);
        grant.allocator.free(grant.connector_id);
        grant.allocator.free(grant.tools_json);
        grant.allocator.free(grant.created_at);
        grant.* = undefined;
    }
};

pub const GrantList = struct {
    allocator: std.mem.Allocator,
    grants: []Grant,

    pub fn deinit(grant_list: *GrantList) void {
        for (grant_list.grants) |*grant| grant.deinit();
        grant_list.allocator.free(grant_list.grants);
        grant_list.* = undefined;
    }
};

pub fn initialize(database: *sqlite.Database) !void {
    try database.executeScript(
        \\CREATE TABLE IF NOT EXISTS agent_connectors (
        \\  connector_id TEXT PRIMARY KEY,
        \\  enabled INTEGER NOT NULL,
        \\  data TEXT NOT NULL,
        \\  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \\  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        \\);
        \\CREATE TABLE IF NOT EXISTS agent_connector_grants (
        \\  model_id TEXT NOT NULL,
        \\  connector_id TEXT NOT NULL,
        \\  tools_json TEXT NOT NULL,
        \\  created_at TEXT NOT NULL,
        \\  PRIMARY KEY (model_id, connector_id)
        \\);
        \\CREATE TABLE IF NOT EXISTS agent_connector_grant_seeds (
        \\  connector_id TEXT PRIMARY KEY
        \\);
    );
}

pub fn list(allocator: std.mem.Allocator, database: *sqlite.Database) !DocumentList {
    return queryDocuments(allocator, database, "SELECT data FROM agent_connectors ORDER BY connector_id LIMIT 10000");
}

pub fn listEnabled(allocator: std.mem.Allocator, database: *sqlite.Database) !DocumentList {
    return queryDocuments(allocator, database, "SELECT data FROM agent_connectors WHERE enabled = 1 ORDER BY connector_id LIMIT 10000");
}

pub fn get(allocator: std.mem.Allocator, database: *sqlite.Database, id: []const u8) !?[]u8 {
    var statement = try database.prepare("SELECT data FROM agent_connectors WHERE connector_id = ?");
    defer statement.deinit();
    try statement.bindText(1, id);
    if (try statement.step() != .row) return null;
    return @as(?[]u8, try allocator.dupe(u8, statement.columnText(0) orelse return error.InvalidConnectorRecord));
}

pub fn save(database: *sqlite.Database, id: []const u8, enabled: bool, document: []const u8) !void {
    var statement = try database.prepare(
        \\INSERT INTO agent_connectors (connector_id, enabled, data, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        \\ON CONFLICT(connector_id) DO UPDATE SET enabled = excluded.enabled, data = excluded.data, updated_at = CURRENT_TIMESTAMP
    );
    defer statement.deinit();
    try statement.bindText(1, id);
    try statement.bindInt(2, if (enabled) 1 else 0);
    try statement.bindText(3, document);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn delete(database: *sqlite.Database, id: []const u8) !void {
    var statement = try database.prepare("DELETE FROM agent_connectors WHERE connector_id = ?");
    defer statement.deinit();
    try statement.bindText(1, id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn listGrants(allocator: std.mem.Allocator, database: *sqlite.Database) !GrantList {
    var grants: std.ArrayList(Grant) = .empty;
    errdefer {
        for (grants.items) |*grant| grant.deinit();
        grants.deinit(allocator);
    }
    var statement = try database.prepare("SELECT model_id, connector_id, tools_json, created_at FROM agent_connector_grants ORDER BY model_id, connector_id LIMIT 10000");
    defer statement.deinit();
    while (try statement.step() == .row) {
        const model_id = try allocator.dupe(u8, statement.columnText(0) orelse return error.InvalidConnectorGrant);
        errdefer allocator.free(model_id);
        const connector_id = try allocator.dupe(u8, statement.columnText(1) orelse return error.InvalidConnectorGrant);
        errdefer allocator.free(connector_id);
        const tools_json = try allocator.dupe(u8, statement.columnText(2) orelse return error.InvalidConnectorGrant);
        errdefer allocator.free(tools_json);
        try grants.append(allocator, .{
            .allocator = allocator,
            .model_id = model_id,
            .connector_id = connector_id,
            .tools_json = tools_json,
            .created_at = try allocator.dupe(u8, statement.columnText(3) orelse return error.InvalidConnectorGrant),
        });
    }
    return .{ .allocator = allocator, .grants = try grants.toOwnedSlice(allocator) };
}

pub fn saveGrant(database: *sqlite.Database, model_id: []const u8, connector_id: []const u8, tools_json: []const u8, created_at: []const u8) !void {
    var statement = try database.prepare(
        \\INSERT INTO agent_connector_grants (model_id, connector_id, tools_json, created_at) VALUES (?, ?, ?, ?)
        \\ON CONFLICT(model_id, connector_id) DO UPDATE SET tools_json = excluded.tools_json, created_at = excluded.created_at
    );
    defer statement.deinit();
    try statement.bindText(1, model_id);
    try statement.bindText(2, connector_id);
    try statement.bindText(3, tools_json);
    try statement.bindText(4, created_at);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn deleteGrant(database: *sqlite.Database, model_id: []const u8, connector_id: []const u8) !void {
    var statement = try database.prepare("DELETE FROM agent_connector_grants WHERE model_id = ? AND connector_id = ?");
    defer statement.deinit();
    try statement.bindText(1, model_id);
    try statement.bindText(2, connector_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn deleteConnectorGrants(database: *sqlite.Database, connector_id: []const u8) !void {
    var grants = try database.prepare("DELETE FROM agent_connector_grants WHERE connector_id = ?");
    defer grants.deinit();
    try grants.bindText(1, connector_id);
    if (try grants.step() != .done) return error.DatabaseUnexpectedRow;
    var seed = try database.prepare("DELETE FROM agent_connector_grant_seeds WHERE connector_id = ?");
    defer seed.deinit();
    try seed.bindText(1, connector_id);
    if (try seed.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn seedGrant(database: *sqlite.Database, connector_id: []const u8, created_at: []const u8) !void {
    var seed = try database.prepare("INSERT OR IGNORE INTO agent_connector_grant_seeds (connector_id) VALUES (?)");
    defer seed.deinit();
    try seed.bindText(1, connector_id);
    if (try seed.step() != .done) return error.DatabaseUnexpectedRow;
    if (database.changes() == 0) return;
    try saveGrant(database, "*", connector_id, "\"all\"", created_at);
}

fn queryDocuments(allocator: std.mem.Allocator, database: *sqlite.Database, sql: []const u8) !DocumentList {
    var documents: std.ArrayList([]u8) = .empty;
    errdefer {
        for (documents.items) |document| allocator.free(document);
        documents.deinit(allocator);
    }
    var statement = try database.prepare(sql);
    defer statement.deinit();
    while (try statement.step() == .row) {
        const document = statement.columnText(0) orelse return error.InvalidConnectorRecord;
        try documents.append(allocator, try allocator.dupe(u8, document));
    }
    return .{ .allocator = allocator, .documents = try documents.toOwnedSlice(allocator) };
}
