const std = @import("std");
const config_module = @import("../../app/config.zig");
const launch_plan = @import("../runtime/launch_plan.zig");

const max_field_bytes = 16 * 1024;
const max_extra_args = 4096;
const max_environment_entries = 1024;

pub const Request = struct {
    arena: std.heap.ArenaAllocator,
    name: []const u8,
    engine: []const u8,
    model_path: []const u8,
    recipe_id: []const u8,
    runtime: []const u8,
    device_count: usize,
    served_model_name: []const u8,
    options: ?std.json.ObjectMap,
    extra_args: []const std.json.Value,
    environment: std.json.ObjectMap,
    docker_image: ?[]const u8,
    binary: ?[]const u8,

    pub fn deinit(request: *Request) void {
        request.arena.deinit();
        request.* = undefined;
    }
};

pub const DockerPlan = struct {
    base: launch_plan.Plan,
    image: []const u8,
    model_path: []const u8,
};

pub const Plan = union(enum) {
    process: launch_plan.Plan,
    docker: DockerPlan,

    pub fn deinit(plan: *Plan) void {
        switch (plan.*) {
            .process => |*value| value.deinit(),
            .docker => |*value| value.base.deinit(),
        }
        plan.* = undefined;
    }

    pub fn environment(plan: *const Plan) []const launch_plan.EnvironmentEntry {
        return switch (plan.*) {
            .process => |value| value.environment,
            .docker => |value| value.base.environment,
        };
    }
};

pub fn parse(allocator: std.mem.Allocator, document: []const u8) !Request {
    var arena = std.heap.ArenaAllocator.init(allocator);
    errdefer arena.deinit();
    const storage = try arena.allocator().dupe(u8, document);
    const value = std.json.parseFromSliceLeaky(std.json.Value, arena.allocator(), storage, .{}) catch return error.InvalidLaunchRequest;
    if (value != .object) return error.InvalidLaunchRequest;
    const object = value.object;
    const name = try requiredString(object, "name");
    const engine = try requiredString(object, "engine");
    if (!validEngine(engine)) return error.InvalidLaunchRequest;
    const model_path = try requiredString(object, "modelPath");
    const recipe_id = try optionalString(object, "recipeId") orelse name;
    const runtime = try optionalString(object, "runtime") orelse "process";
    if (!std.mem.eql(u8, runtime, "process") and !std.mem.eql(u8, runtime, "docker")) return error.InvalidLaunchRequest;
    const served_name = try optionalString(object, "servedModelName") orelse name;
    const device_count = try optionalCount(object, "deviceCount") orelse 1;
    const options = if (object.get("options")) |options_value| options: {
        if (options_value != .object) return error.InvalidLaunchRequest;
        try validateOptions(options_value.object);
        break :options options_value.object;
    } else null;
    const extra_args = if (object.get("extraArgs")) |extra_value| extra: {
        if (extra_value != .array or extra_value.array.items.len > max_extra_args) return error.InvalidLaunchRequest;
        for (extra_value.array.items) |argument| if (argument != .string or argument.string.len > max_field_bytes) return error.InvalidLaunchRequest;
        break :extra extra_value.array.items;
    } else &.{};
    if (std.mem.eql(u8, engine, "vllm") or std.mem.eql(u8, engine, "sglang")) for (extra_args) |argument| if (forbiddenArgument(argument.string)) return error.ForbiddenEngineArgument;
    const environment = if (object.get("env")) |environment_value| environment: {
        if (environment_value != .object or environment_value.object.count() > max_environment_entries) return error.InvalidLaunchRequest;
        var iterator = environment_value.object.iterator();
        while (iterator.next()) |entry| if (!validEnvironmentKey(entry.key_ptr.*) or entry.value_ptr.* != .string or entry.value_ptr.string.len > max_field_bytes) return error.InvalidLaunchRequest;
        break :environment environment_value.object;
    } else std.json.ObjectMap.empty;
    const docker_image = try optionalString(object, "dockerImage");
    const binary = try optionalString(object, "binary");
    return .{
        .arena = arena,
        .name = name,
        .engine = engine,
        .model_path = model_path,
        .recipe_id = recipe_id,
        .runtime = runtime,
        .device_count = device_count,
        .served_model_name = served_name,
        .options = options,
        .extra_args = extra_args,
        .environment = environment,
        .docker_image = docker_image,
        .binary = binary,
    };
}

