const std = @import("std");
const storage = @import("../../system/storage.zig");
const system_info = @import("../../system/platform/system_info.zig");
const telemetry = @import("../../system/telemetry.zig");

const max_config_bytes = 1024 * 1024;

pub fn payload(allocator: std.mem.Allocator, io: std.Io, system: *const system_info.Snapshot, models_dir: []const u8, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidPayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidPayload;
    const object = parsed.value.object;
    const model_value = object.get("model") orelse return error.InvalidPayload;
    if (model_value != .string) return error.InvalidPayload;
    const model = std.mem.trim(u8, model_value.string, " \t\r\n");
    if (model.len == 0) return error.ModelRequired;
    const context_length = inputPositiveNumber(object.get("context_length")) orelse return error.InvalidPayload;
    const tp_size = if (object.get("tp_size")) |value| positiveInteger(value) orelse return error.InvalidPayload else 1;
    const kv_dtype = if (object.get("kv_dtype")) |value| optionalString(value) orelse return error.InvalidPayload else "auto";

    const cwd = try std.Io.Dir.cwd().realPathFileAlloc(io, ".", allocator);
    defer allocator.free(cwd);
    const resolved = try std.fs.path.resolve(allocator, &.{ cwd, model });
    defer allocator.free(resolved);
    const root = try std.fs.path.resolve(allocator, &.{ cwd, models_dir });
    defer allocator.free(root);
    if (!withinRoot(root, resolved)) return error.ModelOutsideRoot;

    const stat = std.Io.Dir.cwd().statFile(io, resolved, .{}) catch |failure| switch (failure) {
        error.FileNotFound => return error.ModelNotFound,
        else => return failure,
    };
    const weights_bytes = switch (stat.kind) {
        .file => if (isWeightFile(resolved)) stat.size else 0,
        .directory => storage.weightBytes(io, resolved),
        else => 0,
    };
    if (weights_bytes == 0) return error.WeightsNotFound;

    var dimensions = Dimensions{};
    if (stat.kind == .directory) {
        const config_path = try std.fs.path.join(allocator, &.{ resolved, "config.json" });
        defer allocator.free(config_path);
        if (std.Io.Dir.cwd().readFileAlloc(io, config_path, allocator, .limited(max_config_bytes))) |config_document| {
            defer allocator.free(config_document);
            dimensions = parseDimensions(allocator, config_document);
        } else |_| {}
    }

    const kv_bytes_per_value: f64 = if (std.ascii.eqlIgnoreCase(kv_dtype, "fp8")) 1 else 2;
    var kv_cache_bytes: f64 = 0;
    if (dimensions.layers != null and dimensions.kv_heads != null and dimensions.head_dim != null) {
        kv_cache_bytes = context_length * dimensions.layers.? * dimensions.kv_heads.? * dimensions.head_dim.? * 2 * kv_bytes_per_value;
    }
    const gibibyte: f64 = 1024 * 1024 * 1024;
    const weights_total_gb = @as(f64, @floatFromInt(weights_bytes)) / gibibyte;
    const tp: f64 = @floatFromInt(tp_size);
    const weights_per_gpu_gb = weights_total_gb / tp;
    const kv_cache_per_gpu_gb = kv_cache_bytes / gibibyte / tp;
    const activations_per_gpu_gb = @max(0.5, weights_per_gpu_gb * 0.1);
    const overhead_per_gpu_gb: f64 = 2;
    const per_gpu_gb = weights_per_gpu_gb + kv_cache_per_gpu_gb + activations_per_gpu_gb + overhead_per_gpu_gb;
    const total_gb = per_gpu_gb * tp;
    const per_gpu_capacity_gb = try gpuCapacity(allocator, io, system, tp_size);
    const fits = per_gpu_capacity_gb == 0 or per_gpu_gb <= per_gpu_capacity_gb;
    const utilization = if (per_gpu_capacity_gb > 0) per_gpu_gb / per_gpu_capacity_gb * 100 else 0;

    const Breakdown = struct {
        model_weights_gb: f64,
        kv_cache_gb: f64,
        activations_gb: f64,
        per_gpu_gb: f64,
        total_gb: f64,
    };
    const Payload = struct {
        model_size_gb: f64,
        context_memory_gb: f64,
        overhead_gb: f64,
        total_gb: f64,
        fits_in_vram: bool,
        fits: bool,
        utilization_percent: f64,
        breakdown: Breakdown,
    };
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(Payload{
        .model_size_gb = weights_total_gb,
        .context_memory_gb = kv_cache_per_gpu_gb * tp,
        .overhead_gb = overhead_per_gpu_gb,
        .total_gb = total_gb,
        .fits_in_vram = fits,
        .fits = fits,
        .utilization_percent = utilization,
        .breakdown = .{
            .model_weights_gb = weights_per_gpu_gb,
            .kv_cache_gb = kv_cache_per_gpu_gb,
            .activations_gb = activations_per_gpu_gb,
            .per_gpu_gb = per_gpu_gb,
            .total_gb = total_gb,
        },
    }, .{}, &output.writer);
    return output.toOwnedSlice();
}

