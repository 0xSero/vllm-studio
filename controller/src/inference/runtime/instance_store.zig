const std = @import("std");

pub const ProcessReference = struct {
    pid: i32,
    process_group_id: ?i32,
    session_id: ?i32,
    start_token: ?[]u8,
};

pub const Record = struct {
    allocator: std.mem.Allocator,
    recipe_id: []u8,
    engine: []u8,
    port: u16,
    nonce: []u8,
    started_at: []u8,
    ready_deadline_at: []u8,
    process: ?ProcessReference,

    pub fn deinit(record: *Record) void {
        record.allocator.free(record.recipe_id);
        record.allocator.free(record.engine);
        record.allocator.free(record.nonce);
        record.allocator.free(record.started_at);
        record.allocator.free(record.ready_deadline_at);
        if (record.process) |reference| {
            if (reference.start_token) |token| record.allocator.free(token);
        }
        record.* = undefined;
    }
};

pub fn readLlm(allocator: std.mem.Allocator, io: std.Io, path: []const u8) !?Record {
    const document = try readDocument(allocator, io, path) orelse return null;
    defer allocator.free(document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidInstanceRecord;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidInstanceRecord;
    const object = parsed.value.object;
    const name = stringField(object, "name") orelse return error.InvalidInstanceRecord;
    if (!std.mem.eql(u8, name, "llm")) return error.InvalidInstanceRecord;
    const recipe_id = stringField(object, "recipeId") orelse return error.InvalidInstanceRecord;
    const engine = stringField(object, "engine") orelse return error.InvalidInstanceRecord;
    const nonce = stringField(object, "nonce") orelse return error.InvalidInstanceRecord;
    const started_at = stringField(object, "startedAt") orelse return error.InvalidInstanceRecord;
    const ready_deadline_at = stringField(object, "readyDeadlineAt") orelse return error.InvalidInstanceRecord;
    const port = positiveU16(object.get("port")) orelse return error.InvalidInstanceRecord;

    const owned_recipe_id = try allocator.dupe(u8, recipe_id);
    errdefer allocator.free(owned_recipe_id);
    const owned_engine = try allocator.dupe(u8, engine);
    errdefer allocator.free(owned_engine);
    const owned_nonce = try allocator.dupe(u8, nonce);
    errdefer allocator.free(owned_nonce);
    const owned_started_at = try allocator.dupe(u8, started_at);
    errdefer allocator.free(owned_started_at);
    const owned_ready_deadline_at = try allocator.dupe(u8, ready_deadline_at);
    errdefer allocator.free(owned_ready_deadline_at);
    const process = try parseProcessReference(allocator, object.get("ref"));
    errdefer if (process) |reference| if (reference.start_token) |token| allocator.free(token);
    return .{
        .allocator = allocator,
        .recipe_id = owned_recipe_id,
        .engine = owned_engine,
        .port = port,
        .nonce = owned_nonce,
        .started_at = owned_started_at,
        .ready_deadline_at = owned_ready_deadline_at,
        .process = process,
    };
}

pub fn readDocument(allocator: std.mem.Allocator, io: std.Io, path: []const u8) !?[]u8 {
    return std.Io.Dir.cwd().readFileAlloc(io, path, allocator, .limited(1024 * 1024)) catch |failure| switch (failure) {
        error.FileNotFound => null,
        else => return failure,
    };
}

pub fn timestampPassed(io: std.Io, value: []const u8) bool {
    const timestamp = timestampSeconds(value) orelse return true;
    return std.Io.Clock.real.now(io).toSeconds() >= timestamp;
}

pub fn timestampOlderThan(io: std.Io, value: []const u8, age_seconds: u64) bool {
    const timestamp = timestampSeconds(value) orelse return true;
    const now = std.Io.Clock.real.now(io).toSeconds();
    if (now < timestamp) return false;
    return @as(u64, @intCast(now - timestamp)) >= age_seconds;
}

pub fn writeProcess(io: std.Io, path: []const u8, recipe_id: []const u8, engine: []const u8, port: u16, nonce: []const u8, reference: ProcessReference, ready_timeout_seconds: u64) !void {
    var timestamp_buffer: [24]u8 = undefined;
    const started_at = formatTimestamp(io, &timestamp_buffer);
    var deadline_buffer: [24]u8 = undefined;
    const ready_deadline_at = formatTimestampAt(io, ready_timeout_seconds, &deadline_buffer);
    const Reference = struct {
        kind: []const u8 = "process",
        pid: i32,
        processGroupId: ?i32,
        sessionId: ?i32,
        startToken: ?[]const u8,
    };
    const Document = struct {
        name: []const u8 = "llm",
        nodeId: []const u8 = "self",
        engine: []const u8,
        recipeId: []const u8,
        runtime: []const u8 = "process",
        ref: Reference,
        port: u16,
        devices: []const []const u8 = &.{},
        nonce: []const u8,
        startedAt: []const u8,
        readyDeadlineAt: []const u8,
    };
    var output: std.Io.Writer.Allocating = .init(std.heap.page_allocator);
    defer output.deinit();
    try std.json.Stringify.value(Document{
        .engine = engine,
        .recipeId = recipe_id,
        .ref = .{
            .pid = reference.pid,
            .processGroupId = reference.process_group_id,
            .sessionId = reference.session_id,
            .startToken = reference.start_token,
        },
        .port = port,
        .nonce = nonce,
        .startedAt = started_at,
        .readyDeadlineAt = ready_deadline_at,
    }, .{ .whitespace = .indent_2 }, &output.writer);
    try writeAtomic(io, path, output.writer.buffered());
}

pub fn writeReservation(io: std.Io, path: []const u8, recipe_id: []const u8, engine: []const u8, port: u16, nonce: []const u8, ready_timeout_seconds: u64) !void {
    var timestamp_buffer: [24]u8 = undefined;
    const started_at = formatTimestamp(io, &timestamp_buffer);
    var deadline_buffer: [24]u8 = undefined;
    const ready_deadline_at = formatTimestampAt(io, ready_timeout_seconds, &deadline_buffer);
    const Document = struct {
        name: []const u8 = "llm",
        nodeId: []const u8 = "self",
        engine: []const u8,
        recipeId: []const u8,
        runtime: []const u8 = "process",
        ref: ?u8 = null,
        port: u16,
        devices: []const []const u8 = &.{},
        nonce: []const u8,
        startedAt: []const u8,
        readyDeadlineAt: []const u8,
    };
    var output: std.Io.Writer.Allocating = .init(std.heap.page_allocator);
    defer output.deinit();
    try std.json.Stringify.value(Document{
        .engine = engine,
        .recipeId = recipe_id,
        .port = port,
        .nonce = nonce,
        .startedAt = started_at,
        .readyDeadlineAt = ready_deadline_at,
    }, .{ .whitespace = .indent_2 }, &output.writer);
    try writeAtomic(io, path, output.writer.buffered());
}

pub fn dropLlm(io: std.Io, path: []const u8) !void {
    std.Io.Dir.cwd().deleteFile(io, path) catch |failure| switch (failure) {
        error.FileNotFound => {},
        else => return failure,
    };
}

fn parseProcessReference(allocator: std.mem.Allocator, value: ?std.json.Value) !?ProcessReference {
    const present = value orelse return null;
    if (present == .null) return null;
    if (present != .object) return error.InvalidInstanceRecord;
    const kind = stringField(present.object, "kind") orelse return error.InvalidInstanceRecord;
    if (!std.mem.eql(u8, kind, "process")) return null;
    const pid = positiveI32(present.object.get("pid")) orelse return error.InvalidInstanceRecord;
    const process_group_id = nullablePositiveI32(present.object.get("processGroupId")) orelse return error.InvalidInstanceRecord;
    const session_id = nullablePositiveI32(present.object.get("sessionId")) orelse return error.InvalidInstanceRecord;
    const token_value = present.object.get("startToken");
    const start_token = if (token_value == null or token_value.? == .null)
        null
    else if (token_value.? == .string and token_value.?.string.len > 0)
        try allocator.dupe(u8, token_value.?.string)
    else
        return error.InvalidInstanceRecord;
    return .{
        .pid = pid,
        .process_group_id = process_group_id.value,
        .session_id = session_id.value,
        .start_token = start_token,
    };
}

const NullableI32 = struct { value: ?i32 };

fn nullablePositiveI32(value: ?std.json.Value) ?NullableI32 {
    const present = value orelse return null;
    if (present == .null) return .{ .value = null };
    return .{ .value = positiveI32(present) orelse return null };
}

fn positiveI32(value: ?std.json.Value) ?i32 {
    const present = value orelse return null;
    if (present != .integer or present.integer <= 0 or present.integer > std.math.maxInt(i32)) return null;
    return @intCast(present.integer);
}

fn positiveU16(value: ?std.json.Value) ?u16 {
    const present = value orelse return null;
    if (present != .integer or present.integer <= 0 or present.integer > std.math.maxInt(u16)) return null;
    return @intCast(present.integer);
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string or value.string.len == 0) return null;
    return value.string;
}