pub fn build(allocator: std.mem.Allocator, io: std.Io, request: *const Request, configuration: *const config_module.Config, accelerator: []const u8, port: u16) !Plan {
    var document: std.Io.Writer.Allocating = .init(allocator);
    defer document.deinit();
    try document.writer.writeAll("{\"id\":");
    try std.json.Stringify.value(request.recipe_id, .{}, &document.writer);
    try document.writer.writeAll(",\"backend\":");
    try std.json.Stringify.value(request.engine, .{}, &document.writer);
    try document.writer.writeAll(",\"model_path\":");
    try std.json.Stringify.value(if (std.mem.eql(u8, request.runtime, "docker")) "/models" else request.model_path, .{}, &document.writer);
    try document.writer.writeAll(",\"served_model_name\":");
    try std.json.Stringify.value(request.served_model_name, .{}, &document.writer);
    try document.writer.print(",\"port\":{d},\"runtime\":{{\"kind\":", .{port});
    try std.json.Stringify.value(if (request.binary != null) "binary" else "managed_venv", .{}, &document.writer);
    try document.writer.writeAll(",\"ref\":");
    try std.json.Stringify.value(request.binary orelse defaultBinary(request.engine), .{}, &document.writer);
    try document.writer.writeByte('}');
    try writeNumberOption(&document.writer, request.options, "tensorParallel", "tensor_parallel_size", 1);
    try writeNumberOption(&document.writer, request.options, "pipelineParallel", "pipeline_parallel_size", 1);
    try writeNumberOption(&document.writer, request.options, "maxContextLength", "max_model_len", 8192);
    try writeNumberOption(&document.writer, request.options, "memoryFraction", "gpu_memory_utilization", 0.9);
    try writeNumberOption(&document.writer, request.options, "maxConcurrentRequests", "max_num_seqs", 64);
    try writeStringOption(&document.writer, request.options, "kvCacheDtype", "kv_cache_dtype");
    try writeStringOption(&document.writer, request.options, "dtype", "dtype");
    try writeStringOption(&document.writer, request.options, "quantization", "quantization");
    try writeBooleanOption(&document.writer, request.options, "trustRemoteCode", "trust_remote_code", false);
    try writeStringOption(&document.writer, request.options, "toolCallParser", "tool_call_parser");
    try writeStringOption(&document.writer, request.options, "reasoningParser", "reasoning_parser");
    try document.writer.writeAll(",\"env_vars\":");
    try std.json.Stringify.value(std.json.Value{ .object = request.environment }, .{}, &document.writer);
    try document.writer.writeByte('}');
    var plan = try launch_plan.build(allocator, io, document.writer.buffered(), configuration);
    errdefer plan.deinit();
    const arguments = try allocator.alloc([]const u8, request.extra_args.len);
    defer allocator.free(arguments);
    for (request.extra_args, arguments) |argument, *target| target.* = argument.string;
    try launch_plan.mergeArguments(&plan, arguments);
    if (std.mem.eql(u8, request.runtime, "process")) return .{ .process = plan };
    const image = request.docker_image orelse defaultDockerImage(request.engine, accelerator) orelse return error.MissingDockerImage;
    try makeDockerArguments(&plan, request.engine);
    return .{ .docker = .{
        .base = plan,
        .image = try plan.arena.allocator().dupe(u8, image),
        .model_path = try plan.arena.allocator().dupe(u8, request.model_path),
    } };
}

pub fn basePort(engine: []const u8) u16 {
    if (std.mem.eql(u8, engine, "vllm")) return 8000;
    if (std.mem.eql(u8, engine, "sglang")) return 30_000;
    if (std.mem.eql(u8, engine, "llamacpp")) return 8081;
    if (std.mem.eql(u8, engine, "mlx")) return 8080;
    return 5000;
}

fn validateOptions(options: std.json.ObjectMap) !void {
    for ([_][]const u8{ "tensorParallel", "pipelineParallel", "maxContextLength", "memoryFraction", "maxConcurrentRequests" }) |name| if (options.get(name)) |value| if (!numberValue(value)) return error.InvalidLaunchRequest;
    for ([_][]const u8{ "kvCacheDtype", "dtype", "quantization", "toolCallParser", "reasoningParser" }) |name| if (options.get(name)) |value| if (value != .string or value.string.len > max_field_bytes) return error.InvalidLaunchRequest;
    if (options.get("trustRemoteCode")) |value| if (value != .bool) return error.InvalidLaunchRequest;
}

fn requiredString(object: std.json.ObjectMap, name: []const u8) ![]const u8 {
    const value = object.get(name) orelse return error.InvalidLaunchRequest;
    if (value != .string or value.string.len > max_field_bytes) return error.InvalidLaunchRequest;
    return value.string;
}

fn optionalString(object: std.json.ObjectMap, name: []const u8) !?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string or value.string.len > max_field_bytes) return error.InvalidLaunchRequest;
    return value.string;
}

fn optionalCount(object: std.json.ObjectMap, name: []const u8) !?usize {
    const value = object.get(name) orelse return null;
    const number = jsonNumber(value) orelse return error.InvalidLaunchRequest;
    if (!std.math.isFinite(number) or number < 0 or number > 256) return error.InvalidLaunchRequest;
    return @intFromFloat(@trunc(number));
}

