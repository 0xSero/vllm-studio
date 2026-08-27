const std = @import("std");

pub const Snapshot = struct {
    allocator: std.mem.Allocator,
    models_dir: ?[]u8,
    legacy_ui_preferences: []u8,

    pub fn deinit(snapshot: *Snapshot) void {
        if (snapshot.models_dir) |value| snapshot.allocator.free(value);
        snapshot.allocator.free(snapshot.legacy_ui_preferences);
        snapshot.* = undefined;
    }
};

pub fn path(allocator: std.mem.Allocator, data_dir: []const u8) ![]u8 {
    return std.fs.path.join(allocator, &.{ data_dir, "studio-settings.json" });
}

pub fn load(allocator: std.mem.Allocator, io: std.Io, data_dir: []const u8) !Snapshot {
    const settings_path = try path(allocator, data_dir);
    defer allocator.free(settings_path);
    const document = std.Io.Dir.cwd().readFileAlloc(io, settings_path, allocator, .limited(1024 * 1024)) catch |failure| switch (failure) {
        error.FileNotFound => return emptySnapshot(allocator),
        else => return failure,
    };
    defer allocator.free(document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return emptySnapshot(allocator);
    defer parsed.deinit();
    if (parsed.value != .object) return emptySnapshot(allocator);
    const models_dir = if (parsed.value.object.get("models_dir")) |value|
        if (value == .string and std.mem.trim(u8, value.string, " \t\r\n").len > 0)
            try allocator.dupe(u8, std.mem.trim(u8, value.string, " \t\r\n"))
        else
            null
    else
        null;
    errdefer if (models_dir) |value| allocator.free(value);
    const legacy = try normalizedPreferences(allocator, parsed.value.object.get("ui_preferences"));
    return .{ .allocator = allocator, .models_dir = models_dir, .legacy_ui_preferences = legacy };
}

pub fn selectedRuntimeTargetId(allocator: std.mem.Allocator, io: std.Io, data_dir: []const u8, backend: []const u8) !?[]u8 {
    const settings_path = try path(allocator, data_dir);
    defer allocator.free(settings_path);
    const document = std.Io.Dir.cwd().readFileAlloc(io, settings_path, allocator, .limited(1024 * 1024)) catch |failure| switch (failure) {
        error.FileNotFound => return null,
        else => return failure,
    };
    defer allocator.free(document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return null;
    defer parsed.deinit();
    if (parsed.value != .object) return null;
    const selected = parsed.value.object.get("selected_runtime_target_ids") orelse return null;
    if (selected != .object) return null;
    const value = selected.object.get(backend) orelse return null;
    if (value != .string or value.string.len == 0) return null;
    return @as(?[]u8, try allocator.dupe(u8, value.string));
}

pub fn updateModelsDirectory(allocator: std.mem.Allocator, io: std.Io, data_dir: []const u8, models_dir: ?[]const u8) !Snapshot {
    const settings_path = try path(allocator, data_dir);
    defer allocator.free(settings_path);
    const document = std.Io.Dir.cwd().readFileAlloc(io, settings_path, allocator, .limited(1024 * 1024)) catch |failure| switch (failure) {
        error.FileNotFound => null,
        else => return failure,
    };
    defer if (document) |value| allocator.free(value);
    var parsed = if (document) |value|
        std.json.parseFromSlice(std.json.Value, allocator, value, .{}) catch try emptyObject(allocator)
    else
        try emptyObject(allocator);
    defer parsed.deinit();
    if (parsed.value != .object) {
        parsed.deinit();
        parsed = try emptyObject(allocator);
    }
    if (models_dir) |value| {
        try parsed.value.object.put(parsed.arena.allocator(), "models_dir", .{ .string = try parsed.arena.allocator().dupe(u8, value) });
    } else {
        _ = parsed.value.object.swapRemove("models_dir");
    }
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try std.json.Stringify.value(parsed.value, .{}, &output.writer);
    var atomic_file = try std.Io.Dir.cwd().createFileAtomic(io, settings_path, .{
        .permissions = @enumFromInt(0o600),
        .make_path = true,
        .replace = true,
    });
    defer atomic_file.deinit(io);
    try atomic_file.file.writeStreamingAll(io, output.writer.buffered());
    try atomic_file.file.sync(io);
    try atomic_file.replace(io);
    const data_dir_z = try allocator.dupeZ(u8, data_dir);
    defer allocator.free(data_dir_z);
    _ = std.c.chmod(data_dir_z.ptr, 0o700);
    return load(allocator, io, data_dir);
}

pub fn updateSelectedRuntimeTarget(allocator: std.mem.Allocator, io: std.Io, data_dir: []const u8, backend: []const u8, target_id: []const u8) !void {
    const settings_path = try path(allocator, data_dir);
    defer allocator.free(settings_path);
    const document = std.Io.Dir.cwd().readFileAlloc(io, settings_path, allocator, .limited(1024 * 1024)) catch |failure| switch (failure) {
        error.FileNotFound => null,
        else => return failure,
    };
    defer if (document) |value| allocator.free(value);
    var parsed = if (document) |value|
        std.json.parseFromSlice(std.json.Value, allocator, value, .{}) catch try emptyObject(allocator)
    else
        try emptyObject(allocator);
    defer parsed.deinit();
    if (parsed.value != .object) {
        parsed.deinit();
        parsed = try emptyObject(allocator);
    }
    const storage = parsed.arena.allocator();
    var selected: std.json.ObjectMap = if (parsed.value.object.get("selected_runtime_target_ids")) |value|
        if (value == .object) value.object else .empty
    else
        .empty;
    try selected.put(storage, try storage.dupe(u8, backend), .{ .string = try storage.dupe(u8, target_id) });
    try parsed.value.object.put(storage, "selected_runtime_target_ids", .{ .object = selected });
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try std.json.Stringify.value(parsed.value, .{}, &output.writer);
    try writeDocument(io, allocator, data_dir, settings_path, output.writer.buffered());
}

fn emptySnapshot(allocator: std.mem.Allocator) !Snapshot {
    return .{ .allocator = allocator, .models_dir = null, .legacy_ui_preferences = try allocator.dupe(u8, "{}") };
}

fn emptyObject(allocator: std.mem.Allocator) !std.json.Parsed(std.json.Value) {
    return std.json.parseFromSlice(std.json.Value, allocator, "{}", .{});
}

fn writeDocument(io: std.Io, allocator: std.mem.Allocator, data_dir: []const u8, settings_path: []const u8, document: []const u8) !void {
    var atomic_file = try std.Io.Dir.cwd().createFileAtomic(io, settings_path, .{
        .permissions = @enumFromInt(0o600),
        .make_path = true,
        .replace = true,
    });
    defer atomic_file.deinit(io);
    try atomic_file.file.writeStreamingAll(io, document);
    try atomic_file.file.sync(io);
    try atomic_file.replace(io);
    const data_dir_z = try allocator.dupeZ(u8, data_dir);
    defer allocator.free(data_dir_z);
    _ = std.c.chmod(data_dir_z.ptr, 0o700);
}

fn normalizedPreferences(allocator: std.mem.Allocator, value: ?std.json.Value) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeByte('{');
    var count: usize = 0;
    if (value) |preferences| if (preferences == .object) {
        var iterator = preferences.object.iterator();
        while (iterator.next()) |entry| {
            if (entry.key_ptr.len == 0 or entry.value_ptr.* != .string) continue;
            if (count > 0) try output.writer.writeByte(',');
            count += 1;
            try std.json.Stringify.value(entry.key_ptr.*, .{}, &output.writer);
            try output.writer.writeByte(':');
            try std.json.Stringify.value(entry.value_ptr.string, .{}, &output.writer);
        }
    };
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}
