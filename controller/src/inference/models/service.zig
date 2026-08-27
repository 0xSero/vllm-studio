const std = @import("std");
const instances = @import("../runtime/instance_store.zig");
const recipes = @import("../recipes/store.zig");
const sqlite = @import("../../storage/sqlite.zig");
const processes = @import("../runtime/processes.zig");

const vision_patterns = [_][]const u8{
    "mimo-v2.5", "mimo-v2-5", "step-3.7", "step-3_7", "step-3-7", "nex-n2", "gemma-4", "gemma4", "llava", "internvl", "qwen-vl", "qwen2-vl", "qwen2.5-vl", "qwen3-vl", "qwen-omni", "pixtral", "minicpm-v", "molmo", "phi-3.5-v", "phi-3-vision", "phi-4-mm", "phi-4-multimodal", "llama-3.2-vision", "llama-4", "deepseek-vl", "idefics", "ovis", "moondream", "fuyu", "kosmos", "-vl-", "-vlm", "vision", "multimodal", "-mm-",
};

pub const Resolution = struct {
    allocator: std.mem.Allocator,
    managed: bool,
    active: bool,
    canonical: ?[]u8 = null,
    active_model: ?[]u8 = null,

    pub fn deinit(resolution: *Resolution) void {
        if (resolution.canonical) |value| resolution.allocator.free(value);
        if (resolution.active_model) |value| resolution.allocator.free(value);
        resolution.* = undefined;
    }
};

pub fn resolveRequestedModel(allocator: std.mem.Allocator, io: std.Io, database: *sqlite.Database, column: recipes.PayloadColumn, llm_instance_path: []const u8, requested_model: []const u8) !Resolution {
    var documents = documents: {
        try database.lock(io);
        defer database.unlock(io);
        break :documents try recipes.list(allocator, database, column);
    };
    defer documents.deinit();
    const active_index = activeRecipeIndex(allocator, io, documents.items(), llm_instance_path);
    const active_model = if (active_index) |index| try modelIdFromDocument(allocator, documents.items()[index]) else null;
    errdefer if (active_model) |value| allocator.free(value);
    for (documents.items(), 0..) |document, index| {
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch continue;
        defer parsed.deinit();
        if (parsed.value != .object) continue;
        const id_value = parsed.value.object.get("id") orelse continue;
        if (id_value != .string or id_value.string.len == 0) continue;
        const served_name = servedModelName(parsed.value.object);
        if (!std.mem.eql(u8, id_value.string, requested_model) and (served_name == null or !std.mem.eql(u8, served_name.?, requested_model))) continue;
        return .{
            .allocator = allocator,
            .managed = true,
            .active = active_index != null and active_index.? == index,
            .canonical = try allocator.dupe(u8, served_name orelse id_value.string),
            .active_model = active_model,
        };
    }
    return .{ .allocator = allocator, .managed = false, .active = false, .active_model = active_model };
}

pub fn activeModelId(allocator: std.mem.Allocator, io: std.Io, database: *sqlite.Database, column: recipes.PayloadColumn, llm_instance_path: []const u8) !?[]u8 {
    var documents = documents: {
        try database.lock(io);
        defer database.unlock(io);
        break :documents try recipes.list(allocator, database, column);
    };
    defer documents.deinit();
    const index = activeRecipeIndex(allocator, io, documents.items(), llm_instance_path) orelse return null;
    return try modelIdFromDocument(allocator, documents.items()[index]);
}

pub fn activeRecipeId(allocator: std.mem.Allocator, io: std.Io, database: *sqlite.Database, column: recipes.PayloadColumn, llm_instance_path: []const u8) !?[]u8 {
    var documents = documents: {
        try database.lock(io);
        defer database.unlock(io);
        break :documents try recipes.list(allocator, database, column);
    };
    defer documents.deinit();
    const index = activeRecipeIndex(allocator, io, documents.items(), llm_instance_path) orelse return null;
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, documents.items()[index], .{}) catch return null;
    defer parsed.deinit();
    if (parsed.value != .object) return null;
    const id = parsed.value.object.get("id") orelse return null;
    if (id != .string or id.string.len == 0) return null;
    return try allocator.dupe(u8, id.string);
}

fn modelIdFromDocument(allocator: std.mem.Allocator, document: []const u8) !?[]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return null;
    defer parsed.deinit();
    if (parsed.value != .object) return null;
    const id_value = parsed.value.object.get("id") orelse return null;
    if (id_value != .string or id_value.string.len == 0) return null;
    return try allocator.dupe(u8, servedModelName(parsed.value.object) orelse id_value.string);
}

