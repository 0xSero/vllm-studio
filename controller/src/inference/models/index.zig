const std = @import("std");
const contract = @import("model_index_contract");

pub const Cache = struct {
    allocator: std.mem.Allocator,
    io: std.Io,
    mutex: std.Io.Mutex = .init,
    modified_nanoseconds: ?i128 = null,
    document: ?[]u8 = null,

    pub fn init(allocator: std.mem.Allocator, io: std.Io) Cache {
        return .{ .allocator = allocator, .io = io };
    }

    pub fn deinit(cache: *Cache) void {
        if (cache.document) |document| cache.allocator.free(document);
        cache.* = undefined;
    }

    pub fn payload(cache: *Cache, allocator: std.mem.Allocator, data_dir: []const u8) ![]u8 {
        const override_path = try path(allocator, data_dir);
        defer allocator.free(override_path);
        const stat = std.Io.Dir.cwd().statFile(cache.io, override_path, .{}) catch |failure| switch (failure) {
            error.FileNotFound => return allocator.dupe(u8, contract.document),
            else => return error.ModelIndexReadFailed,
        };
        try cache.mutex.lock(cache.io);
        defer cache.mutex.unlock(cache.io);
        if (cache.modified_nanoseconds != null and cache.modified_nanoseconds.? == stat.mtime.nanoseconds) {
            if (cache.document) |document| return allocator.dupe(u8, document);
        }
        const document = std.Io.Dir.cwd().readFileAlloc(cache.io, override_path, cache.allocator, .limited(4 * 1024 * 1024)) catch return error.ModelIndexReadFailed;
        errdefer cache.allocator.free(document);
        var parsed = std.json.parseFromSlice(std.json.Value, cache.allocator, document, .{}) catch return error.ModelIndexInvalidJson;
        defer parsed.deinit();
        if (!validIndex(parsed.value)) return error.ModelIndexInvalidSchema;
        if (cache.document) |previous| cache.allocator.free(previous);
        cache.document = document;
        cache.modified_nanoseconds = stat.mtime.nanoseconds;
        return allocator.dupe(u8, document);
    }
};

pub fn path(allocator: std.mem.Allocator, data_dir: []const u8) ![]u8 {
    return std.fs.path.join(allocator, &.{ data_dir, "model-index.json" });
}

fn validIndex(value: std.json.Value) bool {
    if (value != .object) return false;
    if (!number(value.object.get("version")) or !string(value.object.get("updated"))) return false;
    if (value.object.get("intelligence_source")) |source| if (source != .string) return false;
    const tiers = value.object.get("tiers") orelse return false;
    if (tiers != .array) return false;
    for (tiers.array.items) |tier| if (!validTier(tier)) return false;
    return true;
}

fn validTier(value: std.json.Value) bool {
    if (value != .object) return false;
    if (!string(value.object.get("id")) or !string(value.object.get("label")) or !string(value.object.get("blurb"))) return false;
    const models = value.object.get("models") orelse return false;
    if (models != .array) return false;
    for (models.array.items) |model| if (!validModel(model)) return false;
    return true;
}

fn validModel(value: std.json.Value) bool {
    if (value != .object) return false;
    for ([_][]const u8{ "id", "name", "description", "params", "license" }) |field| if (!string(value.object.get(field))) return false;
    if (!nullableLiteral(value.object.get("role"), &.{ "fast", "smart" })) return false;
    if (!nullableNumber(value.object.get("active_params_b")) or !number(value.object.get("context_tokens")) or !boolean(value.object.get("multimodal"))) return false;
    for ([_][]const u8{"architecture"}) |field| if (value.object.get(field)) |entry| if (!nullableString(entry)) return false;
    for ([_][]const u8{ "total_params_b", "intelligence_index", "agentic_index" }) |field| if (value.object.get(field)) |entry| if (!nullableNumeric(entry)) return false;
    const notes = value.object.get("notes") orelse return false;
    if (notes != .array) return false;
    for (notes.array.items) |note| if (note != .string) return false;
    const variants = value.object.get("variants") orelse return false;
    if (variants != .array) return false;
    for (variants.array.items) |variant| if (!validVariant(variant)) return false;
    return true;
}

fn validVariant(value: std.json.Value) bool {
    if (value != .object) return false;
    if (!literal(value.object.get("format"), &.{ "bf16", "fp8", "nvfp4", "q4" })) return false;
    if (!string(value.object.get("repo")) or !boolean(value.object.get("official"))) return false;
    if (value.object.get("source")) |source| if (source != .string) return false;
    if (!nullableNumber(value.object.get("size_gb")) or !nullableStringValue(value.object.get("caveat"))) return false;
    if (value.object.get("allow_patterns")) |patterns| {
        if (patterns != .array) return false;
        for (patterns.array.items) |pattern| if (pattern != .string) return false;
    }
    return true;
}

fn string(value: ?std.json.Value) bool {
    return if (value) |entry| entry == .string else false;
}

fn boolean(value: ?std.json.Value) bool {
    return if (value) |entry| entry == .bool else false;
}

fn number(value: ?std.json.Value) bool {
    return if (value) |entry| entry == .integer or entry == .float else false;
}

fn nullableString(value: std.json.Value) bool {
    return value == .null or value == .string;
}

fn nullableStringValue(value: ?std.json.Value) bool {
    return if (value) |entry| nullableString(entry) else false;
}

fn nullableNumeric(value: std.json.Value) bool {
    return value == .null or value == .integer or value == .float;
}

fn nullableNumber(value: ?std.json.Value) bool {
    return if (value) |entry| nullableNumeric(entry) else false;
}

fn literal(value: ?std.json.Value, candidates: []const []const u8) bool {
    const entry = value orelse return false;
    if (entry != .string) return false;
    for (candidates) |candidate| if (std.mem.eql(u8, entry.string, candidate)) return true;
    return false;
}

fn nullableLiteral(value: ?std.json.Value, candidates: []const []const u8) bool {
    const entry = value orelse return false;
    return entry == .null or literal(entry, candidates);
}
