const std = @import("std");
const sqlite = @import("../../storage/sqlite.zig");

const Io = std.Io;

pub const Sample = struct {
    prompt_tokens: i64 = 0,
    completion_tokens: i64 = 0,
    reasoning_tokens: i64 = 0,
    cache_read_tokens: i64 = 0,
    cache_write_tokens: i64 = 0,
};

pub fn initialize(database: *sqlite.Database) !void {
    try database.executeScript(
        \\CREATE TABLE IF NOT EXISTS inference_requests (
        \\  id INTEGER PRIMARY KEY AUTOINCREMENT,
        \\  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \\  event_id TEXT NOT NULL,
        \\  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \\  origin_controller_id TEXT,
        \\  synced_at TEXT,
        \\  model TEXT NOT NULL,
        \\  source TEXT,
        \\  session_id TEXT,
        \\  provider TEXT,
        \\  worker_id TEXT,
        \\  prompt_tokens INTEGER NOT NULL DEFAULT 0,
        \\  completion_tokens INTEGER NOT NULL DEFAULT 0,
        \\  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        \\  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        \\  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        \\  total_tokens INTEGER NOT NULL DEFAULT 0,
        \\  ttft_ms INTEGER,
        \\  duration_ms INTEGER,
        \\  status INTEGER NOT NULL DEFAULT 200,
        \\  streamed INTEGER NOT NULL DEFAULT 0
        \\);
        \\CREATE UNIQUE INDEX IF NOT EXISTS idx_inference_requests_event_id ON inference_requests(event_id);
        \\CREATE INDEX IF NOT EXISTS idx_inference_requests_created_at ON inference_requests(created_at);
        \\CREATE INDEX IF NOT EXISTS idx_inference_requests_model_created ON inference_requests(model, created_at);
    );
}

