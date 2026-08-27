const std = @import("std");
const sqlite = @import("../../storage/sqlite.zig");

const Io = std.Io;

pub const SessionKind = enum { chat, project };
pub const Placement = enum { head, local, node, sandbox };

pub const SessionInput = struct {
    id: []const u8,
    kind: SessionKind,
    workspace: ?[]const u8,
    harness: ?[]const u8,
    project_id: ?[]const u8,
    model_id: []const u8,
    model_route_id: ?[]const u8,
};

pub const TurnAttempt = struct {
    turn_id: [36]u8,
    attempt_id: [36]u8,
};

pub fn initialize(database: *sqlite.Database) !void {
    try migratePlacement(database);
    try database.executeScript(
        \\CREATE TABLE IF NOT EXISTS agent_execution_sessions (
        \\  session_id TEXT PRIMARY KEY,
        \\  kind TEXT NOT NULL CHECK(kind IN ('chat', 'project')),
        \\  workspace TEXT,
        \\  harness TEXT,
        \\  project_id TEXT,
        \\  model_id TEXT NOT NULL,
        \\  model_route_id TEXT,
        \\  status TEXT NOT NULL DEFAULT 'idle',
        \\  failure TEXT,
        \\  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \\  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \\  CHECK((kind = 'chat' AND workspace IS NULL AND harness IS NULL) OR (kind = 'project' AND workspace IS NOT NULL AND harness IS NOT NULL))
        \\);
        \\CREATE TABLE IF NOT EXISTS agent_execution_turns (
        \\  turn_id TEXT PRIMARY KEY,
        \\  session_id TEXT NOT NULL REFERENCES agent_execution_sessions(session_id) ON DELETE CASCADE,
        \\  ordinal INTEGER NOT NULL,
        \\  prompt TEXT NOT NULL,
        \\  status TEXT NOT NULL,
        \\  failure TEXT,
        \\  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \\  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \\  UNIQUE(session_id, ordinal)
        \\);
        \\CREATE INDEX IF NOT EXISTS idx_agent_execution_turns_session ON agent_execution_turns(session_id, ordinal DESC);
        \\CREATE TABLE IF NOT EXISTS agent_execution_attempts (
        \\  attempt_id TEXT PRIMARY KEY,
        \\  turn_id TEXT NOT NULL REFERENCES agent_execution_turns(turn_id) ON DELETE CASCADE,
        \\  session_id TEXT NOT NULL REFERENCES agent_execution_sessions(session_id) ON DELETE CASCADE,
        \\  ordinal INTEGER NOT NULL,
        \\  placement TEXT NOT NULL CHECK(placement IN ('head', 'local', 'node', 'sandbox')),
        \\  placement_id TEXT,
        \\  native_session_id TEXT,
        \\  status TEXT NOT NULL,
        \\  failure TEXT,
        \\  lease_owner TEXT,
        \\  lease_expires_at TEXT,
        \\  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \\  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \\  UNIQUE(turn_id, ordinal)
        \\);
        \\CREATE INDEX IF NOT EXISTS idx_agent_execution_attempts_lease ON agent_execution_attempts(status, lease_expires_at);
        \\CREATE TABLE IF NOT EXISTS agent_execution_checkpoints (
        \\  checkpoint_id TEXT PRIMARY KEY,
        \\  session_id TEXT NOT NULL REFERENCES agent_execution_sessions(session_id) ON DELETE CASCADE,
        \\  attempt_id TEXT REFERENCES agent_execution_attempts(attempt_id) ON DELETE SET NULL,
        \\  event_cursor INTEGER NOT NULL DEFAULT 0,
        \\  repository_url TEXT,
        \\  git_ref TEXT,
        \\  git_sha TEXT,
        \\  browser_state_ref TEXT,
        \\  document TEXT NOT NULL DEFAULT '{}',
        \\  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        \\);
        \\CREATE INDEX IF NOT EXISTS idx_agent_execution_checkpoints_session ON agent_execution_checkpoints(session_id, created_at DESC);
        \\CREATE TABLE IF NOT EXISTS agent_execution_children (
        \\  session_id TEXT NOT NULL REFERENCES agent_execution_sessions(session_id) ON DELETE CASCADE,
        \\  child_id TEXT NOT NULL,
        \\  attempt_id TEXT REFERENCES agent_execution_attempts(attempt_id) ON DELETE SET NULL,
        \\  harness TEXT NOT NULL,
        \\  title TEXT,
        \\  status TEXT NOT NULL,
        \\  failure TEXT,
        \\  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \\  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \\  PRIMARY KEY(session_id, child_id)
        \\);
        \\CREATE INDEX IF NOT EXISTS idx_agent_execution_children_status ON agent_execution_children(session_id, status, updated_at);
        \\CREATE TABLE IF NOT EXISTS agent_execution_tools (
        \\  session_id TEXT NOT NULL REFERENCES agent_execution_sessions(session_id) ON DELETE CASCADE,
        \\  tool_call_id TEXT NOT NULL,
        \\  attempt_id TEXT REFERENCES agent_execution_attempts(attempt_id) ON DELETE SET NULL,
        \\  child_id TEXT,
        \\  name TEXT,
        \\  status TEXT NOT NULL,
        \\  failure TEXT,
        \\  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \\  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \\  PRIMARY KEY(session_id, tool_call_id)
        \\);
        \\CREATE INDEX IF NOT EXISTS idx_agent_execution_tools_status ON agent_execution_tools(session_id, status, updated_at);
    );
    try ensureColumn(database, "agent_execution_sessions", "failure", "ALTER TABLE agent_execution_sessions ADD COLUMN failure TEXT");
    try ensureColumn(database, "agent_execution_turns", "failure", "ALTER TABLE agent_execution_turns ADD COLUMN failure TEXT");
    try ensureColumn(database, "agent_execution_attempts", "failure", "ALTER TABLE agent_execution_attempts ADD COLUMN failure TEXT");
}

