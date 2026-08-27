const std = @import("std");
const recipe_repository = @import("../recipes/store.zig");
const sqlite = @import("../../storage/sqlite.zig");
const storage = @import("../../system/storage.zig");

const Recipe = struct {
    id: []u8,
    model_path: []u8,
};

const Root = struct {
    path: []u8,
    exists: bool,
    sources: std.ArrayList([]const u8) = .empty,
    recipe_ids: std.ArrayList([]const u8) = .empty,

    fn deinit(root: *Root, allocator: std.mem.Allocator) void {
        allocator.free(root.path);
        root.sources.deinit(allocator);
        root.recipe_ids.deinit(allocator);
        root.* = undefined;
    }
};

const Metadata = struct {
    allocator: std.mem.Allocator,
    architecture: ?[]u8 = null,
    context_length: ?i64 = null,

    fn deinit(metadata: *Metadata) void {
        if (metadata.architecture) |architecture| metadata.allocator.free(architecture);
        metadata.* = undefined;
    }
};

pub fn payload(allocator: std.mem.Allocator, io: std.Io, database: *sqlite.Database, column: recipe_repository.PayloadColumn, models_dir: []const u8, environment: *const std.process.Environ.Map) ![]u8 {
    var recipes = try loadRecipes(allocator, io, database, column);
    defer {
        for (recipes.items) |recipe| {
            allocator.free(recipe.id);
            allocator.free(recipe.model_path);
        }
        recipes.deinit(allocator);
    }
    const cwd = try std.Io.Dir.cwd().realPathFileAlloc(io, ".", allocator);
    defer allocator.free(cwd);
    const home = environment.get("HOME") orelse "";

    var roots: std.ArrayList(Root) = .empty;
    defer {
        for (roots.items) |*root| root.deinit(allocator);
        roots.deinit(allocator);
    }
    const configured_root = try expandPath(allocator, cwd, home, models_dir);
    defer allocator.free(configured_root);
    try addRoot(allocator, io, &roots, configured_root, "config", null);
    for (recipes.items) |recipe| {
        if (!std.fs.path.isAbsolute(recipe.model_path)) continue;
        const canonical = try expandPath(allocator, cwd, home, recipe.model_path);
        defer allocator.free(canonical);
        const parent = std.fs.path.dirname(canonical) orelse continue;
        if (std.mem.eql(u8, parent, std.fs.path.sep_str)) continue;
        try addRoot(allocator, io, &roots, parent, "recipe_parent", recipe.id);
    }
    std.mem.sort(Root, roots.items, {}, lessRoot);

    var scan_roots: std.ArrayList([]const u8) = .empty;
    defer scan_roots.deinit(allocator);
    for (roots.items) |root| if (root.exists) try scan_roots.append(allocator, root.path);
    var directories = try storage.discover(allocator, io, scan_roots.items, 2, 1000);
    defer {
        for (directories.items) |directory| allocator.free(directory);
        directories.deinit(allocator);
    }
    std.mem.sort([]u8, directories.items, {}, lessModelPath);

    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"models\":[");
    for (directories.items, 0..) |directory, index| {
        if (index > 0) try output.writer.writeByte(',');
        try writeModel(allocator, io, &output.writer, cwd, home, directory, recipes.items);
    }
    try output.writer.writeAll("],\"roots\":[");
    for (roots.items, 0..) |*root, index| {
        if (index > 0) try output.writer.writeByte(',');
        std.mem.sort([]const u8, root.sources.items, {}, lessString);
        std.mem.sort([]const u8, root.recipe_ids.items, {}, lessString);
        const RootPayload = struct {
            path: []const u8,
            exists: bool,
            sources: []const []const u8,
            recipe_ids: []const []const u8,
        };
        try std.json.Stringify.value(RootPayload{
            .path = root.path,
            .exists = root.exists,
            .sources = root.sources.items,
            .recipe_ids = root.recipe_ids.items,
        }, .{}, &output.writer);
    }
    try output.writer.writeAll("],\"configured_models_dir\":");
    try std.json.Stringify.value(models_dir, .{}, &output.writer);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn loadRecipes(allocator: std.mem.Allocator, io: std.Io, database: *sqlite.Database, column: recipe_repository.PayloadColumn) !std.ArrayList(Recipe) {
    try database.lock(io);
    var documents = recipe_repository.list(allocator, database, column) catch |failure| {
        database.unlock(io);
        return failure;
    };
    database.unlock(io);
    defer documents.deinit();
    var recipes: std.ArrayList(Recipe) = .empty;
    errdefer {
        for (recipes.items) |recipe| {
            allocator.free(recipe.id);
            allocator.free(recipe.model_path);
        }
        recipes.deinit(allocator);
    }
    for (documents.items()) |document| {
        var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch continue;
        defer parsed.deinit();
        if (parsed.value != .object) continue;
        const id_value = parsed.value.object.get("id") orelse continue;
        const path_value = parsed.value.object.get("model_path") orelse continue;
        if (id_value != .string or path_value != .string) continue;
        const id = std.mem.trim(u8, id_value.string, " \t\r\n");
        const model_path = std.mem.trim(u8, path_value.string, " \t\r\n");
        if (id.len == 0 or model_path.len == 0) continue;
        const owned_id = try allocator.dupe(u8, id);
        errdefer allocator.free(owned_id);
        const owned_model_path = try allocator.dupe(u8, model_path);
        errdefer allocator.free(owned_model_path);
        try recipes.append(allocator, .{
            .id = owned_id,
            .model_path = owned_model_path,
        });
    }
    return recipes;
}

