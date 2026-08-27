const std = @import("std");
const sqlite = @import("../../storage/sqlite.zig");

const max_records = 10_000;

pub const Session = struct {
    allocator: std.mem.Allocator,
    id: []u8,
    harness: []u8,
    harness_version: ?[]u8,
    capabilities_json: []u8,
    node_id: []u8,
    native_session_id: ?[]u8,
    project_id: ?[]u8,
    project_path: ?[]u8,
    model_id: ?[]u8,
    model_route_id: ?[]u8,
    status: []u8,
    event_cursor: u64,
    sharing_policy: []u8,
    automation_id: ?[]u8,
    created_at: []u8,
    updated_at: []u8,

    pub fn deinit(session: *Session) void {
        session.allocator.free(session.id);
        session.allocator.free(session.harness);
        if (session.harness_version) |value| session.allocator.free(value);
        session.allocator.free(session.capabilities_json);
        session.allocator.free(session.node_id);
        if (session.native_session_id) |value| session.allocator.free(value);
        if (session.project_id) |value| session.allocator.free(value);
        if (session.project_path) |value| session.allocator.free(value);
        if (session.model_id) |value| session.allocator.free(value);
        if (session.model_route_id) |value| session.allocator.free(value);
        session.allocator.free(session.status);
        session.allocator.free(session.sharing_policy);
        if (session.automation_id) |value| session.allocator.free(value);
        session.allocator.free(session.created_at);
        session.allocator.free(session.updated_at);
        session.* = undefined;
    }
};

pub const SessionList = struct {
    allocator: std.mem.Allocator,
    records: []Session,

    pub fn deinit(session_list: *SessionList) void {
        for (session_list.records) |*record| record.deinit();
        session_list.allocator.free(session_list.records);
        session_list.* = undefined;
    }
};

pub const SessionInput = struct {
    id: []const u8,
    harness: []const u8,
    harness_version: ?[]const u8 = null,
    capabilities_json: []const u8 = "[]",
    node_id: []const u8,
    native_session_id: ?[]const u8 = null,
    project_id: ?[]const u8 = null,
    project_path: ?[]const u8 = null,
    model_id: ?[]const u8 = null,
    model_route_id: ?[]const u8 = null,
    status: []const u8 = "idle",
    event_cursor: u64 = 0,
    sharing_policy: []const u8 = "private",
    automation_id: ?[]const u8 = null,
};

pub const Event = struct {
    allocator: std.mem.Allocator,
    sequence: u64,
    kind: []u8,
    document: []u8,
    created_at: []u8,

    pub fn deinit(event: *Event) void {
        event.allocator.free(event.kind);
        event.allocator.free(event.document);
        event.allocator.free(event.created_at);
        event.* = undefined;
    }
};

pub const EventList = struct {
    allocator: std.mem.Allocator,
    records: []Event,

    pub fn deinit(event_list: *EventList) void {
        for (event_list.records) |*record| record.deinit();
        event_list.allocator.free(event_list.records);
        event_list.* = undefined;
    }
};

