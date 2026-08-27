const std = @import("std");

const known_keys = [_][]const u8{
    "id", "name", "model_path", "vision", "backend", "engine", "runtime", "env_vars", "env-vars", "envVars", "tensor_parallel_size", "pipeline_parallel_size", "max_model_len", "gpu_memory_utilization", "kv_cache_dtype", "max_num_seqs", "trust_remote_code", "tool_call_parser", "reasoning_parser", "enable_auto_tool_choice", "quantization", "dtype", "host", "port", "served_model_name", "python_path", "extra_args", "max_thinking_tokens", "thinking_mode", "tp", "pp",
};

pub fn normalize(allocator: std.mem.Allocator, document: []const u8, default_trust_remote_code: bool) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidRecipe;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidRecipe;
    const arena = parsed.arena.allocator();
    const input = parsed.value.object;
    const id = requiredString(input, "id", true) orelse return error.InvalidRecipe;
    const name = requiredString(input, "name", false) orelse return error.InvalidRecipe;
    const model_path = requiredString(input, "model_path", false) orelse return error.InvalidRecipe;

    var extra: std.json.ObjectMap = .empty;
    if (input.get("extra_args")) |value| {
        if (value != .null) {
            if (value != .object) return error.InvalidRecipe;
            var iterator = value.object.iterator();
            while (iterator.next()) |entry| try extra.put(arena, entry.key_ptr.*, entry.value_ptr.*);
        }
    }
    _ = extra.swapRemove("status");
    _ = extra.swapRemove("crash_loop");

    const vision = try visionValue(input.get("vision"), extra.get("vision"));
    _ = extra.swapRemove("vision");
    const backend = try backendValue(input);
    const runtime = try runtimeValue(arena, input, &extra, backend);
    _ = extra.swapRemove("docker_image");
    _ = extra.swapRemove("docker-image");
    const env_vars = try environmentValue(arena, input, &extra);
    _ = extra.swapRemove("env_vars");
    _ = extra.swapRemove("env-vars");
    _ = extra.swapRemove("envVars");

    var iterator = input.iterator();
    while (iterator.next()) |entry| {
        if (std.mem.eql(u8, entry.key_ptr.*, "status") or std.mem.eql(u8, entry.key_ptr.*, "crash_loop") or knownKey(entry.key_ptr.*)) continue;
        try extra.put(arena, entry.key_ptr.*, entry.value_ptr.*);
    }

    const tensor_parallel_size = positiveInteger(input.get("tensor_parallel_size") orelse input.get("tp"), 1, std.math.maxInt(i64));
    const pipeline_parallel_size = positiveInteger(input.get("pipeline_parallel_size") orelse input.get("pp"), 1, std.math.maxInt(i64));
    const max_model_len = positiveInteger(input.get("max_model_len"), 32768, std.math.maxInt(i64));
    const gpu_memory_utilization = fraction(input.get("gpu_memory_utilization"), 0.9);
    const max_num_seqs = positiveInteger(input.get("max_num_seqs"), 256, std.math.maxInt(i64));
    const port = positiveInteger(input.get("port"), 8000, 65535);
    const trust_remote_code = try optionalBoolean(input.get("trust_remote_code"), default_trust_remote_code);
    const enable_auto_tool_choice = try optionalBoolean(input.get("enable_auto_tool_choice"), false);
    const max_thinking_tokens = try nullableInteger(input.get("max_thinking_tokens"));

    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeByte('{');
    try writeField(&output.writer, "id", .{ .string = id }, false);
    try writeField(&output.writer, "name", .{ .string = name }, true);
    try writeField(&output.writer, "model_path", .{ .string = model_path }, true);
    try writeField(&output.writer, "vision", vision, true);
    try writeField(&output.writer, "backend", .{ .string = backend }, true);
    try writeField(&output.writer, "runtime", runtime, true);
    try writeField(&output.writer, "env_vars", env_vars, true);
    try writeField(&output.writer, "tensor_parallel_size", .{ .integer = tensor_parallel_size }, true);
    try writeField(&output.writer, "pipeline_parallel_size", .{ .integer = pipeline_parallel_size }, true);
    try writeField(&output.writer, "max_model_len", .{ .integer = max_model_len }, true);
    try writeField(&output.writer, "gpu_memory_utilization", .{ .float = gpu_memory_utilization }, true);
    try writeField(&output.writer, "kv_cache_dtype", try stringOrDefault(input.get("kv_cache_dtype"), "auto"), true);
    try writeField(&output.writer, "max_num_seqs", .{ .integer = max_num_seqs }, true);
    try writeField(&output.writer, "trust_remote_code", .{ .bool = trust_remote_code }, true);
    try writeField(&output.writer, "tool_call_parser", try nullableString(input.get("tool_call_parser")), true);
    try writeField(&output.writer, "reasoning_parser", try nullableString(input.get("reasoning_parser")), true);
    try writeField(&output.writer, "enable_auto_tool_choice", .{ .bool = enable_auto_tool_choice }, true);
    try writeField(&output.writer, "quantization", try nullableString(input.get("quantization")), true);
    try writeField(&output.writer, "dtype", try nullableString(input.get("dtype")), true);
    try writeField(&output.writer, "host", try stringOrDefault(input.get("host"), "0.0.0.0"), true);
    try writeField(&output.writer, "port", .{ .integer = port }, true);
    try writeField(&output.writer, "served_model_name", try nullableString(input.get("served_model_name")), true);
    try writeField(&output.writer, "python_path", try nullableString(input.get("python_path")), true);
    try writeField(&output.writer, "extra_args", .{ .object = extra }, true);
    try writeField(&output.writer, "max_thinking_tokens", if (max_thinking_tokens) |value| .{ .integer = value } else .null, true);
    try writeField(&output.writer, "thinking_mode", try stringOrDefault(input.get("thinking_mode"), "conservative"), true);
    if (input.get("tp")) |value| try writeField(&output.writer, "tp", value, true);
    if (input.get("pp")) |value| try writeField(&output.writer, "pp", value, true);
    try output.writer.writeByte('}');
    return try output.toOwnedSlice();
}

