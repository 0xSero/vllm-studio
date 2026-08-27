const std = @import("std");
const config_module = @import("../app/config.zig");
const instance_repository = @import("../inference/runtime/instance_store.zig");
const recipe_repository = @import("../inference/recipes/store.zig");
const sqlite = @import("../storage/sqlite.zig");
const lifecycle = @import("../inference/runtime/lifecycle.zig");
const recipes = @import("../inference/recipes/service.zig");

const Io = std.Io;
const max_tail_bytes = 10 * 1024 * 1024;

const Entry = struct {
    allocator: std.mem.Allocator,
    session_id: []u8,
    path: []u8,
    modified: Io.Timestamp,

    fn deinit(entry: *Entry) void {
        entry.allocator.free(entry.session_id);
        entry.allocator.free(entry.path);
        entry.* = undefined;
    }
};

pub fn listPayload(allocator: std.mem.Allocator, io: Io, config: *const config_module.Config, database: *sqlite.Database, recipe_column: recipe_repository.PayloadColumn, default_trust_remote_code: bool, supervisor: *lifecycle.Supervisor) ![]u8 {
    var entries = try listEntries(allocator, io, config.data_dir, config.environment.get("TMPDIR") orelse "/tmp");
    defer {
        for (entries.items) |*entry| entry.deinit();
        entries.deinit(allocator);
    }
    std.mem.sort(Entry, entries.items, {}, newerEntry);
    const running = try supervisor.isRunning();
    var current_recipe: ?[]u8 = null;
    defer if (current_recipe) |value| allocator.free(value);
    if (try instance_repository.readLlm(allocator, io, config.llm_instance_path)) |record_value| {
        var record = record_value;
        defer record.deinit();
        current_recipe = try allocator.dupe(u8, record.recipe_id);
    }
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"sessions\":[");
    for (entries.items, 0..) |entry, index| {
        if (index > 0) try output.writer.writeByte(',');
        const recipe_id = if (std.mem.eql(u8, entry.session_id, "llm")) current_recipe orelse "llm" else entry.session_id;
        var metadata = try recipeMetadata(allocator, io, database, recipe_column, recipe_id, default_trust_remote_code);
        defer metadata.deinit();
        var timestamp_buffer: [24]u8 = undefined;
        const Row = struct {
            id: []const u8,
            recipe_id: []const u8,
            recipe_name: ?[]const u8,
            model_path: ?[]const u8,
            model: []const u8,
            backend: ?[]const u8,
            created_at: []const u8,
            status: []const u8,
        };
        try std.json.Stringify.value(Row{
            .id = entry.session_id,
            .recipe_id = recipe_id,
            .recipe_name = metadata.name,
            .model_path = metadata.model_path,
            .model = metadata.served_model_name orelse metadata.name orelse entry.session_id,
            .backend = metadata.backend,
            .created_at = formatTimestamp(entry.modified.toSeconds(), &timestamp_buffer),
            .status = if (running and (std.mem.eql(u8, entry.session_id, "llm") or (current_recipe != null and std.mem.eql(u8, current_recipe.?, recipe_id)))) "running" else "stopped",
        }, .{}, &output.writer);
    }
    try output.writer.writeAll("]}");
    return try output.toOwnedSlice();
}

pub fn tailPayload(allocator: std.mem.Allocator, io: Io, config: *const config_module.Config, session_id: []const u8, limit: usize) !?[]u8 {
    if (!validSessionId(session_id)) return error.InvalidSessionId;
    const path = try resolveLogPath(allocator, io, config, session_id) orelse return null;
    defer allocator.free(path);
    var file = try std.Io.Dir.cwd().openFile(io, path, .{});
    defer file.close(io);
    const length = try file.length(io);
    const read_length: usize = @intCast(@min(length, max_tail_bytes));
    const offset = length - read_length;
    const storage = try allocator.alloc(u8, read_length);
    defer allocator.free(storage);
    const bytes_read = try file.readPositionalAll(io, storage, offset);
    var document = storage[0..bytes_read];
    if (offset > 0) {
        const newline = std.mem.indexOfScalar(u8, document, '\n') orelse document.len;
        document = if (newline < document.len) document[newline + 1 ..] else document[document.len..];
    }
    var line_count: usize = 0;
    for (document) |character| if (character == '\n') {
        line_count += 1;
    };
    var skip = line_count -| limit;
    var lines: std.ArrayList([]u8) = .empty;
    defer {
        for (lines.items) |line| allocator.free(line);
        lines.deinit(allocator);
    }
    var iterator = std.mem.splitScalar(u8, document, '\n');
    while (iterator.next()) |raw_line| {
        if (skip > 0) {
            skip -= 1;
            continue;
        }
        const line = std.mem.trimEnd(u8, raw_line, "\r");
        if (line.len == 0 and iterator.index == null) continue;
        try lines.append(allocator, try redactLine(allocator, line));
    }
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"id\":");
    try std.json.Stringify.value(session_id, .{}, &output.writer);
    try output.writer.writeAll(",\"logs\":");
    try std.json.Stringify.value(lines.items, .{}, &output.writer);
    try output.writer.writeAll(",\"content\":");
    var content: Io.Writer.Allocating = .init(allocator);
    defer content.deinit();
    for (lines.items, 0..) |line, index| {
        if (index > 0) try content.writer.writeByte('\n');
        try content.writer.writeAll(line);
    }
    try std.json.Stringify.value(content.writer.buffered(), .{}, &output.writer);
    try output.writer.writeByte('}');
    return try output.toOwnedSlice();
}