fn addRoot(allocator: std.mem.Allocator, io: std.Io, roots: *std.ArrayList(Root), path: []const u8, source: []const u8, recipe_id: ?[]const u8) !void {
    for (roots.items) |*root| {
        if (!std.mem.eql(u8, root.path, path)) continue;
        try appendUnique(allocator, &root.sources, source);
        if (recipe_id) |id| try appendUnique(allocator, &root.recipe_ids, id);
        return;
    }
    var root = Root{
        .path = try allocator.dupe(u8, path),
        .exists = pathExists(io, path),
    };
    errdefer root.deinit(allocator);
    try root.sources.append(allocator, source);
    if (recipe_id) |id| try root.recipe_ids.append(allocator, id);
    try roots.append(allocator, root);
}

fn appendUnique(allocator: std.mem.Allocator, values: *std.ArrayList([]const u8), value: []const u8) !void {
    for (values.items) |existing| if (std.mem.eql(u8, existing, value)) return;
    try values.append(allocator, value);
}

fn writeModel(allocator: std.mem.Allocator, io: std.Io, writer: *std.Io.Writer, cwd: []const u8, home: []const u8, directory: []const u8, recipes: []const Recipe) !void {
    const name = std.fs.path.basename(directory);
    var recipe_ids: std.ArrayList([]const u8) = .empty;
    defer recipe_ids.deinit(allocator);
    for (recipes) |recipe| {
        if (!std.fs.path.isAbsolute(recipe.model_path)) continue;
        const canonical = try expandPath(allocator, cwd, home, recipe.model_path);
        defer allocator.free(canonical);
        if (std.mem.eql(u8, canonical, directory)) try appendUnique(allocator, &recipe_ids, recipe.id);
    }
    if (recipe_ids.items.len == 0) {
        var matched: ?[]const u8 = null;
        var count: usize = 0;
        for (recipes) |recipe| {
            if (!std.mem.eql(u8, std.fs.path.basename(recipe.model_path), name)) continue;
            matched = recipe.id;
            count += 1;
        }
        if (count == 1) try recipe_ids.append(allocator, matched.?);
    }
    std.mem.sort([]const u8, recipe_ids.items, {}, lessString);
    var metadata = loadMetadata(allocator, io, directory);
    defer metadata.deinit();
    const weights = storage.weightBytes(io, directory);
    const stat = std.Io.Dir.cwd().statFile(io, directory, .{}) catch null;
    const modified_at: ?i64 = if (stat) |value| std.math.cast(i64, @divTrunc(value.mtime.nanoseconds, 1_000_000)) else null;
    const Model = struct {
        name: []const u8,
        path: []const u8,
        size_bytes: ?u64,
        modified_at: ?i64,
        architecture: ?[]const u8,
        quantization: ?[]const u8,
        context_length: ?i64,
        recipe_ids: []const []const u8,
        has_recipe: bool,
    };
    try std.json.Stringify.value(Model{
        .name = name,
        .path = directory,
        .size_bytes = if (weights > 0) weights else null,
        .modified_at = modified_at,
        .architecture = metadata.architecture,
        .quantization = inferQuantization(name),
        .context_length = metadata.context_length,
        .recipe_ids = recipe_ids.items,
        .has_recipe = recipe_ids.items.len > 0,
    }, .{}, writer);
}