fn timestampSeconds(value: []const u8) ?i64 {
    if (value.len < 20 or value[4] != '-' or value[7] != '-' or value[10] != 'T' or value[13] != ':' or value[16] != ':') return null;
    const year = std.fmt.parseInt(u16, value[0..4], 10) catch return null;
    const month = std.fmt.parseInt(u8, value[5..7], 10) catch return null;
    const day = std.fmt.parseInt(u8, value[8..10], 10) catch return null;
    const hour = std.fmt.parseInt(u8, value[11..13], 10) catch return null;
    const minute = std.fmt.parseInt(u8, value[14..16], 10) catch return null;
    const second = std.fmt.parseInt(u8, value[17..19], 10) catch return null;
    if (year < 1970 or month == 0 or month > 12 or hour > 23 or minute > 59 or second > 60) return null;
    const month_lengths = [_]u8{ 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 };
    const leap = isLeapYear(year);
    const maximum_day: u8 = month_lengths[month - 1] + @as(u8, if (month == 2 and leap) 1 else 0);
    if (day == 0 or day > maximum_day) return null;
    var days: u64 = 0;
    var current_year: u16 = 1970;
    while (current_year < year) : (current_year += 1) days += if (isLeapYear(current_year)) 366 else 365;
    var current_month: u8 = 1;
    while (current_month < month) : (current_month += 1) {
        days += month_lengths[current_month - 1];
        if (current_month == 2 and leap) days += 1;
    }
    days += day - 1;
    const total = days * 86_400 + @as(u64, hour) * 3_600 + @as(u64, minute) * 60 + second;
    return @intCast(total);
}