fn writeField(writer: *std.Io.Writer, name: []const u8, value: std.json.Value, comma: bool) !void {
    if (comma) try writer.writeByte(',');
    try std.json.Stringify.value(name, .{}, writer);
    try writer.writeByte(':');
    try std.json.Stringify.value(value, .{}, writer);
}

fn requiredString(object: std.json.ObjectMap, name: []const u8, nonempty: bool) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string or (nonempty and value.string.len == 0)) return null;
    return value.string;
}

fn backendValue(input: std.json.ObjectMap) ![]const u8 {
    const value = input.get("backend") orelse input.get("engine") orelse return "vllm";
    if (value == .null) return "vllm";
    if (value != .string) return error.InvalidRecipe;
    for ([_][]const u8{ "vllm", "sglang", "llamacpp", "mlx" }) |backend| if (std.mem.eql(u8, value.string, backend)) return backend;
    return error.InvalidRecipe;
}

fn runtimeValue(allocator: std.mem.Allocator, input: std.json.ObjectMap, extra: *std.json.ObjectMap, backend: []const u8) !std.json.Value {
    if (input.get("runtime")) |value| {
        if (value == .object) {
            const kind_value = value.object.get("kind") orelse return error.InvalidRecipe;
            const ref_value = value.object.get("ref") orelse return error.InvalidRecipe;
            if (kind_value != .string or ref_value != .string or ref_value.string.len == 0) return error.InvalidRecipe;
            const kind = if (std.mem.eql(u8, kind_value.string, "venv")) "managed_venv" else kind_value.string;
            if (!runtimeKind(kind)) return error.InvalidRecipe;
            if (value.object.get("label")) |label| if (label != .string) return error.InvalidRecipe;
            var runtime: std.json.ObjectMap = .empty;
            try runtime.put(allocator, "kind", .{ .string = kind });
            try runtime.put(allocator, "ref", ref_value);
            if (value.object.get("label")) |label| try runtime.put(allocator, "label", label);
            return .{ .object = runtime };
        }
    }
    const docker_image = nonemptyString(extra.get("docker_image")) orelse nonemptyString(extra.get("docker-image"));
    const python_path = nonemptyString(input.get("python_path"));
    var runtime: std.json.ObjectMap = .empty;
    if (docker_image) |reference| {
        try runtime.put(allocator, "kind", .{ .string = "docker" });
        try runtime.put(allocator, "ref", .{ .string = reference });
    } else if (python_path) |reference| {
        try runtime.put(allocator, "kind", .{ .string = "system" });
        try runtime.put(allocator, "ref", .{ .string = reference });
    } else if (std.mem.eql(u8, backend, "llamacpp")) {
        try runtime.put(allocator, "kind", .{ .string = "binary" });
        try runtime.put(allocator, "ref", .{ .string = "llama-server" });
    } else {
        try runtime.put(allocator, "kind", .{ .string = "managed_venv" });
        try runtime.put(allocator, "ref", .{ .string = backend });
    }
    return .{ .object = runtime };
}

