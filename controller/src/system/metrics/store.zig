const std = @import("std");
const sqlite = @import("../../storage/sqlite.zig");

pub fn initialize(database: *sqlite.Database) !void {
    try database.executeScript(
        \\CREATE TABLE IF NOT EXISTS peak_metrics (
        \\  model_id TEXT PRIMARY KEY,
        \\  prefill_tps REAL,
        \\  generation_tps REAL,
        \\  ttft_ms REAL,
        \\  total_tokens INTEGER DEFAULT 0,
        \\  total_requests INTEGER DEFAULT 0,
        \\  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        \\);
        \\CREATE TABLE IF NOT EXISTS peak_metric_sessions (
        \\  session_id TEXT PRIMARY KEY,
        \\  model_id TEXT NOT NULL,
        \\  peak_prefill_tps REAL,
        \\  peak_generation_tps REAL,
        \\  best_ttft_ms REAL,
        \\  started_at TEXT DEFAULT CURRENT_TIMESTAMP,
        \\  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        \\);
        \\CREATE INDEX IF NOT EXISTS idx_peak_metric_sessions_model_updated ON peak_metric_sessions(model_id, updated_at);
    );
}

pub fn onePayload(allocator: std.mem.Allocator, database: *sqlite.Database, model_id: []const u8) !?[]u8 {
    var statement = try database.prepare(
        "SELECT model_id, prefill_tps, generation_tps, ttft_ms, total_tokens, total_requests, updated_at FROM peak_metrics WHERE model_id = ?",
    );
    defer statement.deinit();
    try statement.bindText(1, model_id);
    if (try statement.step() != .row) return null;
    return @as(?[]u8, try writeRow(allocator, &statement, false));
}

pub fn allPayload(allocator: std.mem.Allocator, database: *sqlite.Database) ![]u8 {
    var statement = try database.prepare(
        \\SELECT p.model_id, p.prefill_tps, p.generation_tps, p.ttft_ms, p.total_tokens, p.total_requests, p.updated_at,
        \\       s.session_id, s.peak_prefill_tps, s.peak_generation_tps, s.best_ttft_ms
        \\FROM peak_metrics p
        \\LEFT JOIN peak_metric_sessions s ON s.session_id = (
        \\  SELECT session_id FROM peak_metric_sessions
        \\  WHERE model_id = p.model_id
        \\  ORDER BY COALESCE(peak_generation_tps, 0) DESC, COALESCE(peak_prefill_tps, 0) DESC, updated_at DESC
        \\  LIMIT 1
        \\)
        \\ORDER BY p.model_id
    );
    defer statement.deinit();
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"metrics\":[");
    var count: usize = 0;
    while (try statement.step() == .row) {
        const row = try writeRow(allocator, &statement, true);
        defer allocator.free(row);
        if (count > 0) try output.writer.writeByte(',');
        count += 1;
        try output.writer.writeAll(row);
    }
    try output.writer.writeAll("]}");
    return output.toOwnedSlice();
}

pub fn updateBenchmarkPayload(allocator: std.mem.Allocator, database: *sqlite.Database, model_id: []const u8, generation_tps: f64, completion_tokens: i64) ![]u8 {
    var statement = try database.prepare(
        \\INSERT INTO peak_metrics (model_id, generation_tps, total_tokens, total_requests, updated_at)
        \\VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
        \\ON CONFLICT(model_id) DO UPDATE SET
        \\  generation_tps = CASE
        \\    WHEN peak_metrics.generation_tps IS NULL OR excluded.generation_tps > peak_metrics.generation_tps THEN excluded.generation_tps
        \\    ELSE peak_metrics.generation_tps
        \\  END,
        \\  total_tokens = peak_metrics.total_tokens + excluded.total_tokens,
        \\  total_requests = peak_metrics.total_requests + 1,
        \\  updated_at = CURRENT_TIMESTAMP
    );
    defer statement.deinit();
    try statement.bindText(1, model_id);
    try statement.bindFloat(2, generation_tps);
    try statement.bindInt(3, completion_tokens);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
    return (try onePayload(allocator, database, model_id)) orelse error.DatabaseQueryFailed;
}

fn writeRow(allocator: std.mem.Allocator, statement: *const sqlite.Statement, include_session: bool) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeByte('{');
    try writeTextField(&output.writer, "model_id", statement.columnText(0), false);
    try writeNumberField(&output.writer, "prefill_tps", statement, 1);
    try writeNumberField(&output.writer, "generation_tps", statement, 2);
    try writeNumberField(&output.writer, "ttft_ms", statement, 3);
    try writeIntegerField(&output.writer, "total_tokens", statement, 4);
    try writeIntegerField(&output.writer, "total_requests", statement, 5);
    try writeTextField(&output.writer, "updated_at", statement.columnText(6), true);
    if (include_session) {
        try writeTextField(&output.writer, "best_session_id", statement.columnText(7), true);
        try writeNumberField(&output.writer, "best_session_prefill_tps", statement, 8);
        try writeNumberField(&output.writer, "best_session_generation_tps", statement, 9);
        try writeNumberField(&output.writer, "best_session_ttft_ms", statement, 10);
    }
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn writeTextField(writer: *std.Io.Writer, name: []const u8, value: ?[]const u8, comma: bool) !void {
    if (comma) try writer.writeByte(',');
    try std.json.Stringify.value(name, .{}, writer);
    try writer.writeByte(':');
    if (value) |text| try std.json.Stringify.value(text, .{}, writer) else try writer.writeAll("null");
}

fn writeNumberField(writer: *std.Io.Writer, name: []const u8, statement: *const sqlite.Statement, index: u31) !void {
    try writer.writeByte(',');
    try std.json.Stringify.value(name, .{}, writer);
    try writer.writeByte(':');
    if (statement.columnType(index) == .null) try writer.writeAll("null") else try writer.print("{d}", .{statement.columnFloat(index)});
}

fn writeIntegerField(writer: *std.Io.Writer, name: []const u8, statement: *const sqlite.Statement, index: u31) !void {
    try writer.writeByte(',');
    try std.json.Stringify.value(name, .{}, writer);
    try writer.writeByte(':');
    if (statement.columnType(index) == .null) try writer.writeAll("null") else try writer.print("{d}", .{statement.columnInt(index)});
}
