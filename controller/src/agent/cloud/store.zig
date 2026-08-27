const std = @import("std");
const sqlite = @import("../../storage/sqlite.zig");

const Io = std.Io;

pub const Worker = struct {
    allocator: std.mem.Allocator,
    id: []u8,
    session_id: []u8,
    attempt_id: []u8,
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
    try database.executeScript(
        \\CREATE TABLE IF NOT EXISTS agent_cloud_workers (
        \\  worker_id TEXT PRIMARY KEY,
        \\  session_id TEXT NOT NULL REFERENCES agent_execution_sessions(session_id) ON DELETE CASCADE,
        \\  attempt_id TEXT NOT NULL REFERENCES agent_execution_attempts(attempt_id) ON DELETE CASCADE,
        \\  provider TEXT NOT NULL CHECK(provider = 'daytona'),
        \\  account_id TEXT NOT NULL,
        \\  harness TEXT NOT NULL,
        \\  image TEXT NOT NULL,
        \\  provider_id TEXT,
        \\  node_id TEXT,
        \\  address TEXT,
        \\  status TEXT NOT NULL CHECK(status IN ('provisioning', 'starting', 'ready', 'stopping', 'stopped', 'failed', 'deleting', 'deleted')),
        \\  last_error TEXT,
        \\  lease_expires_at TEXT NOT NULL,
        \\  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \\  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        \\);
        \\CREATE INDEX IF NOT EXISTS idx_agent_cloud_workers_session ON agent_cloud_workers(session_id, created_at DESC);
        \\CREATE INDEX IF NOT EXISTS idx_agent_cloud_workers_reconcile ON agent_cloud_workers(status, lease_expires_at);
    );
}

pub fn create(database: *sqlite.Database, io: Io, session_id: []const u8, attempt_id: []const u8, account_id: []const u8, harness: []const u8, image: []const u8, lease_seconds: u64) ![36]u8 {
    const worker_id = randomId(io);
    var modifier_buffer: [32]u8 = undefined;
    const modifier = try std.fmt.bufPrint(&modifier_buffer, "+{d} seconds", .{lease_seconds});
    var statement = try database.prepare("INSERT INTO agent_cloud_workers (worker_id, session_id, attempt_id, provider, account_id, harness, image, status, lease_expires_at) VALUES (?, ?, ?, 'daytona', ?, ?, ?, 'provisioning', datetime('now', ?))");
    defer statement.deinit();
    try statement.bindText(1, worker_id[0..]);
    try statement.bindText(2, session_id);
    try statement.bindText(3, attempt_id);
    try statement.bindText(4, account_id);
    try statement.bindText(5, harness);
    try statement.bindText(6, image);
    try statement.bindText(7, modifier);
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

pub fn setStatus(database: *sqlite.Database, worker_id: []const u8, status: []const u8, message: ?[]const u8) !void {
    var statement = try database.prepare("UPDATE agent_cloud_workers SET status = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE worker_id = ?");
    defer statement.deinit();
    try statement.bindText(1, status);
    if (message) |value| try statement.bindText(2, value) else try statement.bindNull(2);
    try statement.bindText(3, worker_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn latest(allocator: std.mem.Allocator, database: *sqlite.Database, session_id: []const u8) !?Worker {
    var statement = try database.prepare("SELECT worker_id, session_id, attempt_id, account_id, harness, image, provider_id, node_id, address, status FROM agent_cloud_workers WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1");
    defer statement.deinit();
    try statement.bindText(1, session_id);
    if (try statement.step() != .row) return null;
    return readWorker(allocator, &statement);
}

pub fn reconciliationCandidates(allocator: std.mem.Allocator, database: *sqlite.Database) !WorkerList {
    var statement = try database.prepare(
        \\SELECT worker_id, session_id, attempt_id, account_id, harness, image, provider_id, node_id, address, status
        \\FROM agent_cloud_workers
        \\WHERE (status = 'ready' AND lease_expires_at <= CURRENT_TIMESTAMP)
        \\   OR (status = 'stopped' AND EXISTS (SELECT 1 FROM agent_execution_checkpoints checkpoint WHERE checkpoint.session_id = agent_cloud_workers.session_id))
        \\   OR status = 'failed'
        \\ORDER BY created_at
    );
    defer statement.deinit();
    var workers = WorkerList{ .allocator = allocator };
    errdefer workers.deinit();
    while (try statement.step() == .row) try workers.items.append(allocator, try readWorker(allocator, &statement));
    return workers;
}

pub fn listPayload(allocator: std.mem.Allocator, database: *sqlite.Database) ![]u8 {
    var statement = try database.prepare("SELECT worker_id, session_id, attempt_id, account_id, harness, image, provider_id, node_id, address, status, lease_expires_at, last_error, created_at, updated_at FROM agent_cloud_workers ORDER BY created_at DESC, rowid DESC");
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
        try output.writer.writeAll(",\"accountId\":");
        try writeColumn(&output.writer, &statement, 3);
        try output.writer.writeAll(",\"harness\":");
        try writeColumn(&output.writer, &statement, 4);
        try output.writer.writeAll(",\"image\":");
        try writeColumn(&output.writer, &statement, 5);
        try output.writer.writeAll(",\"providerId\":");
        try writeNullableColumn(&output.writer, &statement, 6);
        try output.writer.writeAll(",\"nodeId\":");
        try writeNullableColumn(&output.writer, &statement, 7);
        try output.writer.writeAll(",\"address\":");
        try writeNullableColumn(&output.writer, &statement, 8);
        try output.writer.writeAll(",\"status\":");
        try writeColumn(&output.writer, &statement, 9);
        try output.writer.writeAll(",\"leaseExpiresAt\":");
        try writeColumn(&output.writer, &statement, 10);
        try output.writer.writeAll(",\"error\":");
        try writeNullableColumn(&output.writer, &statement, 11);
        try output.writer.writeAll(",\"createdAt\":");
        try writeColumn(&output.writer, &statement, 12);
        try output.writer.writeAll(",\"updatedAt\":");
        try writeColumn(&output.writer, &statement, 13);
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
    worker.account_id = try allocator.dupe(u8, statement.columnText(3) orelse return error.InvalidCloudWorkerRecord);
    errdefer allocator.free(worker.account_id);
    worker.harness = try allocator.dupe(u8, statement.columnText(4) orelse return error.InvalidCloudWorkerRecord);
    errdefer allocator.free(worker.harness);
    worker.image = try allocator.dupe(u8, statement.columnText(5) orelse return error.InvalidCloudWorkerRecord);
    errdefer allocator.free(worker.image);
    if (statement.columnText(6)) |value| worker.provider_id = try allocator.dupe(u8, value);
    errdefer if (worker.provider_id) |value| allocator.free(value);
    if (statement.columnText(7)) |value| worker.node_id = try allocator.dupe(u8, value);
    errdefer if (worker.node_id) |value| allocator.free(value);
    if (statement.columnText(8)) |value| worker.address = try allocator.dupe(u8, value);
    errdefer if (worker.address) |value| allocator.free(value);
    worker.status = try allocator.dupe(u8, statement.columnText(9) orelse return error.InvalidCloudWorkerRecord);
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