pub fn localCatalogPayload(allocator: std.mem.Allocator, io: std.Io, database: *sqlite.Database, column: recipes.PayloadColumn, llm_instance_path: []const u8) ![]u8 {
    var documents = documents: {
        try database.lock(io);
        defer database.unlock(io);
        break :documents try recipes.list(allocator, database, column);
    };
    defer documents.deinit();
    const active_index = activeRecipeIndex(allocator, io, documents.items(), llm_instance_path);

    const created = @max(std.Io.Clock.real.now(io).toSeconds(), 0);
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"object\":\"list\",\"data\":[");
    var count: usize = 0;
    for (documents.items(), 0..) |document, index| {
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch continue;
        defer parsed.deinit();
        if (parsed.value != .object) continue;
        const id_value = parsed.value.object.get("id") orelse continue;
        const name_value = parsed.value.object.get("name") orelse continue;
        const path_value = parsed.value.object.get("model_path") orelse continue;
        if (id_value != .string or id_value.string.len == 0 or name_value != .string or path_value != .string) continue;

        const model_id = servedModelName(parsed.value.object) orelse id_value.string;
        if (count > 0) try output.writer.writeByte(',');
        count += 1;
        try output.writer.writeAll("{\"id\":");
        try std.json.Stringify.value(model_id, .{}, &output.writer);
        try output.writer.print(",\"object\":\"model\",\"created\":{d},\"owned_by\":\"local-studio\",\"active\":{},\"max_model_len\":{d},\"metadata\":", .{ created, active_index != null and active_index.? == index, maxModelLength(parsed.value.object) });
        try writeMetadata(&output.writer, parsed.value.object, model_id, id_value.string, name_value.string, path_value.string);
        try output.writer.writeByte('}');
    }
    try output.writer.writeAll("]}");
    return try output.toOwnedSlice();
}

fn activeRecipeIndex(allocator: std.mem.Allocator, io: std.Io, documents: []const []const u8, llm_instance_path: []const u8) ?usize {
    var record = (instances.readLlm(allocator, io, llm_instance_path) catch return null) orelse return null;
    defer record.deinit();
    if (!processes.owns(allocator, io, &record)) return null;

    for (documents) |current_document| {
        var current = std.json.parseFromSlice(std.json.Value, allocator, current_document, .{}) catch continue;
        defer current.deinit();
        if (current.value != .object) continue;
        const current_id = current.value.object.get("id") orelse continue;
        if (current_id != .string or !std.mem.eql(u8, current_id.string, record.recipe_id)) continue;
        const current_path = current.value.object.get("model_path") orelse return null;
        if (current_path != .string) return null;
        const current_served_name = servedModelName(current.value.object);
        var best_index: ?usize = null;
        var best_rank: u8 = 0;
        for (documents, 0..) |candidate_document, index| {
            var candidate = std.json.parseFromSlice(std.json.Value, allocator, candidate_document, .{}) catch continue;
            defer candidate.deinit();
            if (candidate.value != .object) continue;
            const candidate_path = candidate.value.object.get("model_path") orelse continue;
            if (candidate_path != .string) continue;
            const rank = recipeMatchRank(servedModelName(candidate.value.object), candidate_path.string, current_served_name, current_path.string);
            if (rank > best_rank) {
                best_index = index;
                best_rank = rank;
            }
        }
        return best_index;
    }
    return null;
}

fn recipeMatchRank(candidate_name: ?[]const u8, candidate_path_value: []const u8, current_name: ?[]const u8, current_path_value: []const u8) u8 {
    if (candidate_name != null and current_name != null and std.ascii.eqlIgnoreCase(candidate_name.?, current_name.?)) return 4;
    const candidate_path = std.mem.trimEnd(u8, candidate_path_value, "/");
    const current_path = std.mem.trimEnd(u8, current_path_value, "/");
    if (std.mem.eql(u8, candidate_path, current_path)) return 3;
    if (pathPrefix(candidate_path, current_path) or pathPrefix(current_path, candidate_path)) return 2;
    if (std.mem.indexOfScalar(u8, candidate_path, '/') == null or std.mem.indexOfScalar(u8, current_path, '/') == null) {
        if (std.mem.eql(u8, std.fs.path.basename(candidate_path), std.fs.path.basename(current_path))) return 1;
    }
    return 0;
}

fn pathPrefix(ancestor: []const u8, descendant: []const u8) bool {
    if (std.mem.eql(u8, ancestor, descendant)) return true;
    return descendant.len > ancestor.len and std.mem.startsWith(u8, descendant, ancestor) and descendant[ancestor.len] == '/';
}

fn servedModelName(object: std.json.ObjectMap) ?[]const u8 {
    const value = object.get("served_model_name") orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len == 0) null else trimmed;
}

fn maxModelLength(object: std.json.ObjectMap) u64 {
    const value = object.get("max_model_len") orelse return 32768;
    return switch (value) {
        .integer => |number| if (number > 0) @intCast(number) else 32768,
        .float => |number| if (std.math.isFinite(number) and number >= 1) @intFromFloat(@floor(number)) else 32768,
        .string => |number| blk: {
            const parsed = std.fmt.parseInt(u64, number, 10) catch break :blk 32768;
            break :blk if (parsed > 0) parsed else 32768;
        },
        else => 32768,
    };
}

