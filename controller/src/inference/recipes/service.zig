const std = @import("std");
const model_service = @import("../models/service.zig");
const repository = @import("store.zig");
const sqlite = @import("../../storage/sqlite.zig");
const serializer = @import("serializer.zig");

pub fn listPayload(allocator: std.mem.Allocator, io: std.Io, database: *sqlite.Database, column: repository.PayloadColumn, llm_instance_path: []const u8, default_trust_remote_code: bool) ![]u8 {
    const active_id = try model_service.activeRecipeId(allocator, io, database, column, llm_instance_path);
    defer if (active_id) |value| allocator.free(value);
    var documents = documents: {
        try database.lock(io);
        defer database.unlock(io);
        break :documents try repository.list(allocator, database, column);
    };
    defer documents.deinit();
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeByte('[');
    var count: usize = 0;
    for (documents.items()) |document| {
        const normalized = serializer.normalize(allocator, document, default_trust_remote_code) catch continue;
        defer allocator.free(normalized);
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, normalized, .{}) catch continue;
        defer parsed.deinit();
        if (!validRecipeObject(parsed.value)) continue;
        const id = parsed.value.object.get("id").?.string;
        const status = if (active_id != null and std.mem.eql(u8, active_id.?, id)) "running" else "stopped";
        try parsed.value.object.put(parsed.arena.allocator(), "status", .{ .string = status });
        _ = parsed.value.object.swapRemove("crash_loop");
        if (count > 0) try output.writer.writeByte(',');
        count += 1;
        try std.json.Stringify.value(parsed.value, .{}, &output.writer);
    }
    try output.writer.writeByte(']');
    return try output.toOwnedSlice();
}

pub fn detailPayload(allocator: std.mem.Allocator, io: std.Io, database: *sqlite.Database, column: repository.PayloadColumn, id: []const u8, default_trust_remote_code: bool) !?[]u8 {
    try database.lock(io);
    defer database.unlock(io);
    const document = try repository.get(allocator, database, column, id) orelse return null;
    defer allocator.free(document);
    return serializer.normalize(allocator, document, default_trust_remote_code) catch null;
}

pub fn savePayload(allocator: std.mem.Allocator, io: std.Io, database: *sqlite.Database, column: repository.PayloadColumn, document: []const u8, override_id: ?[]const u8, default_trust_remote_code: bool) ![]u8 {
    var overridden: ?[]u8 = null;
    defer if (overridden) |value| allocator.free(value);
    if (override_id) |id| {
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidRecipe;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidRecipe;
        try parsed.value.object.put(parsed.arena.allocator(), "id", .{ .string = id });
        var output: std.Io.Writer.Allocating = .init(allocator);
        errdefer output.deinit();
        try std.json.Stringify.value(parsed.value, .{}, &output.writer);
        overridden = try output.toOwnedSlice();
    }
    const normalized = try serializer.normalize(allocator, overridden orelse document, default_trust_remote_code);
    defer allocator.free(normalized);
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, normalized, .{});
    defer parsed.deinit();
    const id = parsed.value.object.get("id").?.string;
    try database.lock(io);
    defer database.unlock(io);
    try repository.save(database, column, id, normalized);
    return try allocator.dupe(u8, id);
}

pub fn delete(io: std.Io, database: *sqlite.Database, id: []const u8) !bool {
    try database.lock(io);
    defer database.unlock(io);
    return try repository.delete(database, id);
}

fn validRecipeObject(value: std.json.Value) bool {
    if (value != .object) return false;
    for ([_][]const u8{ "id", "name", "model_path" }) |field| {
        const entry = value.object.get(field) orelse return false;
        if (entry != .string) return false;
        if (std.mem.eql(u8, field, "id") and entry.string.len == 0) return false;
    }
    return true;
}