const Dimensions = struct {
    layers: ?f64 = null,
    kv_heads: ?f64 = null,
    head_dim: ?f64 = null,
};

fn parseDimensions(allocator: std.mem.Allocator, document: []const u8) Dimensions {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return .{};
    defer parsed.deinit();
    if (parsed.value != .object) return .{};
    const object = parsed.value.object;
    const layers = firstDimension(object, &.{ "num_hidden_layers", "n_layer", "num_layers" });
    const hidden_size = firstDimension(object, &.{ "hidden_size", "n_embd", "d_model", "dim" });
    const heads = firstDimension(object, &.{ "num_attention_heads", "n_head", "num_heads" });
    const kv_heads = firstDimension(object, &.{ "num_key_value_heads", "num_kv_heads" }) orelse heads;
    const head_dim = firstDimension(object, &.{"head_dim"}) orelse if (hidden_size != null and heads != null) hidden_size.? / heads.? else null;
    return .{ .layers = layers, .kv_heads = kv_heads, .head_dim = head_dim };
}

fn firstDimension(object: std.json.ObjectMap, names: []const []const u8) ?f64 {
    for (names) |name| if (positiveNumber(object.get(name))) |value| return value;
    return null;
}

fn positiveNumber(value: ?std.json.Value) ?f64 {
    const present = value orelse return null;
    const number: f64 = switch (present) {
        .integer => |result| @floatFromInt(result),
        .float => |result| result,
        .number_string => |result| std.fmt.parseFloat(f64, result) catch return null,
        .string => |result| std.fmt.parseFloat(f64, result) catch return null,
        else => return null,
    };
    return if (std.math.isFinite(number) and number > 0) number else null;
}

fn positiveInteger(present: std.json.Value) ?usize {
    const number: f64 = switch (present) {
        .integer => |result| @floatFromInt(result),
        .float => |result| result,
        .number_string => |result| std.fmt.parseFloat(f64, result) catch return null,
        else => return null,
    };
    if (!std.math.isFinite(number) or number <= 0 or @floor(number) != number or number > @as(f64, @floatFromInt(std.math.maxInt(usize)))) return null;
    return @intFromFloat(number);
}

fn inputPositiveNumber(value: ?std.json.Value) ?f64 {
    const present = value orelse return null;
    const number: f64 = switch (present) {
        .integer => |result| @floatFromInt(result),
        .float => |result| result,
        .number_string => |result| std.fmt.parseFloat(f64, result) catch return null,
        else => return null,
    };
    return if (std.math.isFinite(number) and number > 0) number else null;
}

fn optionalString(present: std.json.Value) ?[]const u8 {
    return if (present == .string) present.string else null;
}

fn withinRoot(root: []const u8, path: []const u8) bool {
    if (std.mem.eql(u8, root, path)) return true;
    if (!std.mem.startsWith(u8, path, root) or path.len <= root.len) return false;
    return path[root.len] == std.fs.path.sep;
}

fn isWeightFile(path: []const u8) bool {
    return endsWithIgnoreCase(path, ".safetensors") or endsWithIgnoreCase(path, ".bin") or endsWithIgnoreCase(path, ".gguf");
}

fn endsWithIgnoreCase(value: []const u8, suffix: []const u8) bool {
    if (value.len < suffix.len) return false;
    return std.ascii.eqlIgnoreCase(value[value.len - suffix.len ..], suffix);
}

fn gpuCapacity(allocator: std.mem.Allocator, io: std.Io, system: *const system_info.Snapshot, count: usize) !f64 {
    const document = try telemetry.gpuPayload(allocator, io, system);
    defer allocator.free(document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return 0;
    defer parsed.deinit();
    if (parsed.value != .object) return 0;
    const gpus = parsed.value.object.get("gpus") orelse return 0;
    if (gpus != .array or gpus.array.items.len < count) return 0;
    var minimum: f64 = std.math.inf(f64);
    for (gpus.array.items[0..count]) |gpu| {
        if (gpu != .object) return 0;
        const memory = positiveNumber(gpu.object.get("memory_total_mb")) orelse return 0;
        minimum = @min(minimum, memory / 1024);
    }
    return if (std.math.isFinite(minimum)) minimum else 0;
}