pub fn record(database: *sqlite.Database, io: Io, model: []const u8, source: []const u8, provider: ?[]const u8, worker_id: ?[]const u8, sample: Sample, duration_ms: ?i64, status: u16, streamed: bool) !void {
    var random: [16]u8 = undefined;
    io.random(&random);
    const event_id = std.fmt.bytesToHex(random, .lower);
    try database.lock(io);
    defer database.unlock(io);
    var statement = try database.prepare(
        \\INSERT INTO inference_requests (
        \\  event_id, model, source, provider, worker_id, prompt_tokens, completion_tokens,
        \\  reasoning_tokens, cache_read_tokens, cache_write_tokens, total_tokens,
        \\  duration_ms, status, streamed
        \\) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    );
    defer statement.deinit();
    try statement.bindText(1, &event_id);
    try statement.bindText(2, model);
    try statement.bindText(3, source);
    if (provider) |value| try statement.bindText(4, value) else try statement.bindNull(4);
    if (worker_id) |value| try statement.bindText(5, value) else try statement.bindNull(5);
    try statement.bindInt(6, @max(sample.prompt_tokens, 0));
    try statement.bindInt(7, @max(sample.completion_tokens, 0));
    try statement.bindInt(8, @max(sample.reasoning_tokens, 0));
    try statement.bindInt(9, @max(sample.cache_read_tokens, 0));
    try statement.bindInt(10, @max(sample.cache_write_tokens, 0));
    try statement.bindInt(11, @max(sample.prompt_tokens, 0) + @max(sample.completion_tokens, 0));
    if (duration_ms) |value| try statement.bindInt(12, @max(value, 0)) else try statement.bindNull(12);
    try statement.bindInt(13, status);
    try statement.bindInt(14, if (streamed) 1 else 0);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn parseSample(allocator: std.mem.Allocator, document: []const u8) ?Sample {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return null;
    defer parsed.deinit();
    if (parsed.value != .object) return null;
    const usage_value = parsed.value.object.get("usage") orelse return null;
    if (usage_value != .object) return null;
    const usage = usage_value.object;
    var sample = Sample{
        .prompt_tokens = integer(usage.get("prompt_tokens")) orelse integer(usage.get("input_tokens")) orelse 0,
        .completion_tokens = integer(usage.get("completion_tokens")) orelse integer(usage.get("output_tokens")) orelse 0,
        .reasoning_tokens = integer(usage.get("reasoning_tokens")) orelse 0,
        .cache_read_tokens = integer(usage.get("cache_read_tokens")) orelse 0,
        .cache_write_tokens = integer(usage.get("cache_write_tokens")) orelse 0,
    };
    if (usage.get("input_tokens_details")) |details| if (details == .object) {
        sample.cache_read_tokens = integer(details.object.get("cached_tokens")) orelse sample.cache_read_tokens;
    };
    if (usage.get("prompt_tokens_details")) |details| if (details == .object) {
        sample.cache_read_tokens = integer(details.object.get("cached_tokens")) orelse sample.cache_read_tokens;
    };
    if (usage.get("output_tokens_details")) |details| if (details == .object) {
        sample.reasoning_tokens = integer(details.object.get("reasoning_tokens")) orelse sample.reasoning_tokens;
    };
    if (usage.get("completion_tokens_details")) |details| if (details == .object) {
        sample.reasoning_tokens = integer(details.object.get("reasoning_tokens")) orelse sample.reasoning_tokens;
    };
    return sample;
}

pub fn payload(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database) ![]u8 {
    try database.lock(io);
    defer database.unlock(io);
    var summary = try database.prepare(
        \\SELECT COUNT(*), COALESCE(SUM(prompt_tokens),0), COALESCE(SUM(completion_tokens),0),
        \\ COALESCE(SUM(cache_read_tokens),0), COALESCE(SUM(cache_write_tokens),0),
        \\ COUNT(DISTINCT session_id), SUM(CASE WHEN status BETWEEN 200 AND 299 THEN 1 ELSE 0 END),
        \\ AVG(duration_ms), MIN(duration_ms), MAX(duration_ms), AVG(ttft_ms),
        \\ SUM(CASE WHEN datetime(created_at) >= datetime('now','-1 hour') THEN 1 ELSE 0 END),
        \\ SUM(CASE WHEN datetime(created_at) >= datetime('now','-24 hours') THEN 1 ELSE 0 END),
        \\ SUM(CASE WHEN datetime(created_at) >= datetime('now','-48 hours') AND datetime(created_at) < datetime('now','-24 hours') THEN 1 ELSE 0 END),
        \\ COALESCE(SUM(CASE WHEN datetime(created_at) >= datetime('now','-24 hours') THEN total_tokens ELSE 0 END),0),
        \\ SUM(CASE WHEN datetime(created_at) >= datetime('now','-7 days') THEN 1 ELSE 0 END),
        \\ COALESCE(SUM(CASE WHEN datetime(created_at) >= datetime('now','-7 days') THEN total_tokens ELSE 0 END),0),
        \\ SUM(CASE WHEN datetime(created_at) >= datetime('now','-7 days') AND status BETWEEN 200 AND 299 THEN 1 ELSE 0 END),
        \\ SUM(CASE WHEN datetime(created_at) >= datetime('now','-14 days') AND datetime(created_at) < datetime('now','-7 days') THEN 1 ELSE 0 END),
        \\ COALESCE(SUM(CASE WHEN datetime(created_at) >= datetime('now','-14 days') AND datetime(created_at) < datetime('now','-7 days') THEN total_tokens ELSE 0 END),0),
        \\ SUM(CASE WHEN datetime(created_at) >= datetime('now','-14 days') AND datetime(created_at) < datetime('now','-7 days') AND status BETWEEN 200 AND 299 THEN 1 ELSE 0 END)
        \\FROM inference_requests
    );
    defer summary.deinit();
    if (try summary.step() != .row) return error.DatabaseQueryFailed;
    const total_requests = summary.columnInt(0);
    const prompt_tokens = summary.columnInt(1);
    const completion_tokens = summary.columnInt(2);
    const total_tokens = prompt_tokens + completion_tokens;
    const successful = summary.columnInt(6);
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.print("{{\"totals\":{{\"total_tokens\":{d},\"prompt_tokens\":{d},\"completion_tokens\":{d},\"total_requests\":{d},\"successful_requests\":{d},\"failed_requests\":{d},\"success_rate\":{d},\"unique_sessions\":{d},\"unique_users\":0}},", .{ total_tokens, prompt_tokens, completion_tokens, total_requests, successful, total_requests - successful, rate(successful, total_requests), summary.columnInt(5) });
    try output.writer.writeAll("\"latency\":{");
    try writeNullableNumber(&output.writer, "avg_ms", &summary, 7);
    try output.writer.writeAll(",\"p50_ms\":null,\"p95_ms\":null,\"p99_ms\":null,");
    try writeNullableNumber(&output.writer, "min_ms", &summary, 8);
    try output.writer.writeByte(',');
    try writeNullableNumber(&output.writer, "max_ms", &summary, 9);
    try output.writer.writeAll("},\"ttft\":{");
    try writeNullableNumber(&output.writer, "avg_ms", &summary, 10);
    try output.writer.writeAll(",\"p50_ms\":null,\"p95_ms\":null,\"p99_ms\":null},");
    try output.writer.print("\"tokens_per_request\":{{\"avg\":{d},\"avg_prompt\":{d},\"avg_completion\":{d},\"max\":0,\"p50\":0,\"p95\":0}},", .{ average(total_tokens, total_requests), average(prompt_tokens, total_requests), average(completion_tokens, total_requests) });
    const cache_read = summary.columnInt(3);
    const cache_write = summary.columnInt(4);
    try output.writer.print("\"cache\":{{\"hits\":{d},\"misses\":{d},\"hit_tokens\":{d},\"miss_tokens\":{d},\"hit_rate\":{d}}},", .{ cache_read, cache_write, cache_read, cache_write, rate(cache_read, cache_read + cache_write) });
    try output.writer.print("\"week_over_week\":{{\"this_week\":{{\"requests\":{d},\"tokens\":{d},\"successful\":{d}}},\"last_week\":{{\"requests\":{d},\"tokens\":{d},\"successful\":{d}}},\"change_pct\":{{\"requests\":", .{ summary.columnInt(15), summary.columnInt(16), summary.columnInt(17), summary.columnInt(18), summary.columnInt(19), summary.columnInt(20) });
    try writeChange(&output.writer, summary.columnInt(15), summary.columnInt(18));
    try output.writer.writeAll(",\"tokens\":");
    try writeChange(&output.writer, summary.columnInt(16), summary.columnInt(19));
    try output.writer.writeAll("}},\"recent_activity\":{");
    try output.writer.print("\"last_hour_requests\":{d},\"last_24h_requests\":{d},\"prev_24h_requests\":{d},\"last_24h_tokens\":{d},\"change_24h_pct\":", .{ summary.columnInt(11), summary.columnInt(12), summary.columnInt(13), summary.columnInt(14) });
    try writeChange(&output.writer, summary.columnInt(12), summary.columnInt(13));
    try output.writer.writeAll("},\"peak_days\":[],\"peak_hours\":[],\"by_model\":[");
    try writeByModel(&output.writer, database);
    try output.writer.writeAll("],\"daily\":[");
    try writeDaily(&output.writer, database);
    try output.writer.writeAll("],\"daily_by_model\":[],\"hourly_pattern\":[");
    try writeHourly(&output.writer, database);
    try output.writer.writeAll("]}");
    return output.toOwnedSlice();
}

fn writeByModel(writer: *Io.Writer, database: *sqlite.Database) !void {
    var statement = try database.prepare(
        \\SELECT model, COUNT(*), SUM(CASE WHEN status BETWEEN 200 AND 299 THEN 1 ELSE 0 END),
        \\ COALESCE(SUM(prompt_tokens),0), COALESCE(SUM(completion_tokens),0), COALESCE(SUM(total_tokens),0), AVG(duration_ms), AVG(ttft_ms)
        \\FROM inference_requests GROUP BY model ORDER BY SUM(total_tokens) DESC LIMIT 25
    );
    defer statement.deinit();
    var first = true;
    while (try statement.step() == .row) {
        if (!first) try writer.writeByte(',');
        first = false;
        const requests = statement.columnInt(1);
        const successful = statement.columnInt(2);
        const tokens = statement.columnInt(5);
        try writer.writeAll("{\"model\":");
        try std.json.Stringify.value(statement.columnText(0) orelse "unknown", .{}, writer);
        try writer.print(",\"requests\":{d},\"successful\":{d},\"success_rate\":{d},\"total_tokens\":{d},\"prompt_tokens\":{d},\"completion_tokens\":{d},\"avg_tokens\":{d},\"avg_latency_ms\":", .{ requests, successful, rate(successful, requests), tokens, statement.columnInt(3), statement.columnInt(4), average(tokens, requests) });
        try writeColumnNumber(writer, &statement, 6);
        try writer.writeAll(",\"p50_latency_ms\":null,\"avg_ttft_ms\":");
        try writeColumnNumber(writer, &statement, 7);
        try writer.writeAll(",\"tokens_per_sec\":null,\"prefill_tps\":null,\"generation_tps\":null}");
    }
}

fn writeDaily(writer: *Io.Writer, database: *sqlite.Database) !void {
    var statement = try database.prepare(
        \\SELECT DATE(created_at), COUNT(*), SUM(CASE WHEN status BETWEEN 200 AND 299 THEN 1 ELSE 0 END), COALESCE(SUM(total_tokens),0), COALESCE(SUM(prompt_tokens),0), COALESCE(SUM(completion_tokens),0), COALESCE(AVG(duration_ms),0)
        \\FROM inference_requests WHERE DATE(created_at) >= DATE('now','-366 days') GROUP BY DATE(created_at) ORDER BY DATE(created_at) DESC LIMIT 400
    );
    defer statement.deinit();
    var first = true;
    while (try statement.step() == .row) {
        if (!first) try writer.writeByte(',');
        first = false;
        const requests = statement.columnInt(1);
        const successful = statement.columnInt(2);
        try writer.writeAll("{\"date\":");
        try std.json.Stringify.value(statement.columnText(0) orelse "", .{}, writer);
        try writer.print(",\"requests\":{d},\"successful\":{d},\"success_rate\":{d},\"total_tokens\":{d},\"prompt_tokens\":{d},\"completion_tokens\":{d},\"avg_latency_ms\":{d}}}", .{ requests, successful, rate(successful, requests), statement.columnInt(3), statement.columnInt(4), statement.columnInt(5), statement.columnFloat(6) });
    }
}

fn writeHourly(writer: *Io.Writer, database: *sqlite.Database) !void {
    var statement = try database.prepare(
        \\SELECT CAST(strftime('%H',created_at) AS INTEGER), COUNT(*), SUM(CASE WHEN status BETWEEN 200 AND 299 THEN 1 ELSE 0 END), COALESCE(SUM(total_tokens),0)
        \\FROM inference_requests GROUP BY strftime('%H',created_at) ORDER BY 1
    );
    defer statement.deinit();
    var first = true;
    while (try statement.step() == .row) {
        if (!first) try writer.writeByte(',');
        first = false;
        try writer.print("{{\"hour\":{d},\"requests\":{d},\"successful\":{d},\"tokens\":{d}}}", .{ statement.columnInt(0), statement.columnInt(1), statement.columnInt(2), statement.columnInt(3) });
    }
}

fn writeNullableNumber(writer: *Io.Writer, name: []const u8, statement: *const sqlite.Statement, index: u31) !void {
    try std.json.Stringify.value(name, .{}, writer);
    try writer.writeByte(':');
    try writeColumnNumber(writer, statement, index);
}

fn writeColumnNumber(writer: *Io.Writer, statement: *const sqlite.Statement, index: u31) !void {
    if (statement.columnType(index) == .null) try writer.writeAll("null") else try writer.print("{d}", .{statement.columnFloat(index)});
}

fn writeChange(writer: *Io.Writer, current: i64, previous: i64) !void {
    if (previous == 0) {
        if (current == 0) try writer.writeByte('0') else try writer.writeAll("null");
        return;
    }
    try writer.print("{d}", .{(@as(f64, @floatFromInt(current - previous)) / @as(f64, @floatFromInt(previous))) * 100});
}

fn average(total: i64, count: i64) f64 {
    if (count <= 0) return 0;
    return @as(f64, @floatFromInt(total)) / @as(f64, @floatFromInt(count));
}

fn rate(successful: i64, total: i64) f64 {
    if (total <= 0) return 0;
    return @as(f64, @floatFromInt(successful)) / @as(f64, @floatFromInt(total)) * 100;
}

fn integer(value: ?std.json.Value) ?i64 {
    const entry = value orelse return null;
    return switch (entry) {
        .integer => |number| number,
        .float => |number| @intFromFloat(@round(number)),
        else => null,
    };
}