fn writeMetadata(writer: *std.Io.Writer, object: std.json.ObjectMap, model_id: []const u8, recipe_id: []const u8, name: []const u8, model_path: []const u8) !void {
    const metadata_value = if (object.get("extra_args")) |extra_args|
        if (extra_args == .object) extra_args.object.get("metadata") else null
    else
        null;
    try writer.writeByte('{');
    var wrote_field = false;
    if (metadata_value) |metadata| {
        if (metadata == .object) {
            var iterator = metadata.object.iterator();
            while (iterator.next()) |entry| {
                if (std.mem.eql(u8, entry.key_ptr.*, "vision")) continue;
                if (wrote_field) try writer.writeByte(',');
                wrote_field = true;
                try std.json.Stringify.value(entry.key_ptr.*, .{}, writer);
                try writer.writeByte(':');
                try std.json.Stringify.value(entry.value_ptr.*, .{}, writer);
            }
        }
    }
    if (wrote_field) try writer.writeByte(',');
    try writer.writeAll("\"vision\":");
    try writer.writeAll(if (resolveVision(object, metadata_value, &.{ model_id, recipe_id, name, model_path })) "true" else "false");
    try writer.writeByte('}');
}

fn resolveVision(object: std.json.ObjectMap, metadata: ?std.json.Value, identifiers: []const []const u8) bool {
    if (booleanValue(object.get("vision"))) |value| return value;
    if (metadata) |value| {
        if (value == .object) {
            if (booleanValue(value.object.get("vision"))) |result| return result;
            if (booleanValue(value.object.get("supportsVision"))) |result| return result;
            if (booleanValue(value.object.get("supports_vision"))) |result| return result;
            if (booleanValue(value.object.get("multimodal"))) |result| return result;
            if (value.object.get("capabilities")) |capabilities| {
                if (capabilities == .object) {
                    if (booleanValue(capabilities.object.get("vision"))) |result| return result;
                    if (booleanValue(capabilities.object.get("image"))) |result| return result;
                }
            }
            for ([_][]const u8{ "input", "inputs", "modalities", "input_modalities" }) |key| {
                if (imageModality(value.object.get(key))) |result| return result;
            }
        }
    }
    for (identifiers) |identifier| {
        for (vision_patterns) |pattern| {
            if (containsIgnoreCase(identifier, pattern)) return true;
        }
    }
    return false;
}

fn booleanValue(value: ?std.json.Value) ?bool {
    const present = value orelse return null;
    return switch (present) {
        .bool => |result| result,
        .string => |text| blk: {
            const trimmed = std.mem.trim(u8, text, " \t\r\n");
            if (std.ascii.eqlIgnoreCase(trimmed, "1") or std.ascii.eqlIgnoreCase(trimmed, "true") or std.ascii.eqlIgnoreCase(trimmed, "yes") or std.ascii.eqlIgnoreCase(trimmed, "on")) break :blk true;
            if (std.ascii.eqlIgnoreCase(trimmed, "0") or std.ascii.eqlIgnoreCase(trimmed, "false") or std.ascii.eqlIgnoreCase(trimmed, "no") or std.ascii.eqlIgnoreCase(trimmed, "off")) break :blk false;
            break :blk null;
        },
        else => null,
    };
}

fn imageModality(value: ?std.json.Value) ?bool {
    const present = value orelse return null;
    switch (present) {
        .string => |text| {
            var entries = std.mem.splitScalar(u8, text, ',');
            var declared = false;
            while (entries.next()) |entry| {
                const normalized = std.mem.trim(u8, entry, " \t\r\n");
                if (normalized.len == 0) continue;
                declared = true;
                if (std.ascii.eqlIgnoreCase(normalized, "image") or std.ascii.eqlIgnoreCase(normalized, "vision")) return true;
            }
            return if (declared) false else null;
        },
        .array => |entries| {
            var declared = false;
            for (entries.items) |entry| {
                if (entry != .string) continue;
                const normalized = std.mem.trim(u8, entry.string, " \t\r\n");
                if (normalized.len == 0) continue;
                declared = true;
                if (std.ascii.eqlIgnoreCase(normalized, "image") or std.ascii.eqlIgnoreCase(normalized, "vision")) return true;
            }
            return if (declared) false else null;
        },
        else => return null,
    }
}

fn containsIgnoreCase(haystack: []const u8, needle: []const u8) bool {
    if (needle.len == 0 or haystack.len < needle.len) return false;
    var index: usize = 0;
    while (index + needle.len <= haystack.len) : (index += 1) {
        if (std.ascii.eqlIgnoreCase(haystack[index .. index + needle.len], needle)) return true;
    }
    return false;
}
