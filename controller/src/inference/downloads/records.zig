const std = @import("std");
const downloads = @import("store.zig");
const sqlite = @import("../../storage/sqlite.zig");
const huggingface = @import("huggingface.zig");

const Io = std.Io;

pub const FileSnapshot = struct {
    allocator: std.mem.Allocator,
    path: []u8,
    size_bytes: ?u64,
    downloaded_bytes: u64,

    pub fn deinit(file: *FileSnapshot) void {
        file.allocator.free(file.path);
        file.* = undefined;
    }
};

pub const ModelReference = struct {
    allocator: std.mem.Allocator,
    model_id: []u8,
    revision: ?[]u8,

    pub fn deinit(reference: *ModelReference) void {
        reference.allocator.free(reference.model_id);
        if (reference.revision) |value| reference.allocator.free(value);
        reference.* = undefined;
    }
};

pub fn setStatus(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, id: []const u8, status: []const u8, error_value: ?[]const u8) !?[]u8 {
    try database.lock(io);
    defer database.unlock(io);
    const current = try downloads.getPayload(allocator, database, id) orelse return null;
    defer allocator.free(current);
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, current, .{});
    defer parsed.deinit();
    const arena = parsed.arena.allocator();
    try parsed.value.object.put(arena, "status", .{ .string = status });
    if (error_value) |value| try parsed.value.object.put(arena, "error", if (value.len == 0) .null else .{ .string = value });
    try parsed.value.object.put(arena, "updated_at", .{ .string = try timestamp(arena, io) });
    const data = try stringify(allocator, parsed.value);
    defer allocator.free(data);
    try downloads.save(database, id, data);
    return try downloads.normalizedData(allocator, data);
}

pub fn begin(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, id: []const u8) !bool {
    try database.lock(io);
    defer database.unlock(io);
    const current = try downloads.getPayload(allocator, database, id) orelse return false;
    defer allocator.free(current);
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, current, .{});
    defer parsed.deinit();
    const status = parsed.value.object.get("status").?.string;
    if (!std.mem.eql(u8, status, "queued")) return false;
    const arena = parsed.arena.allocator();
    try parsed.value.object.put(arena, "status", .{ .string = "downloading" });
    try parsed.value.object.put(arena, "updated_at", .{ .string = try timestamp(arena, io) });
    const data = try stringify(allocator, parsed.value);
    defer allocator.free(data);
    try downloads.save(database, id, data);
    return true;
}

pub fn setFailureUnlessStopped(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, id: []const u8, detail: []const u8) !?[]u8 {
    try database.lock(io);
    defer database.unlock(io);
    const current = try downloads.getPayload(allocator, database, id) orelse return null;
    defer allocator.free(current);
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, current, .{});
    defer parsed.deinit();
    const status = parsed.value.object.get("status").?.string;
    if (std.mem.eql(u8, status, "paused") or std.mem.eql(u8, status, "canceled")) return null;
    const arena = parsed.arena.allocator();
    try parsed.value.object.put(arena, "status", .{ .string = "failed" });
    try parsed.value.object.put(arena, "error", .{ .string = try arena.dupe(u8, detail) });
    try parsed.value.object.put(arena, "updated_at", .{ .string = try timestamp(arena, io) });
    const data = try stringify(allocator, parsed.value);
    defer allocator.free(data);
    try downloads.save(database, id, data);
    return try allocator.dupe(u8, data);
}

pub fn nextFile(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, id: []const u8) !?FileSnapshot {
    try database.lock(io);
    defer database.unlock(io);
    const data = try downloads.getPayload(allocator, database, id) orelse return null;
    defer allocator.free(data);
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, data, .{});
    defer parsed.deinit();
    const status = parsed.value.object.get("status").?.string;
    if (std.mem.eql(u8, status, "paused") or std.mem.eql(u8, status, "canceled")) return error.Canceled;
    for (parsed.value.object.get("files").?.array.items) |file| {
        if (std.mem.eql(u8, file.object.get("status").?.string, "completed")) continue;
        return .{
            .allocator = allocator,
            .path = try allocator.dupe(u8, file.object.get("path").?.string),
            .size_bytes = unsigned(file.object.get("size_bytes").?),
            .downloaded_bytes = unsigned(file.object.get("downloaded_bytes").?) orelse 0,
        };
    }
    return null;
}