fn loadMetadata(allocator: std.mem.Allocator, io: std.Io, directory: []const u8) Metadata {
    var result = Metadata{ .allocator = allocator };
    const config_path = std.fs.path.join(allocator, &.{ directory, "config.json" }) catch return result;
    defer allocator.free(config_path);
    const document = std.Io.Dir.cwd().readFileAlloc(io, config_path, allocator, .limited(1024 * 1024)) catch return result;
    defer allocator.free(document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return result;
    defer parsed.deinit();
    if (parsed.value != .object) return result;
    if (parsed.value.object.get("architectures")) |architectures| if (architectures == .array and architectures.array.items.len > 0) {
        const first = architectures.array.items[0];
        if (first == .string) result.architecture = allocator.dupe(u8, first.string) catch null;
    };
    for ([_][]const u8{ "max_position_embeddings", "max_seq_len", "seq_length", "n_ctx" }) |field| {
        const value = parsed.value.object.get(field) orelse continue;
        result.context_length = positiveInteger(value);
        if (result.context_length != null) break;
    }
    return result;
}

fn positiveInteger(value: std.json.Value) ?i64 {
    return switch (value) {
        .integer => |number| if (number >= 0) number else null,
        .float => |number| if (number >= 0 and number <= @as(f64, @floatFromInt(std.math.maxInt(i64)))) @intFromFloat(number) else null,
        .string => |text| blk: {
            if (text.len == 0) break :blk null;
            for (text) |byte| if (!std.ascii.isDigit(byte)) break :blk null;
            break :blk std.fmt.parseInt(i64, text, 10) catch null;
        },
        else => null,
    };
}

fn inferQuantization(name: []const u8) ?[]const u8 {
    for ([_][]const u8{ "awq", "gptq", "gguf", "fp16", "bf16", "int8", "int4", "w4a16", "w8a16" }) |signature| {
        if (std.ascii.findIgnoreCase(name, signature) != null) return signature;
    }
    return null;
}

fn expandPath(allocator: std.mem.Allocator, cwd: []const u8, home: []const u8, value: []const u8) ![]u8 {
    if (std.mem.startsWith(u8, value, "~")) {
        const expanded = try std.mem.concat(allocator, u8, &.{ home, value[1..] });
        defer allocator.free(expanded);
        return std.fs.path.resolve(allocator, &.{ cwd, expanded });
    }
    return std.fs.path.resolve(allocator, &.{ cwd, value });
}

fn pathExists(io: std.Io, path: []const u8) bool {
    _ = std.Io.Dir.cwd().statFile(io, path, .{}) catch return false;
    return true;
}

fn lessRoot(_: void, left: Root, right: Root) bool {
    return std.mem.order(u8, left.path, right.path) == .lt;
}

fn lessModelPath(_: void, left: []u8, right: []u8) bool {
    const left_name = std.fs.path.basename(left);
    const right_name = std.fs.path.basename(right);
    const order = std.ascii.orderIgnoreCase(left_name, right_name);
    return if (order == .eq) std.mem.order(u8, left, right) == .lt else order == .lt;
}

fn lessString(_: void, left: []const u8, right: []const u8) bool {
    return std.mem.order(u8, left, right) == .lt;
}