fn migratePlacement(database: *sqlite.Database) !void {
    const needs_migration = check: {
        var statement = try database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_execution_attempts'");
        defer statement.deinit();
        if (try statement.step() != .row) break :check false;
        const definition = statement.columnText(0) orelse break :check false;
        break :check std.mem.indexOf(u8, definition, "'daytona'") != null;
    };
    if (!needs_migration) return;
    try database.executeScript(
        \\PRAGMA foreign_keys = OFF;
        \\BEGIN IMMEDIATE;
        \\CREATE TABLE agent_execution_attempts_next (
        \\  attempt_id TEXT PRIMARY KEY,
        \\  turn_id TEXT NOT NULL REFERENCES agent_execution_turns(turn_id) ON DELETE CASCADE,
        \\  session_id TEXT NOT NULL REFERENCES agent_execution_sessions(session_id) ON DELETE CASCADE,
        \\  ordinal INTEGER NOT NULL,
        \\  placement TEXT NOT NULL CHECK(placement IN ('head', 'local', 'node', 'sandbox')),
        \\  placement_id TEXT,
        \\  native_session_id TEXT,
        \\  status TEXT NOT NULL,
        \\  failure TEXT,
        \\  lease_owner TEXT,
        \\  lease_expires_at TEXT,
        \\  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \\  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \\  UNIQUE(turn_id, ordinal)
        \\);
        \\INSERT INTO agent_execution_attempts_next (attempt_id, turn_id, session_id, ordinal, placement, placement_id, native_session_id, status, failure, lease_owner, lease_expires_at, created_at, updated_at)
        \\SELECT attempt_id, turn_id, session_id, ordinal, CASE placement WHEN 'daytona' THEN 'sandbox' ELSE placement END, placement_id, native_session_id, status, failure, lease_owner, lease_expires_at, created_at, updated_at FROM agent_execution_attempts;
        \\DROP TABLE agent_execution_attempts;
        \\ALTER TABLE agent_execution_attempts_next RENAME TO agent_execution_attempts;
        \\CREATE INDEX idx_agent_execution_attempts_lease ON agent_execution_attempts(status, lease_expires_at);
        \\COMMIT;
        \\PRAGMA foreign_keys = ON;
    );
}