fn isLeapYear(year: u16) bool {
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0);
}

fn formatTimestamp(io: std.Io, buffer: *[24]u8) []const u8 {
    return formatTimestampAt(io, 0, buffer);
}

fn formatTimestampAt(io: std.Io, offset_seconds: u64, buffer: *[24]u8) []const u8 {
    const seconds = std.Io.Clock.real.now(io).toSeconds();
    const now: u64 = @intCast(@max(seconds, 0));
    const epoch = std.time.epoch.EpochSeconds{ .secs = now +| offset_seconds };
    const year_day = epoch.getEpochDay().calculateYearDay();
    const month_day = year_day.calculateMonthDay();
    const day_seconds = epoch.getDaySeconds();
    return std.fmt.bufPrint(buffer, "{d:0>4}-{d:0>2}-{d:0>2}T{d:0>2}:{d:0>2}:{d:0>2}.000Z", .{
        year_day.year,
        month_day.month.numeric(),
        month_day.day_index + 1,
        day_seconds.getHoursIntoDay(),
        day_seconds.getMinutesIntoHour(),
        day_seconds.getSecondsIntoMinute(),
    }) catch unreachable;
}

fn writeAtomic(io: std.Io, path: []const u8, document: []const u8) !void {
    var atomic_file = try std.Io.Dir.cwd().createFileAtomic(io, path, .{
        .permissions = @enumFromInt(0o600),
        .make_path = true,
        .replace = true,
    });
    defer atomic_file.deinit(io);
    try atomic_file.file.writeStreamingAll(io, document);
    try atomic_file.file.sync(io);
    try atomic_file.replace(io);
}