pub fn delete(io: Io, allocator: std.mem.Allocator, config: *const config_module.Config, session_id: []const u8) !bool {
    if (!validSessionId(session_id)) return error.InvalidSessionId;
    if (std.mem.eql(u8, session_id, "controller")) return error.ControllerLogProtected;
    const path = try resolveLogPath(allocator, io, config, session_id) orelse return false;
    defer allocator.free(path);
    std.Io.Dir.cwd().deleteFile(io, path) catch |failure| switch (failure) {
        error.FileNotFound => return false,
        else => return failure,
    };
    return true;
}

fn listEntries(allocator: std.mem.Allocator, io: Io, data_dir: []const u8, temp_dir: []const u8) !std.ArrayList(Entry) {
    var entries: std.ArrayList(Entry) = .empty;
    errdefer {
        for (entries.items) |*entry| entry.deinit();
        entries.deinit(allocator);
    }
    const current_path = try std.fs.path.join(allocator, &.{ data_dir, "instances", "logs", "llm.log" });
    defer allocator.free(current_path);
    if (std.Io.Dir.cwd().statFile(io, current_path, .{})) |stat| {
        try appendOrReplace(allocator, &entries, "llm", current_path, stat.mtime);
    } else |_| {}
    const legacy_dir = try std.fs.path.join(allocator, &.{ data_dir, "logs" });
    defer allocator.free(legacy_dir);
    try scanLegacy(allocator, io, &entries, legacy_dir);
    try scanLegacy(allocator, io, &entries, temp_dir);
    return entries;
}

fn scanLegacy(allocator: std.mem.Allocator, io: Io, entries: *std.ArrayList(Entry), directory_path: []const u8) !void {
    var directory = std.Io.Dir.cwd().openDir(io, directory_path, .{ .iterate = true }) catch return;
    defer directory.close(io);
    var iterator = directory.iterateAssumeFirstIteration();
    while (try iterator.next(io)) |entry| {
        if (entry.kind != .file or !std.mem.startsWith(u8, entry.name, "vllm_") or !std.mem.endsWith(u8, entry.name, ".log")) continue;
        const session_id = entry.name["vllm_".len .. entry.name.len - ".log".len];
        if (!validSessionId(session_id)) continue;
        const path = try std.fs.path.join(allocator, &.{ directory_path, entry.name });
        defer allocator.free(path);
        const stat = directory.statFile(io, entry.name, .{}) catch continue;
        try appendOrReplace(allocator, entries, session_id, path, stat.mtime);
    }
}

fn appendOrReplace(allocator: std.mem.Allocator, entries: *std.ArrayList(Entry), session_id: []const u8, path: []const u8, modified: Io.Timestamp) !void {
    for (entries.items) |*entry| {
        if (!std.mem.eql(u8, entry.session_id, session_id)) continue;
        if (entry.modified.nanoseconds >= modified.nanoseconds) return;
        allocator.free(entry.path);
        entry.path = try allocator.dupe(u8, path);
        entry.modified = modified;
        return;
    }
    try entries.append(allocator, .{
        .allocator = allocator,
        .session_id = try allocator.dupe(u8, session_id),
        .path = try allocator.dupe(u8, path),
        .modified = modified,
    });
}

fn newerEntry(_: void, left: Entry, right: Entry) bool {
    return left.modified.nanoseconds > right.modified.nanoseconds;
}

