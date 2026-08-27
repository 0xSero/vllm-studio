const std = @import("std");
const sqlite = @import("../../storage/sqlite.zig");

const Io = std.Io;

pub const Worker = struct {
    allocator: std.mem.Allocator,
    id: []u8,
    session_id: []u8,
    attempt_id: []u8,
    provider: []u8,
    account_id: []u8,
    harness: []u8,
    image: []u8,
    provider_id: ?[]u8,
    node_id: ?[]u8,
    address: ?[]u8,
    status: []u8,

    pub fn deinit(worker: *Worker) void {
        worker.allocator.free(worker.id);
        worker.allocator.free(worker.session_id);
        worker.allocator.free(worker.attempt_id);
        worker.allocator.free(worker.provider);
        worker.allocator.free(worker.account_id);
        worker.allocator.free(worker.harness);
        worker.allocator.free(worker.image);
        if (worker.provider_id) |value| worker.allocator.free(value);
        if (worker.node_id) |value| worker.allocator.free(value);
        if (worker.address) |value| worker.allocator.free(value);
        worker.allocator.free(worker.status);
        worker.* = undefined;
    }
};

pub const WorkerList = struct {
    allocator: std.mem.Allocator,
    items: std.ArrayList(Worker) = .empty,

    pub fn deinit(list: *WorkerList) void {
        for (list.items.items) |*worker| worker.deinit();
        list.items.deinit(list.allocator);
        list.* = undefined;
    }
};

pub fn initialize(database: *sqlite.Database) !void {
    try migrateSchema(database);
    try database.executeScript(
        \\CREATE TABLE IF NOT EXISTS agent_cloud_workers (
        \\  worker_id TEXT PRIMARY KEY,
        \\  session_id TEXT NOT NULL REFERENCES agent_execution_sessions(session_id) ON DELETE CASCADE,
        \\  attempt_id TEXT NOT NULL REFERENCES agent_execution_attempts(attempt_id) ON DELETE CASCADE,
        \\  provider TEXT NOT NULL CHECK(provider IN ('daytona', 'vercel')),
        \\  account_id TEXT NOT NULL,
        \\  harness TEXT NOT NULL,
        \\  image TEXT NOT NULL,
        \\  provider_id TEXT,
        \\  node_id TEXT,
        \\  address TEXT,
        \\  status TEXT NOT NULL CHECK(status IN ('provisioning', 'starting', 'ready', 'pausing', 'paused', 'stopping', 'stopped', 'resuming', 'failed', 'deleting', 'deleted')),
        \\  last_error TEXT,
        \\  lease_expires_at TEXT NOT NULL,
        \\  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \\  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        \\);
        \\CREATE INDEX IF NOT EXISTS idx_agent_cloud_workers_session ON agent_cloud_workers(session_id, created_at DESC);
        \\CREATE INDEX IF NOT EXISTS idx_agent_cloud_workers_reconcile ON agent_cloud_workers(status, lease_expires_at);
    );
}