fn environmentValue(allocator: std.mem.Allocator, input: std.json.ObjectMap, extra: *std.json.ObjectMap) !std.json.Value {
    const value = input.get("env_vars") orelse input.get("env-vars") orelse input.get("envVars") orelse extra.get("env_vars") orelse extra.get("env-vars") orelse extra.get("envVars") orelse return .null;
    if (value == .null) return .null;
    if (value != .object) return error.InvalidRecipe;
    var environment: std.json.ObjectMap = .empty;
    var iterator = value.object.iterator();
    while (iterator.next()) |entry| {
        if (entry.value_ptr.* != .string) return error.InvalidRecipe;
        try environment.put(allocator, entry.key_ptr.*, entry.value_ptr.*);
    }
    return .{ .object = environment };
}

fn visionValue(primary: ?std.json.Value, legacy: ?std.json.Value) !std.json.Value {
    const value = primary orelse legacy orelse return .null;
    return switch (value) {
        .null => .null,
        .bool => |result| .{ .bool = result },
        else => error.InvalidRecipe,
    };
}

fn stringOrDefault(value: ?std.json.Value, fallback: []const u8) !std.json.Value {
    const present = value orelse return .{ .string = fallback };
    if (present == .null) return .{ .string = fallback };
    if (present != .string) return error.InvalidRecipe;
    return present;
}

fn nullableString(value: ?std.json.Value) !std.json.Value {
    const present = value orelse return .null;
    if (present != .null and present != .string) return error.InvalidRecipe;
    return present;
}

fn optionalBoolean(value: ?std.json.Value, fallback: bool) !bool {
    const present = value orelse return fallback;
    if (present != .bool) return error.InvalidRecipe;
    return present.bool;
}

fn positiveInteger(value: ?std.json.Value, fallback: i64, maximum: i64) i64 {
    const number = numeric(value orelse return fallback) orelse return fallback;
    if (!std.math.isFinite(number) or number < 1) return fallback;
    return @intFromFloat(@min(@floor(number), @as(f64, @floatFromInt(maximum))));
}

fn fraction(value: ?std.json.Value, fallback: f64) f64 {
    const number = numeric(value orelse return fallback) orelse return fallback;
    if (!std.math.isFinite(number)) return fallback;
    return @min(1, @max(0.01, number));
}

fn nullableInteger(value: ?std.json.Value) !?i64 {
    const present = value orelse return null;
    if (present == .null) return null;
    const number = numeric(present) orelse return error.InvalidRecipe;
    if (!std.math.isFinite(number) or @floor(number) != number or number < @as(f64, @floatFromInt(std.math.minInt(i64))) or number > @as(f64, @floatFromInt(std.math.maxInt(i64)))) return error.InvalidRecipe;
    return @intFromFloat(number);
}

fn numeric(value: std.json.Value) ?f64 {
    return switch (value) {
        .integer => |number| @floatFromInt(number),
        .float => |number| number,
        .number_string => |number| std.fmt.parseFloat(f64, number) catch null,
        .string => |number| std.fmt.parseFloat(f64, std.mem.trim(u8, number, " \t\r\n")) catch null,
        .bool => |result| if (result) 1 else 0,
        .null => 0,
        else => null,
    };
}

fn nonemptyString(value: ?std.json.Value) ?[]const u8 {
    const present = value orelse return null;
    if (present != .string) return null;
    const trimmed = std.mem.trim(u8, present.string, " \t\r\n");
    return if (trimmed.len == 0) null else trimmed;
}

fn knownKey(key: []const u8) bool {
    for (known_keys) |known| if (std.mem.eql(u8, key, known)) return true;
    return false;
}

fn runtimeKind(value: []const u8) bool {
    for ([_][]const u8{ "managed_venv", "system", "docker", "binary" }) |kind| if (std.mem.eql(u8, value, kind)) return true;
    return false;
}