pub fn initialize(database: *sqlite.Database) !void {
    try database.executeScript(
        \\CREATE TABLE IF NOT EXISTS agent_sessions (
        \\  session_id TEXT PRIMARY KEY,
        \\  harness TEXT NOT NULL,
        \\  node_id TEXT NOT NULL,
        \\  native_session_id TEXT,
        \\  project_id TEXT,
        \\  project_path TEXT,
        \\  model_id TEXT,
        \\  model_route_id TEXT,
        \\  status TEXT NOT NULL,
        \\  event_cursor INTEGER NOT NULL DEFAULT 0,
        \\  sharing_policy TEXT NOT NULL DEFAULT 'private',
        \\  automation_id TEXT,
        \\  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \\  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        \\);
        \\CREATE INDEX IF NOT EXISTS idx_agent_sessions_updated ON agent_sessions(updated_at DESC);
        \\CREATE INDEX IF NOT EXISTS idx_agent_sessions_node ON agent_sessions(node_id, status);
        \\CREATE TABLE IF NOT EXISTS agent_commands (
        \\  command_id TEXT PRIMARY KEY,
        \\  session_id TEXT NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
        \\  kind TEXT NOT NULL,
        \\  document TEXT NOT NULL,
        \\  state TEXT NOT NULL,
        \\  error TEXT,
        \\  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \\  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        \\);
        \\CREATE INDEX IF NOT EXISTS idx_agent_commands_queue ON agent_commands(session_id, state, created_at);
        \\CREATE TABLE IF NOT EXISTS agent_events (
        \\  session_id TEXT NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
        \\  sequence INTEGER NOT NULL,
        \\  kind TEXT NOT NULL,
        \\  document TEXT NOT NULL,
        \\  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \\  PRIMARY KEY(session_id, sequence)
        \\);
        \\CREATE INDEX IF NOT EXISTS idx_agent_events_created ON agent_events(session_id, created_at);
        \\CREATE TABLE IF NOT EXISTS agent_transcript_entries (
        \\  ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
        \\  session_id TEXT NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
        \\  source_key TEXT NOT NULL,
        \\  document TEXT NOT NULL,
        \\  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \\  UNIQUE(session_id, source_key)
        \\);
        \\CREATE INDEX IF NOT EXISTS idx_agent_transcript_session ON agent_transcript_entries(session_id, ordinal);
    );
    try ensureColumn(database, "harness_version", "ALTER TABLE agent_sessions ADD COLUMN harness_version TEXT");
    try ensureColumn(database, "capabilities_json", "ALTER TABLE agent_sessions ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '[]'");
    try ensureColumn(database, "model_route_id", "ALTER TABLE agent_sessions ADD COLUMN model_route_id TEXT");
    try database.execute(
        \\UPDATE agent_transcript_entries AS transcript
        \\SET document = (
        \\  SELECT json_extract(event.document, '$.event')
        \\  FROM agent_events AS event
        \\  WHERE event.session_id = transcript.session_id
        \\    AND event.sequence = CAST(substr(transcript.source_key, 7) AS INTEGER)
        \\)
        \\WHERE transcript.source_key LIKE 'event:%'
        \\  AND EXISTS (
        \\    SELECT 1 FROM agent_events AS event
        \\    WHERE event.session_id = transcript.session_id
        \\      AND event.sequence = CAST(substr(transcript.source_key, 7) AS INTEGER)
        \\      AND json_extract(event.document, '$.event') IS NOT NULL
        \\  )
    );
}

pub fn get(allocator: std.mem.Allocator, database: *sqlite.Database, session_id: []const u8) !?Session {
    var statement = try database.prepare(
        "SELECT session_id, harness, harness_version, capabilities_json, node_id, native_session_id, project_id, project_path, model_id, model_route_id, status, event_cursor, sharing_policy, automation_id, created_at, updated_at FROM agent_sessions WHERE session_id = ?",
    );
    defer statement.deinit();
    try statement.bindText(1, session_id);
    if (try statement.step() != .row) return null;
    return try readSession(allocator, &statement);
}

pub fn getByNative(allocator: std.mem.Allocator, database: *sqlite.Database, native_session_id: []const u8) !?Session {
    var statement = try database.prepare(
        "SELECT session_id, harness, harness_version, capabilities_json, node_id, native_session_id, project_id, project_path, model_id, model_route_id, status, event_cursor, sharing_policy, automation_id, created_at, updated_at FROM agent_sessions AS session WHERE native_session_id = ? ORDER BY EXISTS (SELECT 1 FROM agent_transcript_entries AS entry WHERE entry.session_id = session.session_id) DESC, updated_at DESC, session.rowid DESC, event_cursor DESC LIMIT 1",
    );
    defer statement.deinit();
    try statement.bindText(1, native_session_id);
    if (try statement.step() != .row) return null;
    return try readSession(allocator, &statement);
}