pub fn updateFile(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, id: []const u8, path: []const u8, status: []const u8, downloaded_bytes: u64, size_bytes: ?u64) !void {
    try database.lock(io);
    defer database.unlock(io);
    const current = try downloads.getPayload(allocator, database, id) orelse return error.DownloadNotFound;
    defer allocator.free(current);
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, current, .{});
    defer parsed.deinit();
    const arena = parsed.arena.allocator();
    var found = false;
    for (parsed.value.object.get("files").?.array.items) |*file| {
        if (!std.mem.eql(u8, file.object.get("path").?.string, path)) continue;
        try file.object.put(arena, "status", .{ .string = status });
        try file.object.put(arena, "downloaded_bytes", jsonUnsigned(downloaded_bytes));
        if (size_bytes) |size| try file.object.put(arena, "size_bytes", jsonUnsigned(size));
        found = true;
        break;
    }
    if (!found) return error.DownloadFileNotFound;
    var total_downloaded: u64 = 0;
    for (parsed.value.object.get("files").?.array.items) |file| total_downloaded +|= unsigned(file.object.get("downloaded_bytes").?) orelse 0;
    try parsed.value.object.put(arena, "downloaded_bytes", jsonUnsigned(total_downloaded));
    try parsed.value.object.put(arena, "updated_at", .{ .string = try timestamp(arena, io) });
    const data = try stringify(allocator, parsed.value);
    defer allocator.free(data);
    const normalized = try downloads.normalizedData(allocator, data) orelse return error.InvalidDownloadRecord;
    defer allocator.free(normalized);
    try downloads.save(database, id, normalized);
}

pub fn setCompletedAt(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, id: []const u8) !void {
    try database.lock(io);
    defer database.unlock(io);
    const current = try downloads.getPayload(allocator, database, id) orelse return;
    defer allocator.free(current);
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, current, .{});
    defer parsed.deinit();
    const arena = parsed.arena.allocator();
    const now = try timestamp(arena, io);
    try parsed.value.object.put(arena, "completed_at", .{ .string = now });
    try parsed.value.object.put(arena, "updated_at", .{ .string = now });
    const data = try stringify(allocator, parsed.value);
    defer allocator.free(data);
    try downloads.save(database, id, data);
}

pub fn allFilesComplete(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, id: []const u8) !bool {
    try database.lock(io);
    defer database.unlock(io);
    const data = try downloads.getPayload(allocator, database, id) orelse return false;
    defer allocator.free(data);
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, data, .{});
    defer parsed.deinit();
    for (parsed.value.object.get("files").?.array.items) |file| if (!std.mem.eql(u8, file.object.get("status").?.string, "completed")) return false;
    return true;
}

pub fn targetFor(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, id: []const u8) ![]u8 {
    try database.lock(io);
    defer database.unlock(io);
    const data = try downloads.getPayload(allocator, database, id) orelse return error.DownloadNotFound;
    defer allocator.free(data);
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, data, .{});
    defer parsed.deinit();
    return try allocator.dupe(u8, parsed.value.object.get("target_dir").?.string);
}

pub fn modelReference(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, id: []const u8) !ModelReference {
    try database.lock(io);
    defer database.unlock(io);
    const data = try downloads.getPayload(allocator, database, id) orelse return error.DownloadNotFound;
    defer allocator.free(data);
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, data, .{});
    defer parsed.deinit();
    const object = parsed.value.object;
    return .{
        .allocator = allocator,
        .model_id = try allocator.dupe(u8, object.get("model_id").?.string),
        .revision = if (object.get("revision").? == .string) try allocator.dupe(u8, object.get("revision").?.string) else null,
    };
}