fn writeNumberOption(writer: *std.Io.Writer, options: ?std.json.ObjectMap, source: []const u8, target: []const u8, default: anytype) !void {
    try writer.print(",\"{s}\":", .{target});
    if (options) |object| if (object.get(source)) |value| {
        try std.json.Stringify.value(value, .{}, writer);
        return;
    };
    try std.json.Stringify.value(default, .{}, writer);
}

fn writeStringOption(writer: *std.Io.Writer, options: ?std.json.ObjectMap, source: []const u8, target: []const u8) !void {
    if (options) |object| if (object.get(source)) |value| {
        try writer.print(",\"{s}\":", .{target});
        try std.json.Stringify.value(value, .{}, writer);
    };
}

fn writeBooleanOption(writer: *std.Io.Writer, options: ?std.json.ObjectMap, source: []const u8, target: []const u8, default: bool) !void {
    try writer.print(",\"{s}\":", .{target});
    if (options) |object| if (object.get(source)) |value| {
        try std.json.Stringify.value(value, .{}, writer);
        return;
    };
    try std.json.Stringify.value(default, .{}, writer);
}

fn numberValue(value: std.json.Value) bool {
    return if (jsonNumber(value)) |number| std.math.isFinite(number) else false;
}

fn jsonNumber(value: std.json.Value) ?f64 {
    return switch (value) {
        .integer => |number| @floatFromInt(number),
        .float => |number| number,
        .number_string => |number| std.fmt.parseFloat(f64, number) catch null,
        else => null,
    };
}

fn validEngine(value: []const u8) bool {
    return std.mem.eql(u8, value, "vllm") or std.mem.eql(u8, value, "sglang") or std.mem.eql(u8, value, "llamacpp") or std.mem.eql(u8, value, "mlx") or std.mem.eql(u8, value, "exllamav3");
}

fn defaultBinary(engine: []const u8) []const u8 {
    if (std.mem.eql(u8, engine, "vllm")) return "vllm";
    if (std.mem.eql(u8, engine, "sglang")) return "sglang";
    if (std.mem.eql(u8, engine, "llamacpp")) return "llama-server";
    if (std.mem.eql(u8, engine, "mlx")) return "mlx_lm.server";
    return "tabbyapi";
}

fn defaultDockerImage(engine: []const u8, accelerator: []const u8) ?[]const u8 {
    if (std.mem.eql(u8, engine, "vllm")) return if (std.mem.eql(u8, accelerator, "rocm")) "rocm/vllm:latest" else if (std.mem.eql(u8, accelerator, "cuda")) "vllm/vllm-openai:latest" else null;
    if (std.mem.eql(u8, engine, "sglang")) return if (std.mem.eql(u8, accelerator, "cuda")) "lmsysorg/sglang:latest" else null;
    if (std.mem.eql(u8, engine, "llamacpp")) return if (std.mem.eql(u8, accelerator, "cuda")) "ghcr.io/ggml-org/llama.cpp:server-cuda" else if (std.mem.eql(u8, accelerator, "rocm")) "ghcr.io/ggml-org/llama.cpp:server-rocm" else "ghcr.io/ggml-org/llama.cpp:server";
    return null;
}

fn makeDockerArguments(plan: *launch_plan.Plan, engine: []const u8) !void {
    var arguments: std.ArrayList([]const u8) = .empty;
    var index: usize = 1;
    if (std.mem.eql(u8, engine, "vllm") and index < plan.argv.len and std.mem.eql(u8, plan.argv[index], "serve")) index += 1;
    while (index < plan.argv.len) : (index += 1) {
        const argument = plan.argv[index];
        try arguments.append(plan.arena.allocator(), argument);
        if (std.mem.eql(u8, argument, "--host") and index + 1 < plan.argv.len) {
            index += 1;
            try arguments.append(plan.arena.allocator(), "0.0.0.0");
        }
    }
    plan.argv = try arguments.toOwnedSlice(plan.arena.allocator());
}

fn forbiddenArgument(value: []const u8) bool {
    if (!std.mem.startsWith(u8, value, "--")) return false;
    const end = std.mem.indexOfScalar(u8, value, '=') orelse value.len;
    const key = value[2..end];
    return compactKeyEquals(key, "disablecudagraphs") or compactKeyEquals(key, "enforceeager") or compactKeyEquals(key, "maxtokens");
}

fn compactKeyEquals(key: []const u8, expected: []const u8) bool {
    var index: usize = 0;
    for (key) |character| {
        if (character == '-' or character == '_' or std.ascii.isWhitespace(character)) continue;
        if (index >= expected.len or std.ascii.toLower(character) != expected[index]) return false;
        index += 1;
    }
    return index == expected.len;
}

fn validEnvironmentKey(key: []const u8) bool {
    if (key.len == 0 or key.len > max_field_bytes) return false;
    for (key) |character| if (character == 0 or character == '=') return false;
    return true;
}
