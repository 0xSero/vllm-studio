const std = @import("std");
const config_module = @import("../../app/config.zig");
const controller_settings = @import("controller_store.zig");
const settings_file = @import("studio_store.zig");
const sqlite = @import("../../storage/sqlite.zig");

pub const State = struct {
    allocator: std.mem.Allocator,
    mutex: std.Io.Mutex = .init,
    files_mutex: std.Io.Mutex = .init,
    models_dir: []u8,

    pub fn init(allocator: std.mem.Allocator, models_dir: []const u8) !State {
        return .{ .allocator = allocator, .models_dir = try allocator.dupe(u8, models_dir) };
    }

    pub fn deinit(state: *State) void {
        state.allocator.free(state.models_dir);
        state.* = undefined;
    }

    pub fn modelsDirectory(state: *State, allocator: std.mem.Allocator, io: std.Io) ![]u8 {
        try state.mutex.lock(io);
        defer state.mutex.unlock(io);
        return allocator.dupe(u8, state.models_dir);
    }

    pub fn lockFiles(state: *State, io: std.Io) !void {
        try state.files_mutex.lock(io);
    }

    pub fn unlockFiles(state: *State, io: std.Io) void {
        state.files_mutex.unlock(io);
    }

    pub fn lockSettings(state: *State, io: std.Io) !void {
        try state.mutex.lock(io);
    }

    pub fn unlockSettings(state: *State, io: std.Io) void {
        state.mutex.unlock(io);
    }
};

pub fn payload(allocator: std.mem.Allocator, io: std.Io, configuration: *const config_module.Config, state: *State, database: *sqlite.Database) ![]u8 {
    try state.mutex.lock(io);
    var persisted = settings_file.load(allocator, io, configuration.data_dir) catch |failure| {
        state.mutex.unlock(io);
        return failure;
    };
    const effective_models_dir = allocator.dupe(u8, state.models_dir) catch |failure| {
        persisted.deinit();
        state.mutex.unlock(io);
        return failure;
    };
    state.mutex.unlock(io);
    defer persisted.deinit();
    defer allocator.free(effective_models_dir);

    try database.lock(io);
    var preferences = controller_settings.getUiPreferences(allocator, database) catch |failure| {
        database.unlock(io);
        return failure;
    };
    if (isEmptyPreferences(preferences) and !isEmptyPreferences(persisted.legacy_ui_preferences)) {
        allocator.free(preferences);
        preferences = controller_settings.saveUiPreferences(allocator, database, persisted.legacy_ui_preferences) catch |failure| {
            database.unlock(io);
            return failure;
        };
    }
    database.unlock(io);
    defer allocator.free(preferences);
    return buildPayload(allocator, configuration.data_dir, persisted.models_dir, preferences, effective_models_dir);
}

pub fn updatePayload(allocator: std.mem.Allocator, io: std.Io, configuration: *const config_module.Config, state: *State, database: *sqlite.Database, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidSettingsPayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidSettingsPayload;
    const models_value = parsed.value.object.get("models_dir");
    const preferences_value = parsed.value.object.get("ui_preferences");
    if (models_value == null and preferences_value == null) return error.NoSupportedSettings;

    var normalized_models: ?[]u8 = null;
    defer if (normalized_models) |value| allocator.free(value);
    if (models_value) |value| switch (value) {
        .null => {},
        .string => {
            const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
            if (trimmed.len > 0) normalized_models = try allocator.dupe(u8, trimmed);
        },
        else => return error.InvalidModelsDirectory,
    };

    var normalized_preferences: ?[]u8 = null;
    defer if (normalized_preferences) |value| allocator.free(value);
    if (preferences_value) |value| normalized_preferences = switch (value) {
        .null => try allocator.dupe(u8, "{}"),
        .object => try normalizePreferences(allocator, value.object),
        else => return error.InvalidUiPreferences,
    };

    if (models_value != null) {
        var replacement: ?[]u8 = null;
        errdefer if (replacement) |value| state.allocator.free(value);
        if (normalized_models) |models_dir| {
            const cwd = try std.Io.Dir.cwd().realPathFileAlloc(io, ".", allocator);
            defer allocator.free(cwd);
            replacement = try std.fs.path.resolve(state.allocator, &.{ cwd, models_dir });
        }
        try state.mutex.lock(io);
        var saved = settings_file.updateModelsDirectory(allocator, io, configuration.data_dir, normalized_models) catch |failure| {
            state.mutex.unlock(io);
            return failure;
        };
        saved.deinit();
        if (replacement) |models_dir| {
            state.allocator.free(state.models_dir);
            state.models_dir = models_dir;
            replacement = null;
        }
        state.mutex.unlock(io);
    }

    if (normalized_preferences) |preferences| {
        try database.lock(io);
        const saved = controller_settings.saveUiPreferences(allocator, database, preferences) catch |failure| {
            database.unlock(io);
            return failure;
        };
        database.unlock(io);
        allocator.free(saved);
    }

    const response = try payload(allocator, io, configuration, state, database);
    defer allocator.free(response);
    if (response.len == 0 or response[0] != '{') return error.InvalidSettingsPayload;
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"success\":true,");
    try output.writer.writeAll(response[1..]);
    return output.toOwnedSlice();
}

fn buildPayload(allocator: std.mem.Allocator, data_dir: []const u8, models_dir: ?[]const u8, preferences: []const u8, effective_models_dir: []const u8) ![]u8 {
    const settings_path = try settings_file.path(allocator, data_dir);
    defer allocator.free(settings_path);
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"config_path\":");
    try std.json.Stringify.value(settings_path, .{}, &output.writer);
    try output.writer.writeAll(",\"persisted\":{");
    if (models_dir) |value| {
        try output.writer.writeAll("\"models_dir\":");
        try std.json.Stringify.value(value, .{}, &output.writer);
        try output.writer.writeByte(',');
    }
    try output.writer.writeAll("\"ui_preferences\":");
    try output.writer.writeAll(preferences);
    try output.writer.writeAll("},\"effective\":{\"models_dir\":");
    try std.json.Stringify.value(effective_models_dir, .{}, &output.writer);
    try output.writer.writeAll("}}");
    return output.toOwnedSlice();
}

fn normalizePreferences(allocator: std.mem.Allocator, preferences: std.json.ObjectMap) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeByte('{');
    var count: usize = 0;
    var iterator = preferences.iterator();
    while (iterator.next()) |entry| {
        if (entry.value_ptr.* != .string) return error.InvalidUiPreferences;
        if (entry.key_ptr.len == 0) continue;
        if (count > 0) try output.writer.writeByte(',');
        count += 1;
        try std.json.Stringify.value(entry.key_ptr.*, .{}, &output.writer);
        try output.writer.writeByte(':');
        try std.json.Stringify.value(entry.value_ptr.string, .{}, &output.writer);
    }
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn isEmptyPreferences(document: []const u8) bool {
    return std.mem.eql(u8, document, "{}");
}