pub fn list(allocator: std.mem.Allocator, database: *sqlite.Database) !SessionList {
    return querySessions(
        allocator,
        database,
        "SELECT session_id, harness, harness_version, capabilities_json, node_id, native_session_id, project_id, project_path, model_id, model_route_id, status, event_cursor, sharing_policy, automation_id, created_at, updated_at FROM agent_sessions ORDER BY updated_at DESC LIMIT 10000",
    );
}

pub fn listActive(allocator: std.mem.Allocator, database: *sqlite.Database) !SessionList {
    return querySessions(
        allocator,
        database,
        "SELECT session_id, harness, harness_version, capabilities_json, node_id, native_session_id, project_id, project_path, model_id, model_route_id, status, event_cursor, sharing_policy, automation_id, created_at, updated_at FROM agent_sessions WHERE status IN ('queued', 'running', 'waiting', 'retrying') ORDER BY updated_at LIMIT 10000",
    );
}

fn querySessions(allocator: std.mem.Allocator, database: *sqlite.Database, query: []const u8) !SessionList {
    var records: std.ArrayList(Session) = .empty;
    errdefer {
        for (records.items) |*record| record.deinit();
        records.deinit(allocator);
    }
    var statement = try database.prepare(query);
    defer statement.deinit();
    while (try statement.step() == .row) {
        if (records.items.len == max_records) return error.TooManyAgentSessions;
        try records.append(allocator, try readSession(allocator, &statement));
    }
    return .{ .allocator = allocator, .records = try records.toOwnedSlice(allocator) };
}