fn migrateSchema(database: *sqlite.Database) !void {
    const needs_migration = check: {
        var statement = try database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_cloud_workers'");
        defer statement.deinit();
        if (try statement.step() != .row) break :check false;
        const definition = statement.columnText(0) orelse break :check false;
        break :check std.mem.indexOf(u8, definition, "CHECK(provider = 'daytona')") != null or std.mem.indexOf(u8, definition, "'pausing'") == null;
    };
    if (!needs_migration) return;
    try database.executeScript(
        \\PRAGMA foreign_keys = OFF;
        \\BEGIN IMMEDIATE;
        \\CREATE TABLE agent_cloud_workers_next (
        \\  worker_id TEXT PRIMARY KEY,
        \\  session_id TEXT NOT NULL REFERENCES agent_execution_sessions(session_id) ON DELETE CASCADE,
        \\  attempt_id TEXT NOT NULL REFERENCES agent_execution_attempts(attempt_id) ON DELETE CASCADE,
        \\  provider TEXT NOT NULL CHECK(provider IN ('daytona', 'vercel')),
        \\  account_id TEXT NOT NULL,
        \\  harness TEXT NOT NULL,
        \\  image TEXT NOT NULL,
        \\  provider_id TEXT,
        \\  node_id TEXT,
        \\  address TEXT,
        \\  status TEXT NOT NULL CHECK(status IN ('provisioning', 'starting', 'ready', 'pausing', 'paused', 'stopping', 'stopped', 'resuming', 'failed', 'deleting', 'deleted')),
        \\  last_error TEXT,
        \\  lease_expires_at TEXT NOT NULL,
        \\  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \\  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        \\);
        \\INSERT INTO agent_cloud_workers_next SELECT * FROM agent_cloud_workers;
        \\DROP TABLE agent_cloud_workers;
        \\ALTER TABLE agent_cloud_workers_next RENAME TO agent_cloud_workers;
        \\CREATE INDEX idx_agent_cloud_workers_session ON agent_cloud_workers(session_id, created_at DESC);
        \\CREATE INDEX idx_agent_cloud_workers_reconcile ON agent_cloud_workers(status, lease_expires_at);
        \\COMMIT;
        \\PRAGMA foreign_keys = ON;
    );
}

pub fn create(database: *sqlite.Database, io: Io, session_id: []const u8, attempt_id: []const u8, provider: []const u8, account_id: []const u8, harness: []const u8, image: []const u8, lease_seconds: u64) ![36]u8 {
    if (!std.mem.eql(u8, provider, "daytona") and !std.mem.eql(u8, provider, "vercel")) return error.InvalidSandboxProvider;
    const worker_id = randomId(io);
    var modifier_buffer: [32]u8 = undefined;
    const modifier = try std.fmt.bufPrint(&modifier_buffer, "+{d} seconds", .{lease_seconds});
    var statement = try database.prepare("INSERT INTO agent_cloud_workers (worker_id, session_id, attempt_id, provider, account_id, harness, image, status, lease_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'provisioning', datetime('now', ?))");
    defer statement.deinit();
    try statement.bindText(1, worker_id[0..]);
    try statement.bindText(2, session_id);
    try statement.bindText(3, attempt_id);
    try statement.bindText(4, provider);
    try statement.bindText(5, account_id);
    try statement.bindText(6, harness);
    try statement.bindText(7, image);
    try statement.bindText(8, modifier);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
    return worker_id;
}