pub fn ensureSession(database: *sqlite.Database, input: SessionInput) !void {
    if (input.kind == .chat and (input.workspace != null or input.harness != null)) return error.InvalidChatSession;
    if (input.kind == .project and (input.workspace == null or input.harness == null)) return error.InvalidProjectTask;
    if (try sessionExists(database, input)) {
        try updateModel(database, input);
        return;
    }
    var statement = try database.prepare(
        "INSERT INTO agent_execution_sessions (session_id, kind, workspace, harness, project_id, model_id, model_route_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    defer statement.deinit();
    try statement.bindText(1, input.id);
    try statement.bindText(2, @tagName(input.kind));
    try bindOptional(&statement, 3, input.workspace);
    try bindOptional(&statement, 4, input.harness);
    try bindOptional(&statement, 5, input.project_id);
    try statement.bindText(6, input.model_id);
    try bindOptional(&statement, 7, input.model_route_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn beginTurn(database: *sqlite.Database, io: Io, session_id: []const u8, prompt: []const u8, placement: Placement, placement_id: ?[]const u8, lease_owner: []const u8, lease_seconds: u64) !TurnAttempt {
    var transaction = try database.begin();
    defer transaction.deinit();
    const turn_ordinal = try nextOrdinal(database, "agent_execution_turns", "session_id", session_id);
    const turn_id = randomId(io);
    var turn = try database.prepare("INSERT INTO agent_execution_turns (turn_id, session_id, ordinal, prompt, status) VALUES (?, ?, ?, ?, 'queued')");
    defer turn.deinit();
    try turn.bindText(1, turn_id[0..]);
    try turn.bindText(2, session_id);
    try turn.bindInt(3, @intCast(turn_ordinal));
    try turn.bindText(4, prompt);
    if (try turn.step() != .done) return error.DatabaseUnexpectedRow;

    const attempt_id = randomId(io);
    var attempt = try database.prepare(
        "INSERT INTO agent_execution_attempts (attempt_id, turn_id, session_id, ordinal, placement, placement_id, status, lease_owner, lease_expires_at) VALUES (?, ?, ?, 1, ?, ?, 'queued', ?, datetime('now', ?))",
    );
    defer attempt.deinit();
    try attempt.bindText(1, attempt_id[0..]);
    try attempt.bindText(2, turn_id[0..]);
    try attempt.bindText(3, session_id);
    try attempt.bindText(4, @tagName(placement));
    try bindOptional(&attempt, 5, placement_id);
    try attempt.bindText(6, lease_owner);
    var modifier_buffer: [32]u8 = undefined;
    const modifier = try std.fmt.bufPrint(&modifier_buffer, "+{d} seconds", .{lease_seconds});
    try attempt.bindText(7, modifier);
    if (try attempt.step() != .done) return error.DatabaseUnexpectedRow;
    try setSessionStatus(database, session_id, "queued");
    try transaction.commit();
    return .{ .turn_id = turn_id, .attempt_id = attempt_id };
}

pub fn setAttemptStatus(database: *sqlite.Database, attempt_id: []const u8, status: []const u8, native_session_id: ?[]const u8) !void {
    var statement = try database.prepare("UPDATE agent_execution_attempts SET status = ?, native_session_id = COALESCE(?, native_session_id), updated_at = CURRENT_TIMESTAMP WHERE attempt_id = ?");
    defer statement.deinit();
    try statement.bindText(1, status);
    try bindOptional(&statement, 2, native_session_id);
    try statement.bindText(3, attempt_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn setAttemptPlacementId(database: *sqlite.Database, attempt_id: []const u8, placement_id: []const u8) !void {
    var statement = try database.prepare("UPDATE agent_execution_attempts SET placement_id = ?, updated_at = CURRENT_TIMESTAMP WHERE attempt_id = ?");
    defer statement.deinit();
    try statement.bindText(1, placement_id);
    try statement.bindText(2, attempt_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn setTurnStatus(database: *sqlite.Database, turn_id: []const u8, session_id: []const u8, status: []const u8) !void {
    var transaction = try database.begin();
    defer transaction.deinit();
    var statement = try database.prepare("UPDATE agent_execution_turns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE turn_id = ? AND session_id = ?");
    defer statement.deinit();
    try statement.bindText(1, status);
    try statement.bindText(2, turn_id);
    try statement.bindText(3, session_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
    try setSessionStatus(database, session_id, status);
    try transaction.commit();
}

pub fn setLatestStatus(database: *sqlite.Database, session_id: []const u8, status: []const u8, native_session_id: ?[]const u8, failure: ?[]const u8) !void {
    const turn_status = if (std.mem.eql(u8, status, "idle")) "completed" else status;
    var attempt = try database.prepare(
        "UPDATE agent_execution_attempts SET status = ?, native_session_id = COALESCE(?, native_session_id), failure = ?, updated_at = CURRENT_TIMESTAMP WHERE attempt_id = (SELECT attempt_id FROM agent_execution_attempts WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1)",
    );
    defer attempt.deinit();
    try attempt.bindText(1, turn_status);
    try bindOptional(&attempt, 2, native_session_id);
    try bindOptional(&attempt, 3, failure);
    try attempt.bindText(4, session_id);
    if (try attempt.step() != .done) return error.DatabaseUnexpectedRow;
    var turn = try database.prepare(
        "UPDATE agent_execution_turns SET status = ?, failure = ?, updated_at = CURRENT_TIMESTAMP WHERE turn_id = (SELECT turn_id FROM agent_execution_attempts WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1)",
    );
    defer turn.deinit();
    try turn.bindText(1, turn_status);
    try bindOptional(&turn, 2, failure);
    try turn.bindText(3, session_id);
    if (try turn.step() != .done) return error.DatabaseUnexpectedRow;
    var session = try database.prepare("UPDATE agent_execution_sessions SET status = ?, failure = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?");
    defer session.deinit();
    try session.bindText(1, status);
    try bindOptional(&session, 2, failure);
    try session.bindText(3, session_id);
    if (try session.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn expireLeases(database: *sqlite.Database) !void {
    try database.execute("UPDATE agent_execution_attempts SET status = 'interrupted', lease_owner = NULL, lease_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE status IN ('queued', 'running') AND lease_expires_at IS NOT NULL AND lease_expires_at <= CURRENT_TIMESTAMP");
}

pub fn saveCheckpoint(database: *sqlite.Database, io: Io, session_id: []const u8, event_cursor: u64, repository_url: ?[]const u8, git_ref: []const u8, git_sha: []const u8, document: []const u8) ![36]u8 {
    const checkpoint_id = randomId(io);
    var statement = try database.prepare("INSERT INTO agent_execution_checkpoints (checkpoint_id, session_id, event_cursor, repository_url, git_ref, git_sha, document) VALUES (?, ?, ?, ?, ?, ?, ?)");
    defer statement.deinit();
    try statement.bindText(1, checkpoint_id[0..]);
    try statement.bindText(2, session_id);
    try statement.bindInt(3, @intCast(event_cursor));
    try bindOptional(&statement, 4, repository_url);
    try statement.bindText(5, git_ref);
    try statement.bindText(6, git_sha);
    try statement.bindText(7, document);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
    return checkpoint_id;
}

pub fn hasSession(database: *sqlite.Database, session_id: []const u8) !bool {
    var statement = try database.prepare("SELECT 1 FROM agent_execution_sessions WHERE session_id = ?");
    defer statement.deinit();
    try statement.bindText(1, session_id);
    return try statement.step() == .row;
}

pub fn observeHarnessEvent(database: *sqlite.Database, session_id: []const u8, harness: []const u8, envelope: std.json.Value) !void {
    if (envelope != .object) return;
    if (envelope.object.get("native")) |native| try observeChild(database, session_id, harness, native);
    const event = envelope.object.get("event") orelse return;
    if (event != .object) return;
    const event_type = stringField(event.object, "type") orelse return;
    if (!std.mem.eql(u8, event_type, "tool_execution_start") and !std.mem.eql(u8, event_type, "tool_execution_update") and !std.mem.eql(u8, event_type, "tool_execution_end")) return;
    const tool_call_id = stringField(event.object, "toolCallId") orelse return;
    const status = if (std.mem.eql(u8, event_type, "tool_execution_end"))
        if (boolField(event.object, "isError") orelse false) "failed" else "completed"
    else
        "running";
    const failure = if (std.mem.eql(u8, status, "failed")) toolResultText(event.object) else null;
    const child_id = if (envelope.object.get("native")) |native| childId(native) else null;
    var statement = try database.prepare(
        \\INSERT INTO agent_execution_tools (session_id, tool_call_id, attempt_id, child_id, name, status, failure)
        \\VALUES (?, ?, (SELECT attempt_id FROM agent_execution_attempts WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1), ?, ?, ?, ?)
        \\ON CONFLICT(session_id, tool_call_id) DO UPDATE SET
        \\  child_id = COALESCE(excluded.child_id, child_id),
        \\  name = COALESCE(excluded.name, name),
        \\  status = excluded.status,
        \\  failure = excluded.failure,
        \\  updated_at = CURRENT_TIMESTAMP
    );
    defer statement.deinit();
    try statement.bindText(1, session_id);
    try statement.bindText(2, tool_call_id);
    try statement.bindText(3, session_id);
    try bindOptional(&statement, 4, child_id);
    try bindOptional(&statement, 5, stringField(event.object, "toolName"));
    try statement.bindText(6, status);
    try bindOptional(&statement, 7, failure);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

fn observeChild(database: *sqlite.Database, session_id: []const u8, harness: []const u8, native: std.json.Value) !void {
    const current_child_id = childId(native);
    if (current_child_id) |id| {
        const title = childTitle(native);
        var insert = try database.prepare(
            \\INSERT INTO agent_execution_children (session_id, child_id, attempt_id, harness, title, status)
            \\VALUES (?, ?, (SELECT attempt_id FROM agent_execution_attempts WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1), ?, ?, 'running')
            \\ON CONFLICT(session_id, child_id) DO UPDATE SET title = COALESCE(excluded.title, title), updated_at = CURRENT_TIMESTAMP
        );
        defer insert.deinit();
        try insert.bindText(1, session_id);
        try insert.bindText(2, id);
        try insert.bindText(3, session_id);
        try insert.bindText(4, harness);
        try bindOptional(&insert, 5, title);
        if (try insert.step() != .done) return error.DatabaseUnexpectedRow;
    }
    const completion = childCompletion(native) orelse return;
    var update = try database.prepare("UPDATE agent_execution_children SET status = ?, failure = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ? AND child_id = ?");
    defer update.deinit();
    try update.bindText(1, completion.status);
    try bindOptional(&update, 2, completion.failure);
    try update.bindText(3, session_id);
    try update.bindText(4, completion.id);
    if (try update.step() != .done) return error.DatabaseUnexpectedRow;
}

const ChildCompletion = struct {
    id: []const u8,
    status: []const u8,
    failure: ?[]const u8,
};

fn childCompletion(native: std.json.Value) ?ChildCompletion {
    if (native != .object) return null;
    const params = native.object.get("params") orelse return null;
    if (params != .object) return null;
    const update = params.object.get("update") orelse return null;
    if (update != .object or !std.mem.eql(u8, stringField(update.object, "sessionUpdate") orelse "", "tool_call_update")) return null;
    const status = stringField(update.object, "status") orelse return null;
    if (!std.mem.eql(u8, status, "completed") and !std.mem.eql(u8, status, "failed")) return null;
    const raw_output = update.object.get("rawOutput") orelse return null;
    if (raw_output != .object) return null;
    const metadata = raw_output.object.get("metadata") orelse return null;
    if (metadata != .object) return null;
    const child_id = stringField(metadata.object, "sessionID") orelse return null;
    const child_status = stringField(metadata.object, "status") orelse status;
    if (!std.mem.eql(u8, child_status, "completed") and !std.mem.eql(u8, child_status, "failed")) return null;
    return .{
        .id = child_id,
        .status = child_status,
        .failure = if (std.mem.eql(u8, child_status, "failed")) stringField(raw_output.object, "error") else null,
    };
}

fn childId(native: std.json.Value) ?[]const u8 {
    const child = childMetadata(native) orelse return null;
    return stringField(child, "id");
}

fn childTitle(native: std.json.Value) ?[]const u8 {
    const child = childMetadata(native) orelse return null;
    return stringField(child, "title");
}

fn childMetadata(native: std.json.Value) ?std.json.ObjectMap {
    if (native != .object) return null;
    const params = native.object.get("params") orelse return null;
    if (params != .object) return null;
    const update = params.object.get("update") orelse return null;
    if (update != .object) return null;
    const metadata = update.object.get("_meta") orelse return null;
    if (metadata != .object) return null;
    const child = metadata.object.get("opencode/child-session") orelse return null;
    if (child != .object) return null;
    return child.object;
}

fn toolResultText(object: std.json.ObjectMap) ?[]const u8 {
    const result = object.get("result") orelse return null;
    if (result != .object) return null;
    const content = result.object.get("content") orelse return null;
    if (content != .array) return null;
    for (content.array.items) |item| {
        if (item != .object) continue;
        if (stringField(item.object, "text")) |text| return text;
    }
    return null;
}

fn sessionExists(database: *sqlite.Database, input: SessionInput) !bool {
    var statement = try database.prepare("SELECT kind, workspace, harness FROM agent_execution_sessions WHERE session_id = ?");
    defer statement.deinit();
    try statement.bindText(1, input.id);
    if (try statement.step() != .row) return false;
    if (!std.mem.eql(u8, statement.columnText(0) orelse "", @tagName(input.kind))) return error.SessionKindMismatch;
    if (!equalOptional(statement.columnText(1), input.workspace)) return error.SessionWorkspaceMismatch;
    if (!equalOptional(statement.columnText(2), input.harness)) return error.SessionHarnessMismatch;
    return true;
}

fn updateModel(database: *sqlite.Database, input: SessionInput) !void {
    var statement = try database.prepare("UPDATE agent_execution_sessions SET model_id = ?, model_route_id = COALESCE(?, model_route_id), project_id = COALESCE(?, project_id), updated_at = CURRENT_TIMESTAMP WHERE session_id = ?");
    defer statement.deinit();
    try statement.bindText(1, input.model_id);
    try bindOptional(&statement, 2, input.model_route_id);
    try bindOptional(&statement, 3, input.project_id);
    try statement.bindText(4, input.id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

fn setSessionStatus(database: *sqlite.Database, session_id: []const u8, status: []const u8) !void {
    var statement = try database.prepare("UPDATE agent_execution_sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?");
    defer statement.deinit();
    try statement.bindText(1, status);
    try statement.bindText(2, session_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

fn nextOrdinal(database: *sqlite.Database, table: []const u8, column: []const u8, value: []const u8) !u64 {
    var query_buffer: [192]u8 = undefined;
    const query = try std.fmt.bufPrint(&query_buffer, "SELECT COALESCE(MAX(ordinal), 0) + 1 FROM {s} WHERE {s} = ?", .{ table, column });
    var statement = try database.prepare(query);
    defer statement.deinit();
    try statement.bindText(1, value);
    if (try statement.step() != .row) return error.DatabaseQueryFailed;
    return @intCast(statement.columnInt(0));
}

fn randomId(io: Io) [36]u8 {
    var bytes: [18]u8 = undefined;
    io.random(&bytes);
    const hex = std.fmt.bytesToHex(bytes, .lower);
    return hex;
}

fn bindOptional(statement: *sqlite.Statement, index: u31, value: ?[]const u8) !void {
    if (value) |present| try statement.bindText(index, present) else try statement.bindNull(index);
}

fn equalOptional(left: ?[]const u8, right: ?[]const u8) bool {
    if (left == null or right == null) return left == null and right == null;
    return std.mem.eql(u8, left.?, right.?);
}

fn ensureColumn(database: *sqlite.Database, table: []const u8, name: []const u8, migration: []const u8) !void {
    var query_buffer: [128]u8 = undefined;
    const query = try std.fmt.bufPrint(&query_buffer, "PRAGMA table_info({s})", .{table});
    var statement = try database.prepare(query);
    defer statement.deinit();
    while (try statement.step() == .row) {
        if (statement.columnText(1)) |column| if (std.mem.eql(u8, column, name)) return;
    }
    try database.execute(migration);
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    return value.string;
}

fn boolField(object: std.json.ObjectMap, name: []const u8) ?bool {
    const value = object.get(name) orelse return null;
    if (value != .bool) return null;
    return value.bool;
}