pub fn resolveLogPath(allocator: std.mem.Allocator, io: Io, config: *const config_module.Config, session_id: []const u8) !?[]u8 {
    if (!validSessionId(session_id)) return error.InvalidSessionId;
    const data_dir = config.data_dir;
    const temp_dir = config.environment.get("TMPDIR") orelse "/tmp";
    const current_name = try std.fmt.allocPrint(allocator, "{s}.log", .{session_id});
    defer allocator.free(current_name);
    const current = try std.fs.path.join(allocator, &.{ data_dir, "instances", "logs", current_name });
    defer allocator.free(current);
    if (fileExists(io, current)) return try allocator.dupe(u8, current);
    const legacy_name = try std.fmt.allocPrint(allocator, "vllm_{s}.log", .{session_id});
    defer allocator.free(legacy_name);
    const legacy = try std.fs.path.join(allocator, &.{ data_dir, "logs", legacy_name });
    defer allocator.free(legacy);
    if (fileExists(io, legacy)) return try allocator.dupe(u8, legacy);
    const fallback = try std.fs.path.join(allocator, &.{ temp_dir, legacy_name });
    defer allocator.free(fallback);
    return if (fileExists(io, fallback)) try allocator.dupe(u8, fallback) else null;
}

pub fn redact(allocator: std.mem.Allocator, line: []const u8) ![]u8 {
    return redactLine(allocator, line);
}

fn fileExists(io: Io, path: []const u8) bool {
    _ = std.Io.Dir.cwd().statFile(io, path, .{}) catch return false;
    return true;
}

fn validSessionId(value: []const u8) bool {
    if (value.len == 0 or std.mem.eql(u8, value, ".") or std.mem.eql(u8, value, "..")) return false;
    for (value) |character| if (!std.ascii.isAlphanumeric(character) and character != '.' and character != '_' and character != '-') return false;
    return true;
}

const RecipeMetadata = struct {
    allocator: std.mem.Allocator,
    name: ?[]u8 = null,
    model_path: ?[]u8 = null,
    served_model_name: ?[]u8 = null,
    backend: ?[]u8 = null,

    fn deinit(metadata: *RecipeMetadata) void {
        if (metadata.name) |value| metadata.allocator.free(value);
        if (metadata.model_path) |value| metadata.allocator.free(value);
        if (metadata.served_model_name) |value| metadata.allocator.free(value);
        if (metadata.backend) |value| metadata.allocator.free(value);
        metadata.* = undefined;
    }
};

fn recipeMetadata(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, recipe_column: recipe_repository.PayloadColumn, recipe_id: []const u8, default_trust_remote_code: bool) !RecipeMetadata {
    const document = recipes.detailPayload(allocator, io, database, recipe_column, recipe_id, default_trust_remote_code) catch return .{ .allocator = allocator };
    const recipe_document = document orelse return .{ .allocator = allocator };
    defer allocator.free(recipe_document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, recipe_document, .{}) catch return .{ .allocator = allocator };
    defer parsed.deinit();
    if (parsed.value != .object) return .{ .allocator = allocator };
    var metadata: RecipeMetadata = .{ .allocator = allocator };
    errdefer metadata.deinit();
    metadata.name = try duplicateField(allocator, parsed.value.object, "name");
    metadata.model_path = try duplicateField(allocator, parsed.value.object, "model_path");
    metadata.served_model_name = try duplicateField(allocator, parsed.value.object, "served_model_name");
    metadata.backend = try duplicateField(allocator, parsed.value.object, "backend");
    return metadata;
}

fn duplicateField(allocator: std.mem.Allocator, object: std.json.ObjectMap, name: []const u8) !?[]u8 {
    const value = object.get(name) orelse return null;
    if (value != .string or value.string.len == 0) return null;
    return try allocator.dupe(u8, value.string);
}