pub fn attach(database: *sqlite.Database, worker_id: []const u8, provider_id: []const u8, node_id: []const u8, address: []const u8) !void {
    var statement = try database.prepare("UPDATE agent_cloud_workers SET provider_id = ?, node_id = ?, address = ?, status = 'ready', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE worker_id = ?");
    defer statement.deinit();
    try statement.bindText(1, provider_id);
    try statement.bindText(2, node_id);
    try statement.bindText(3, address);
    try statement.bindText(4, worker_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn setProvider(database: *sqlite.Database, worker_id: []const u8, provider_id: []const u8) !void {
    var statement = try database.prepare("UPDATE agent_cloud_workers SET provider_id = ?, status = 'starting', last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE worker_id = ?");
    defer statement.deinit();
    try statement.bindText(1, provider_id);
    try statement.bindText(2, worker_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn setStatus(database: *sqlite.Database, worker_id: []const u8, status: []const u8, message: ?[]const u8) !void {
    var statement = try database.prepare("UPDATE agent_cloud_workers SET status = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE worker_id = ?");
    defer statement.deinit();
    try statement.bindText(1, status);
    if (message) |value| try statement.bindText(2, value) else try statement.bindNull(2);
    try statement.bindText(3, worker_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn setReady(database: *sqlite.Database, worker_id: []const u8, lease_seconds: u64) !void {
    var modifier_buffer: [32]u8 = undefined;
    const modifier = try std.fmt.bufPrint(&modifier_buffer, "+{d} seconds", .{lease_seconds});
    var statement = try database.prepare("UPDATE agent_cloud_workers SET status = 'ready', last_error = NULL, lease_expires_at = datetime('now', ?), updated_at = CURRENT_TIMESTAMP WHERE worker_id = ?");
    defer statement.deinit();
    try statement.bindText(1, modifier);
    try statement.bindText(2, worker_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn requestPause(database: *sqlite.Database, session_id: []const u8, delay_seconds: u64) !void {
    var modifier_buffer: [32]u8 = undefined;
    const modifier = try std.fmt.bufPrint(&modifier_buffer, "+{d} seconds", .{delay_seconds});
    var statement = try database.prepare(
        \\UPDATE agent_cloud_workers
        \\SET lease_expires_at = datetime('now', ?), updated_at = CURRENT_TIMESTAMP
        \\WHERE worker_id = (SELECT worker_id FROM agent_cloud_workers WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1)
        \\  AND status = 'ready'
    );
    defer statement.deinit();
    try statement.bindText(1, modifier);
    try statement.bindText(2, session_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn requestDelete(database: *sqlite.Database, session_id: []const u8) !void {
    var statement = try database.prepare(
        \\UPDATE agent_cloud_workers
        \\SET status = 'deleting', last_error = NULL, updated_at = CURRENT_TIMESTAMP
        \\WHERE worker_id = (SELECT worker_id FROM agent_cloud_workers WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1)
        \\  AND status NOT IN ('deleted', 'deleting')
    );
    defer statement.deinit();
    try statement.bindText(1, session_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn latest(allocator: std.mem.Allocator, database: *sqlite.Database, session_id: []const u8) !?Worker {
    var statement = try database.prepare("SELECT worker_id, session_id, attempt_id, provider, account_id, harness, image, provider_id, node_id, address, status FROM agent_cloud_workers WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1");
    defer statement.deinit();
    try statement.bindText(1, session_id);
    if (try statement.step() != .row) return null;
    return try readWorker(allocator, &statement);
}

pub fn reconciliationCandidates(allocator: std.mem.Allocator, database: *sqlite.Database) !WorkerList {
    var statement = try database.prepare(
        \\SELECT worker_id, session_id, attempt_id, provider, account_id, harness, image, provider_id, node_id, address, status
        \\FROM agent_cloud_workers
        \\WHERE (status = 'ready' AND lease_expires_at <= CURRENT_TIMESTAMP)
        \\   OR status = 'deleting'
        \\ORDER BY created_at
    );
    defer statement.deinit();
    var workers = WorkerList{ .allocator = allocator };
    errdefer workers.deinit();
    while (try statement.step() == .row) try workers.items.append(allocator, try readWorker(allocator, &statement));
    return workers;
}

pub fn listPayload(allocator: std.mem.Allocator, database: *sqlite.Database) ![]u8 {
    var statement = try database.prepare("SELECT worker_id, session_id, attempt_id, provider, account_id, harness, image, provider_id, node_id, address, status, lease_expires_at, last_error, created_at, updated_at FROM agent_cloud_workers ORDER BY created_at DESC, rowid DESC");
    defer statement.deinit();
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"workers\":[");
    var first = true;
    while (try statement.step() == .row) {
        if (!first) try output.writer.writeByte(',');
        first = false;
        try output.writer.writeAll("{\"id\":");
        try writeColumn(&output.writer, &statement, 0);
        try output.writer.writeAll(",\"sessionId\":");
        try writeColumn(&output.writer, &statement, 1);
        try output.writer.writeAll(",\"attemptId\":");
        try writeColumn(&output.writer, &statement, 2);
        try output.writer.writeAll(",\"provider\":");
        try writeColumn(&output.writer, &statement, 3);
        try output.writer.writeAll(",\"accountId\":");
        try writeColumn(&output.writer, &statement, 4);
        try output.writer.writeAll(",\"harness\":");
        try writeColumn(&output.writer, &statement, 5);
        try output.writer.writeAll(",\"image\":");
        try writeColumn(&output.writer, &statement, 6);
        try output.writer.writeAll(",\"providerId\":");
        try writeNullableColumn(&output.writer, &statement, 7);
        try output.writer.writeAll(",\"nodeId\":");
        try writeNullableColumn(&output.writer, &statement, 8);
        try output.writer.writeAll(",\"address\":");
        try writeNullableColumn(&output.writer, &statement, 9);
        try output.writer.writeAll(",\"status\":");
        try writeColumn(&output.writer, &statement, 10);
        try output.writer.writeAll(",\"leaseExpiresAt\":");
        try writeColumn(&output.writer, &statement, 11);
        try output.writer.writeAll(",\"error\":");
        try writeNullableColumn(&output.writer, &statement, 12);
        try output.writer.writeAll(",\"createdAt\":");
        try writeColumn(&output.writer, &statement, 13);
        try output.writer.writeAll(",\"updatedAt\":");
        try writeColumn(&output.writer, &statement, 14);
        try output.writer.writeByte('}');
    }
    try output.writer.writeAll("]}");
    return output.toOwnedSlice();
}

fn readWorker(allocator: std.mem.Allocator, statement: *sqlite.Statement) !Worker {
    var worker = Worker{
        .allocator = allocator,
        .id = try allocator.dupe(u8, statement.columnText(0) orelse return error.InvalidCloudWorkerRecord),
        .session_id = undefined,
        .attempt_id = undefined,
        .provider = undefined,
        .account_id = undefined,
        .harness = undefined,
        .image = undefined,
        .provider_id = null,
        .node_id = null,
        .address = null,
        .status = undefined,
    };
    errdefer allocator.free(worker.id);
    worker.session_id = try allocator.dupe(u8, statement.columnText(1) orelse return error.InvalidCloudWorkerRecord);
    errdefer allocator.free(worker.session_id);
    worker.attempt_id = try allocator.dupe(u8, statement.columnText(2) orelse return error.InvalidCloudWorkerRecord);
    errdefer allocator.free(worker.attempt_id);
    worker.provider = try allocator.dupe(u8, statement.columnText(3) orelse return error.InvalidCloudWorkerRecord);
    errdefer allocator.free(worker.provider);
    worker.account_id = try allocator.dupe(u8, statement.columnText(4) orelse return error.InvalidCloudWorkerRecord);
    errdefer allocator.free(worker.account_id);
    worker.harness = try allocator.dupe(u8, statement.columnText(5) orelse return error.InvalidCloudWorkerRecord);
    errdefer allocator.free(worker.harness);
    worker.image = try allocator.dupe(u8, statement.columnText(6) orelse return error.InvalidCloudWorkerRecord);
    errdefer allocator.free(worker.image);
    if (statement.columnText(7)) |value| worker.provider_id = try allocator.dupe(u8, value);
    errdefer if (worker.provider_id) |value| allocator.free(value);
    if (statement.columnText(8)) |value| worker.node_id = try allocator.dupe(u8, value);
    errdefer if (worker.node_id) |value| allocator.free(value);
    if (statement.columnText(9)) |value| worker.address = try allocator.dupe(u8, value);
    errdefer if (worker.address) |value| allocator.free(value);
    worker.status = try allocator.dupe(u8, statement.columnText(10) orelse return error.InvalidCloudWorkerRecord);
    return worker;
}

fn randomId(io: Io) [36]u8 {
    var bytes: [18]u8 = undefined;
    io.random(&bytes);
    return std.fmt.bytesToHex(bytes, .lower);
}

fn writeColumn(writer: *Io.Writer, statement: *sqlite.Statement, column: u31) !void {
    try std.json.Stringify.value(statement.columnText(column) orelse "", .{}, writer);
}

fn writeNullableColumn(writer: *Io.Writer, statement: *sqlite.Statement, column: u31) !void {
    if (statement.columnText(column)) |value| try std.json.Stringify.value(value, .{}, writer) else try writer.writeAll("null");
}