pub fn save(database: *sqlite.Database, input: SessionInput) !void {
    var statement = try database.prepare(
        \\INSERT INTO agent_sessions (
        \\  session_id, harness, harness_version, capabilities_json, node_id, native_session_id, project_id, project_path,
        \\  model_id, model_route_id, status, event_cursor, sharing_policy, automation_id, updated_at
        \\) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        \\ON CONFLICT(session_id) DO UPDATE SET
        \\  harness = excluded.harness,
        \\  harness_version = COALESCE(excluded.harness_version, agent_sessions.harness_version),
        \\  capabilities_json = excluded.capabilities_json,
        \\  node_id = excluded.node_id,
        \\  native_session_id = COALESCE(excluded.native_session_id, agent_sessions.native_session_id),
        \\  project_id = COALESCE(excluded.project_id, agent_sessions.project_id),
        \\  project_path = COALESCE(excluded.project_path, agent_sessions.project_path),
        \\  model_id = COALESCE(excluded.model_id, agent_sessions.model_id),
        \\  model_route_id = COALESCE(excluded.model_route_id, agent_sessions.model_route_id),
        \\  status = excluded.status,
        \\  event_cursor = MAX(excluded.event_cursor, agent_sessions.event_cursor),
        \\  sharing_policy = excluded.sharing_policy,
        \\  automation_id = COALESCE(excluded.automation_id, agent_sessions.automation_id),
        \\  updated_at = CURRENT_TIMESTAMP
    );
    defer statement.deinit();
    try statement.bindText(1, input.id);
    try statement.bindText(2, input.harness);
    try bindOptionalText(&statement, 3, input.harness_version);
    try statement.bindText(4, input.capabilities_json);
    try statement.bindText(5, input.node_id);
    try bindOptionalText(&statement, 6, input.native_session_id);
    try bindOptionalText(&statement, 7, input.project_id);
    try bindOptionalText(&statement, 8, input.project_path);
    try bindOptionalText(&statement, 9, input.model_id);
    try bindOptionalText(&statement, 10, input.model_route_id);
    try statement.bindText(11, input.status);
    try statement.bindInt(12, @intCast(input.event_cursor));
    try statement.bindText(13, input.sharing_policy);
    try bindOptionalText(&statement, 14, input.automation_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn updateRuntime(database: *sqlite.Database, session_id: []const u8, status: []const u8, native_session_id: ?[]const u8, event_cursor: ?u64) !void {
    var statement = try database.prepare(
        \\UPDATE agent_sessions SET
        \\  status = ?,
        \\  native_session_id = COALESCE(?, native_session_id),
        \\  event_cursor = CASE WHEN ? IS NULL THEN event_cursor ELSE MAX(?, event_cursor) END,
        \\  updated_at = CURRENT_TIMESTAMP
        \\WHERE session_id = ?
    );
    defer statement.deinit();
    try statement.bindText(1, status);
    try bindOptionalText(&statement, 2, native_session_id);
    if (event_cursor) |cursor| {
        try statement.bindInt(3, @intCast(cursor));
        try statement.bindInt(4, @intCast(cursor));
    } else {
        try statement.bindNull(3);
        try statement.bindNull(4);
    }
    try statement.bindText(5, session_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn updateDriver(database: *sqlite.Database, session_id: []const u8, harness_version: ?[]const u8, capabilities_json: ?[]const u8) !void {
    var statement = try database.prepare(
        \\UPDATE agent_sessions SET
        \\  harness_version = COALESCE(?, harness_version),
        \\  capabilities_json = COALESCE(?, capabilities_json),
        \\  updated_at = CURRENT_TIMESTAMP
        \\WHERE session_id = ?
    );
    defer statement.deinit();
    try bindOptionalText(&statement, 1, harness_version);
    try bindOptionalText(&statement, 2, capabilities_json);
    try statement.bindText(3, session_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn enqueueCommand(database: *sqlite.Database, command_id: []const u8, session_id: []const u8, kind: []const u8, document: []const u8) !void {
    var statement = try database.prepare(
        "INSERT INTO agent_commands (command_id, session_id, kind, document, state) VALUES (?, ?, ?, ?, 'queued')",
    );
    defer statement.deinit();
    try statement.bindText(1, command_id);
    try statement.bindText(2, session_id);
    try statement.bindText(3, kind);
    try statement.bindText(4, document);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn finishCommand(database: *sqlite.Database, command_id: []const u8, state: []const u8, failure: ?[]const u8) !void {
    var statement = try database.prepare(
        "UPDATE agent_commands SET state = ?, error = ?, updated_at = CURRENT_TIMESTAMP WHERE command_id = ?",
    );
    defer statement.deinit();
    try statement.bindText(1, state);
    try bindOptionalText(&statement, 2, failure);
    try statement.bindText(3, command_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn appendEvent(database: *sqlite.Database, session_id: []const u8, sequence: u64, kind: []const u8, document: []const u8) !void {
    var statement = try database.prepare(
        \\INSERT INTO agent_events (session_id, sequence, kind, document)
        \\VALUES (?, ?, ?, ?)
        \\ON CONFLICT(session_id, sequence) DO NOTHING
    );
    defer statement.deinit();
    try statement.bindText(1, session_id);
    try statement.bindInt(2, @intCast(sequence));
    try statement.bindText(3, kind);
    try statement.bindText(4, document);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn appendTranscript(database: *sqlite.Database, session_id: []const u8, source_key: []const u8, document: []const u8) !void {
    var statement = try database.prepare(
        \\INSERT INTO agent_transcript_entries (session_id, source_key, document)
        \\VALUES (?, ?, ?)
        \\ON CONFLICT(session_id, source_key) DO UPDATE SET document = excluded.document
    );
    defer statement.deinit();
    try statement.bindText(1, session_id);
    try statement.bindText(2, source_key);
    try statement.bindText(3, document);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn transcript(allocator: std.mem.Allocator, database: *sqlite.Database, session_id: []const u8) !EventList {
    var records: std.ArrayList(Event) = .empty;
    errdefer {
        for (records.items) |*record| record.deinit();
        records.deinit(allocator);
    }
    var statement = try database.prepare(
        "SELECT ordinal, source_key, document, created_at FROM agent_transcript_entries WHERE session_id = ? ORDER BY ordinal LIMIT 10000",
    );
    defer statement.deinit();
    try statement.bindText(1, session_id);
    while (try statement.step() == .row) {
        try records.append(allocator, .{
            .allocator = allocator,
            .sequence = @intCast(statement.columnInt(0)),
            .kind = try requiredColumn(allocator, &statement, 1),
            .document = try requiredColumn(allocator, &statement, 2),
            .created_at = try requiredColumn(allocator, &statement, 3),
        });
    }
    return .{ .allocator = allocator, .records = try records.toOwnedSlice(allocator) };
}

pub fn hasTranscript(database: *sqlite.Database, session_id: []const u8) !bool {
    var statement = try database.prepare("SELECT 1 FROM agent_transcript_entries WHERE session_id = ? LIMIT 1");
    defer statement.deinit();
    try statement.bindText(1, session_id);
    return try statement.step() == .row;
}

pub fn eventsAfter(allocator: std.mem.Allocator, database: *sqlite.Database, session_id: []const u8, after: u64) !EventList {
    var records: std.ArrayList(Event) = .empty;
    errdefer {
        for (records.items) |*record| record.deinit();
        records.deinit(allocator);
    }
    var statement = try database.prepare(
        "SELECT sequence, kind, document, created_at FROM agent_events WHERE session_id = ? AND sequence > ? ORDER BY sequence LIMIT 4000",
    );
    defer statement.deinit();
    try statement.bindText(1, session_id);
    try statement.bindInt(2, @intCast(after));
    while (try statement.step() == .row) {
        try records.append(allocator, .{
            .allocator = allocator,
            .sequence = @intCast(statement.columnInt(0)),
            .kind = try requiredColumn(allocator, &statement, 1),
            .document = try requiredColumn(allocator, &statement, 2),
            .created_at = try requiredColumn(allocator, &statement, 3),
        });
    }
    return .{ .allocator = allocator, .records = try records.toOwnedSlice(allocator) };
}

fn readSession(allocator: std.mem.Allocator, statement: *const sqlite.Statement) !Session {
    return .{
        .allocator = allocator,
        .id = try requiredColumn(allocator, statement, 0),
        .harness = try requiredColumn(allocator, statement, 1),
        .harness_version = try optionalColumn(allocator, statement, 2),
        .capabilities_json = try requiredColumn(allocator, statement, 3),
        .node_id = try requiredColumn(allocator, statement, 4),
        .native_session_id = try optionalColumn(allocator, statement, 5),
        .project_id = try optionalColumn(allocator, statement, 6),
        .project_path = try optionalColumn(allocator, statement, 7),
        .model_id = try optionalColumn(allocator, statement, 8),
        .model_route_id = try optionalColumn(allocator, statement, 9),
        .status = try requiredColumn(allocator, statement, 10),
        .event_cursor = @intCast(@max(statement.columnInt(11), 0)),
        .sharing_policy = try requiredColumn(allocator, statement, 12),
        .automation_id = try optionalColumn(allocator, statement, 13),
        .created_at = try requiredColumn(allocator, statement, 14),
        .updated_at = try requiredColumn(allocator, statement, 15),
    };
}

fn ensureColumn(database: *sqlite.Database, name: []const u8, migration: []const u8) !void {
    var statement = try database.prepare("PRAGMA table_info(agent_sessions)");
    defer statement.deinit();
    while (try statement.step() == .row) {
        if (statement.columnText(1)) |column| if (std.mem.eql(u8, column, name)) return;
    }
    try database.execute(migration);
}

fn bindOptionalText(statement: *sqlite.Statement, index: u31, value: ?[]const u8) !void {
    if (value) |text| try statement.bindText(index, text) else try statement.bindNull(index);
}

fn requiredColumn(allocator: std.mem.Allocator, statement: *const sqlite.Statement, index: u31) ![]u8 {
    return try allocator.dupe(u8, statement.columnText(index) orelse return error.InvalidAgentRecord);
}

fn optionalColumn(allocator: std.mem.Allocator, statement: *const sqlite.Statement, index: u31) !?[]u8 {
    const value = statement.columnText(index) orelse return null;
    return try allocator.dupe(u8, value);
}