fn redactLine(allocator: std.mem.Allocator, line: []const u8) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    var index: usize = 0;
    while (index < line.len) {
        if (index + 2 < line.len and line[index] == '-' and line[index + 1] == '-' and (index == 0 or std.ascii.isWhitespace(line[index - 1]))) {
            var flag_end = index + 2;
            while (flag_end < line.len and (std.ascii.isAlphanumeric(line[flag_end]) or line[flag_end] == '_' or line[flag_end] == '-')) : (flag_end += 1) {}
            if (flag_end > index + 2 and secretKey(line[index + 2 .. flag_end])) {
                var value_start = flag_end;
                while (value_start < line.len and std.ascii.isWhitespace(line[value_start])) : (value_start += 1) {}
                if (value_start > flag_end and value_start < line.len) {
                    try output.writer.writeAll(line[index..value_start]);
                    index = value_start;
                    const value_quote = if (line[index] == '"' or line[index] == '\'') line[index] else null;
                    if (value_quote) |quote| {
                        try output.writer.writeByte(quote);
                        index += 1;
                        while (index < line.len and line[index] != quote) : (index += 1) {}
                        try output.writer.writeAll("[redacted]");
                        if (index < line.len) {
                            try output.writer.writeByte(line[index]);
                            index += 1;
                        }
                    } else {
                        while (index < line.len and !std.ascii.isWhitespace(line[index]) and line[index] != ';' and line[index] != ',' and line[index] != '"' and line[index] != '\'' and line[index] != '&') : (index += 1) {}
                        try output.writer.writeAll("[redacted]");
                    }
                    continue;
                }
            }
        }
        const key_start = index;
        var quoted_key: ?u8 = null;
        if (line[index] == '"' or line[index] == '\'') {
            quoted_key = line[index];
            index += 1;
        }
        const name_start = index;
        while (index < line.len and (std.ascii.isAlphanumeric(line[index]) or line[index] == '_' or line[index] == '-')) : (index += 1) {}
        if (index == name_start) {
            try output.writer.writeByte(line[key_start]);
            index = key_start + 1;
            continue;
        }
        const name = line[name_start..index];
        if (quoted_key) |quote| {
            if (index >= line.len or line[index] != quote) {
                try output.writer.writeAll(line[key_start..index]);
                continue;
            }
            index += 1;
        }
        while (index < line.len and std.ascii.isWhitespace(line[index])) : (index += 1) {}
        if (index >= line.len or (line[index] != '=' and line[index] != ':')) {
            try output.writer.writeAll(line[key_start..index]);
            continue;
        }
        const delimiter_index = index;
        index += 1;
        while (index < line.len and std.ascii.isWhitespace(line[index])) : (index += 1) {}
        if (!secretKey(name)) {
            try output.writer.writeAll(line[key_start..index]);
            continue;
        }
        try output.writer.writeAll(line[key_start .. delimiter_index + 1]);
        try output.writer.writeAll(line[delimiter_index + 1 .. index]);
        if (std.ascii.eqlIgnoreCase(name, "authorization") and startsWithIgnoreCase(line[index..], "Bearer")) {
            const bearer_end = index + "Bearer".len;
            try output.writer.writeAll(line[index..bearer_end]);
            index = bearer_end;
            while (index < line.len and std.ascii.isWhitespace(line[index])) : (index += 1) try output.writer.writeByte(line[index]);
        }
        const quote = if (index < line.len and (line[index] == '"' or line[index] == '\'')) line[index] else null;
        if (quote) |value_quote| {
            try output.writer.writeByte(value_quote);
            index += 1;
            while (index < line.len and line[index] != value_quote) : (index += 1) {}
            try output.writer.writeAll("[redacted]");
            if (index < line.len) {
                try output.writer.writeByte(line[index]);
                index += 1;
            }
        } else {
            while (index < line.len and !std.ascii.isWhitespace(line[index]) and line[index] != ';' and line[index] != ',' and line[index] != '"' and line[index] != '\'' and line[index] != '&') : (index += 1) {}
            try output.writer.writeAll("[redacted]");
        }
    }
    return try output.toOwnedSlice();
}

fn secretKey(name: []const u8) bool {
    var compact_buffer: [128]u8 = undefined;
    if (name.len > compact_buffer.len) return false;
    for (name, compact_buffer[0..name.len]) |character, *target| target.* = if (character == '-') '_' else std.ascii.toLower(character);
    const compact = compact_buffer[0..name.len];
    for ([_][]const u8{ "authorization", "x_api_key", "api_key", "apikey", "api_token", "auth_token", "access_token", "refresh_token", "authorization_code", "device_code", "code_verifier", "token", "key", "secret", "hf_token", "hugging_face_hub_token", "openai_api_key", "anthropic_api_key", "password", "passwd", "client_secret", "id_token", "session_token", "secret_access_key" }) |known| {
        if (std.mem.eql(u8, compact, known)) return true;
    }
    for ([_][]const u8{ "_api_key", "_token", "_secret_access_key", "_secret_key", "_secret", "_password" }) |suffix| {
        if (std.mem.endsWith(u8, compact, suffix)) return true;
    }
    return false;
}

fn startsWithIgnoreCase(value: []const u8, prefix: []const u8) bool {
    return value.len >= prefix.len and std.ascii.eqlIgnoreCase(value[0..prefix.len], prefix);
}

fn formatTimestamp(seconds_value: i64, buffer: *[24]u8) []const u8 {
    const epoch = std.time.epoch.EpochSeconds{ .secs = @intCast(@max(seconds_value, 0)) };
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