pub fn create(allocator: std.mem.Allocator, id: []const u8, model_id: []const u8, revision: ?[]const u8, target: []const u8, now: []const u8, files: []const huggingface.File) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"id\":");
    try std.json.Stringify.value(id, .{}, &output.writer);
    try output.writer.writeAll(",\"model_id\":");
    try std.json.Stringify.value(model_id, .{}, &output.writer);
    try output.writer.writeAll(",\"revision\":");
    if (revision) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
    try output.writer.writeAll(",\"status\":\"queued\",\"created_at\":");
    try std.json.Stringify.value(now, .{}, &output.writer);
    try output.writer.writeAll(",\"updated_at\":");
    try std.json.Stringify.value(now, .{}, &output.writer);
    try output.writer.writeAll(",\"target_dir\":");
    try std.json.Stringify.value(target, .{}, &output.writer);
    var total: u64 = 0;
    var total_known = files.len > 0;
    for (files) |file| {
        if (file.size_bytes) |size| total +|= size else total_known = false;
    }
    try output.writer.writeAll(",\"total_bytes\":");
    if (total_known) try output.writer.print("{d}", .{total}) else try output.writer.writeAll("null");
    try output.writer.writeAll(",\"downloaded_bytes\":0,\"files\":[");
    for (files, 0..) |file, index| {
        if (index > 0) try output.writer.writeByte(',');
        try output.writer.writeAll("{\"path\":");
        try std.json.Stringify.value(file.path, .{}, &output.writer);
        try output.writer.writeAll(",\"size_bytes\":");
        if (file.size_bytes) |size| try output.writer.print("{d}", .{size}) else try output.writer.writeAll("null");
        try output.writer.writeAll(",\"downloaded_bytes\":0,\"status\":\"pending\"}");
    }
    try output.writer.writeAll("],\"error\":null}");
    return output.toOwnedSlice();
}

pub fn envelope(allocator: std.mem.Allocator, data: []const u8) ![]u8 {
    return std.fmt.allocPrint(allocator, "{{\"download\":{s}}}", .{data});
}

pub fn timestamp(allocator: std.mem.Allocator, io: Io) ![]u8 {
    const seconds = Io.Clock.real.now(io).toSeconds();
    const epoch = std.time.epoch.EpochSeconds{ .secs = @intCast(@max(seconds, 0)) };
    const year_day = epoch.getEpochDay().calculateYearDay();
    const month_day = year_day.calculateMonthDay();
    const day_seconds = epoch.getDaySeconds();
    return std.fmt.allocPrint(allocator, "{d:0>4}-{d:0>2}-{d:0>2}T{d:0>2}:{d:0>2}:{d:0>2}.000Z", .{ year_day.year, month_day.month.numeric(), month_day.day_index + 1, day_seconds.getHoursIntoDay(), day_seconds.getMinutesIntoHour(), day_seconds.getSecondsIntoMinute() });
}

fn stringify(allocator: std.mem.Allocator, value: std.json.Value) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(value, .{}, &output.writer);
    return output.toOwnedSlice();
}

fn unsigned(value: std.json.Value) ?u64 {
    return switch (value) {
        .integer => |integer| if (integer >= 0) @intCast(integer) else null,
        .float => |float| if (std.math.isFinite(float) and float >= 0 and float <= @as(f64, @floatFromInt(std.math.maxInt(u64))) and @floor(float) == float) @intFromFloat(float) else null,
        .number_string => |text| std.fmt.parseInt(u64, text, 10) catch null,
        else => null,
    };
}

fn jsonUnsigned(value: u64) std.json.Value {
    return if (value <= std.math.maxInt(i64)) .{ .integer = @intCast(value) } else .{ .float = @floatFromInt(value) };
}
