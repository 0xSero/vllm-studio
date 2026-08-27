const std = @import("std");
const builtin = @import("builtin");
const config_module = @import("../../app/config.zig");
const studio_settings = @import("../../system/settings/studio_store.zig");

pub const EnvironmentEntry = struct {
    key: []const u8,
    value: []const u8,
};

pub const Plan = struct {
    arena: std.heap.ArenaAllocator,
    recipe_id: []const u8,
    backend: []const u8,
    port: u16,
    argv: []const []const u8,
    environment: []const EnvironmentEntry,
    health_path: []const u8,
    ready_timeout_seconds: u64,

    pub fn deinit(plan: *Plan) void {
        plan.arena.deinit();
        plan.* = undefined;
    }
};

pub fn mergeArguments(plan: *Plan, extra: []const []const u8) !void {
    if (extra.len == 0) return;
    var overridden: std.StringHashMapUnmanaged(void) = .empty;
    for (extra) |argument| if (argumentKey(argument)) |key| try overridden.put(plan.arena.allocator(), key, {});
    var merged: std.ArrayList([]const u8) = .empty;
    var index: usize = 0;
    while (index < plan.argv.len) : (index += 1) {
        const argument = plan.argv[index];
        const key = argumentKey(argument);
        if (index > 0 and key != null and overridden.contains(key.?)) {
            if (std.mem.indexOfScalar(u8, argument, '=') == null and index + 1 < plan.argv.len and argumentKey(plan.argv[index + 1]) == null) index += 1;
            continue;
        }
        try merged.append(plan.arena.allocator(), argument);
    }
    for (extra) |argument| try merged.append(plan.arena.allocator(), try plan.arena.allocator().dupe(u8, argument));
    plan.argv = try merged.toOwnedSlice(plan.arena.allocator());
}

pub fn build(allocator: std.mem.Allocator, io: std.Io, document: []const u8, configuration: *const config_module.Config) !Plan {
    var arena = std.heap.ArenaAllocator.init(allocator);
    errdefer arena.deinit();
    const storage = try arena.allocator().dupe(u8, document);
    const value = std.json.parseFromSliceLeaky(std.json.Value, arena.allocator(), storage, .{}) catch return error.InvalidRecipe;
    if (value != .object) return error.InvalidRecipe;
    const object = value.object;
    const recipe_id = stringField(object, "id") orelse return error.InvalidRecipe;
    const backend = stringField(object, "backend") orelse return error.InvalidRecipe;
    const model_path = stringField(object, "model_path") orelse return error.InvalidRecipe;
    const served_name = nullableStringField(object, "served_model_name") orelse model_path;
    const port = portField(object, "port") orelse return error.InvalidRecipe;
    const runtime_value = object.get("runtime") orelse return error.InvalidRecipe;
    if (runtime_value != .object) return error.InvalidRecipe;
    const runtime_kind = stringField(runtime_value.object, "kind") orelse return error.InvalidRecipe;
    const runtime_ref = stringField(runtime_value.object, "ref") orelse return error.InvalidRecipe;
    if (std.mem.eql(u8, runtime_kind, "docker")) return error.DockerRuntimeNotImplemented;
    try validateHostSupport(backend);

    const binary = try resolveEngineBinary(arena.allocator(), io, object, backend, runtime_kind, runtime_ref, configuration);

    var extra: std.ArrayList([]const u8) = .empty;
    var overridden: std.StringHashMapUnmanaged(void) = .empty;
    if (object.get("extra_args")) |extra_value| {
        if (extra_value != .object) return error.InvalidRecipe;
        var iterator = extra_value.object.iterator();
        while (iterator.next()) |entry| {
            const key = try normalizedKey(arena.allocator(), entry.key_ptr.*);
            if (internalKey(key) or forbiddenKey(backend, key)) continue;
            switch (entry.value_ptr.*) {
                .null => {},
                .bool => |enabled| if (enabled) {
                    try extra.append(arena.allocator(), try flag(arena.allocator(), key));
                    try overridden.put(arena.allocator(), key, {});
                },
                .string => |text| {
                    try extra.append(arena.allocator(), try flag(arena.allocator(), key));
                    try extra.append(arena.allocator(), text);
                    try overridden.put(arena.allocator(), key, {});
                },
                .integer => |number| {
                    try extra.append(arena.allocator(), try flag(arena.allocator(), key));
                    try extra.append(arena.allocator(), try std.fmt.allocPrint(arena.allocator(), "{d}", .{number}));
                    try overridden.put(arena.allocator(), key, {});
                },
                .float => |number| {
                    try extra.append(arena.allocator(), try flag(arena.allocator(), key));
                    try extra.append(arena.allocator(), try std.fmt.allocPrint(arena.allocator(), "{d}", .{number}));
                    try overridden.put(arena.allocator(), key, {});
                },
                .number_string => |number| {
                    try extra.append(arena.allocator(), try flag(arena.allocator(), key));
                    try extra.append(arena.allocator(), number);
                    try overridden.put(arena.allocator(), key, {});
                },
                .array, .object => {
                    var output: std.Io.Writer.Allocating = .init(arena.allocator());
                    try std.json.Stringify.value(entry.value_ptr.*, .{}, &output.writer);
                    try extra.append(arena.allocator(), try flag(arena.allocator(), key));
                    try extra.append(arena.allocator(), try output.toOwnedSlice());
                    try overridden.put(arena.allocator(), key, {});
                },
            }
        }
    }

    var argv: std.ArrayList([]const u8) = .empty;
    try argv.append(arena.allocator(), binary);
    if (std.mem.eql(u8, backend, "vllm")) try argv.append(arena.allocator(), "serve");
    if (std.mem.eql(u8, backend, "sglang")) try argv.append(arena.allocator(), "serve");
    if (std.mem.eql(u8, backend, "vllm")) {
        try argv.append(arena.allocator(), model_path);
        try appendPair(&argv, arena.allocator(), &overridden, "served-model-name", served_name);
    } else if (std.mem.eql(u8, backend, "sglang")) {
        try appendPair(&argv, arena.allocator(), &overridden, "model-path", model_path);
        try appendPair(&argv, arena.allocator(), &overridden, "served-model-name", served_name);
    } else if (std.mem.eql(u8, backend, "llamacpp")) {
        try appendPair(&argv, arena.allocator(), &overridden, "model", model_path);
        try appendPair(&argv, arena.allocator(), &overridden, "alias", served_name);
    } else if (std.mem.eql(u8, backend, "mlx")) {
        try appendPair(&argv, arena.allocator(), &overridden, "model", model_path);
    } else if (std.mem.eql(u8, backend, "exllamav3")) {
        try appendPair(&argv, arena.allocator(), &overridden, "model-dir", model_path);
        try appendPair(&argv, arena.allocator(), &overridden, "model-name", served_name);
    } else return error.UnsupportedBackend;

    try appendPair(&argv, arena.allocator(), &overridden, "host", "127.0.0.1");
    try appendPair(&argv, arena.allocator(), &overridden, "port", try std.fmt.allocPrint(arena.allocator(), "{d}", .{port}));
    try appendTuning(&argv, arena.allocator(), &overridden, object, backend);
    if (std.mem.eql(u8, backend, "sglang")) try appendFlag(&argv, arena.allocator(), &overridden, "enable-metrics");
    if (std.mem.eql(u8, backend, "llamacpp")) try appendFlag(&argv, arena.allocator(), &overridden, "metrics");
    try argv.appendSlice(arena.allocator(), extra.items);

    var environment: std.ArrayList(EnvironmentEntry) = .empty;
    if (object.get("env_vars")) |env_value| {
        if (env_value != .null) {
            if (env_value != .object) return error.InvalidRecipe;
            var iterator = env_value.object.iterator();
            while (iterator.next()) |entry| {
                if (entry.value_ptr.* != .string) return error.InvalidRecipe;
                try environment.append(arena.allocator(), .{ .key = entry.key_ptr.*, .value = entry.value_ptr.string });
            }
        }
    }

    return .{
        .arena = arena,
        .recipe_id = recipe_id,
        .backend = backend,
        .port = port,
        .argv = try argv.toOwnedSlice(arena.allocator()),
        .environment = try environment.toOwnedSlice(arena.allocator()),
        .health_path = if (std.mem.eql(u8, backend, "mlx")) "/v1/models" else "/health",
        .ready_timeout_seconds = if (std.mem.eql(u8, backend, "vllm")) 1800 else if (std.mem.eql(u8, backend, "sglang") or std.mem.eql(u8, backend, "exllamav3")) 900 else if (std.mem.eql(u8, backend, "llamacpp")) 600 else 300,
    };
}

fn appendTuning(argv: *std.ArrayList([]const u8), allocator: std.mem.Allocator, overridden: *const std.StringHashMapUnmanaged(void), object: std.json.ObjectMap, backend: []const u8) !void {
    if (std.mem.eql(u8, backend, "vllm") or std.mem.eql(u8, backend, "sglang")) {
        try appendInteger(argv, allocator, overridden, if (std.mem.eql(u8, backend, "vllm")) "tensor-parallel-size" else "tensor-parallel-size", object.get("tensor_parallel_size"), true);
        try appendInteger(argv, allocator, overridden, "pipeline-parallel-size", object.get("pipeline_parallel_size"), true);
        try appendInteger(argv, allocator, overridden, if (std.mem.eql(u8, backend, "vllm")) "max-model-len" else "context-length", object.get("max_model_len"), false);
        try appendNumber(argv, allocator, overridden, if (std.mem.eql(u8, backend, "vllm")) "gpu-memory-utilization" else "mem-fraction-static", object.get("gpu_memory_utilization"));
        try appendInteger(argv, allocator, overridden, if (std.mem.eql(u8, backend, "vllm")) "max-num-seqs" else "max-running-requests", object.get("max_num_seqs"), false);
        try appendOptionalString(argv, allocator, overridden, "kv-cache-dtype", object.get("kv_cache_dtype"), true);
        try appendOptionalString(argv, allocator, overridden, "dtype", object.get("dtype"), false);
        try appendOptionalString(argv, allocator, overridden, "quantization", object.get("quantization"), false);
        if (booleanField(object, "trust_remote_code")) try appendFlag(argv, allocator, overridden, "trust-remote-code");
        if (object.get("tool_call_parser")) |value| if (value == .string) {
            try appendPair(argv, allocator, overridden, "tool-call-parser", value.string);
            if (std.mem.eql(u8, backend, "vllm")) try appendFlag(argv, allocator, overridden, "enable-auto-tool-choice");
        };
        try appendOptionalString(argv, allocator, overridden, "reasoning-parser", object.get("reasoning_parser"), false);
        return;
    }
    if (std.mem.eql(u8, backend, "llamacpp")) {
        try appendInteger(argv, allocator, overridden, "ctx-size", object.get("max_model_len"), false);
        try appendInteger(argv, allocator, overridden, "parallel", object.get("max_num_seqs"), false);
        return;
    }
    if (std.mem.eql(u8, backend, "mlx")) {
        try appendInteger(argv, allocator, overridden, "max-tokens", object.get("max_model_len"), false);
        if (booleanField(object, "trust_remote_code")) try appendFlag(argv, allocator, overridden, "trust-remote-code");
        return;
    }
    if (std.mem.eql(u8, backend, "exllamav3")) try appendInteger(argv, allocator, overridden, "max-seq-len", object.get("max_model_len"), false);
}

fn appendInteger(argv: *std.ArrayList([]const u8), allocator: std.mem.Allocator, overridden: *const std.StringHashMapUnmanaged(void), key: []const u8, value: ?std.json.Value, parallel: bool) !void {
    const present = value orelse return;
    if (present != .integer or present.integer <= 0 or (parallel and present.integer <= 1)) return;
    try appendPair(argv, allocator, overridden, key, try std.fmt.allocPrint(allocator, "{d}", .{present.integer}));
}

fn appendNumber(argv: *std.ArrayList([]const u8), allocator: std.mem.Allocator, overridden: *const std.StringHashMapUnmanaged(void), key: []const u8, value: ?std.json.Value) !void {
    const present = value orelse return;
    const text = switch (present) {
        .integer => |number| try std.fmt.allocPrint(allocator, "{d}", .{number}),
        .float => |number| try std.fmt.allocPrint(allocator, "{d}", .{number}),
        .number_string => |number| number,
        else => return,
    };
    try appendPair(argv, allocator, overridden, key, text);
}

fn appendOptionalString(argv: *std.ArrayList([]const u8), allocator: std.mem.Allocator, overridden: *const std.StringHashMapUnmanaged(void), key: []const u8, value: ?std.json.Value, skip_auto: bool) !void {
    const present = value orelse return;
    if (present != .string or present.string.len == 0 or (skip_auto and std.mem.eql(u8, present.string, "auto"))) return;
    try appendPair(argv, allocator, overridden, key, present.string);
}

fn appendPair(argv: *std.ArrayList([]const u8), allocator: std.mem.Allocator, overridden: *const std.StringHashMapUnmanaged(void), key: []const u8, value: []const u8) !void {
    if (overridden.contains(key)) return;
    try argv.append(allocator, try flag(allocator, key));
    try argv.append(allocator, value);
}

fn appendFlag(argv: *std.ArrayList([]const u8), allocator: std.mem.Allocator, overridden: *const std.StringHashMapUnmanaged(void), key: []const u8) !void {
    if (!overridden.contains(key)) try argv.append(allocator, try flag(allocator, key));
}

fn flag(allocator: std.mem.Allocator, key: []const u8) ![]const u8 {
    return try std.fmt.allocPrint(allocator, "--{s}", .{key});
}

fn normalizedKey(allocator: std.mem.Allocator, key: []const u8) ![]const u8 {
    const output = try allocator.alloc(u8, key.len);
    for (key, output) |character, *target| target.* = if (character == '_') '-' else std.ascii.toLower(character);
    return output;
}

fn argumentKey(argument: []const u8) ?[]const u8 {
    if (!std.mem.startsWith(u8, argument, "--") or argument.len <= 2) return null;
    const end = std.mem.indexOfScalar(u8, argument, '=') orelse argument.len;
    return argument[2..end];
}

fn internalKey(key: []const u8) bool {
    for ([_][]const u8{ "visible-devices", "cuda-visible-devices", "hip-visible-devices", "rocr-visible-devices", "venv-path", "env-vars", "description", "tags", "status", "metadata", "llama-bin", "mlx-python", "launch-command", "custom-command", "docker-container", "docker-image" }) |internal| {
        if (std.mem.eql(u8, key, internal)) return true;
    }
    return false;
}

fn forbiddenKey(backend: []const u8, key: []const u8) bool {
    if (!std.mem.eql(u8, backend, "vllm") and !std.mem.eql(u8, backend, "sglang")) return false;
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

fn defaultBinary(backend: []const u8) ?[]const u8 {
    if (std.mem.eql(u8, backend, "vllm")) return "vllm";
    if (std.mem.eql(u8, backend, "sglang")) return "sglang";
    if (std.mem.eql(u8, backend, "llamacpp")) return "llama-server";
    if (std.mem.eql(u8, backend, "mlx")) return "mlx_lm.server";
    if (std.mem.eql(u8, backend, "exllamav3")) return "tabbyapi";
    return null;
}

fn resolveEngineBinary(allocator: std.mem.Allocator, io: std.Io, recipe: std.json.ObjectMap, backend: []const u8, runtime_kind: []const u8, runtime_ref: []const u8, configuration: *const config_module.Config) ![]const u8 {
    if (std.mem.eql(u8, runtime_kind, "binary")) return runtime_ref;
    if (std.mem.eql(u8, runtime_kind, "system")) {
        if (!std.mem.eql(u8, backend, "llamacpp")) {
            const executable = defaultBinary(backend) orelse return error.UnsupportedBackend;
            if (std.fs.path.dirname(runtime_ref)) |directory| {
                const sibling = try std.fs.path.join(allocator, &.{ directory, executable });
                if (pathExists(io, sibling)) return sibling;
            }
        }
        return runtime_ref;
    }
    if (!std.mem.eql(u8, runtime_kind, "managed_venv")) return error.UnsupportedRuntime;
    if (try selectedTargetBinary(allocator, io, backend, configuration)) |selected| return selected;
    if (std.mem.eql(u8, backend, "llamacpp")) {
        if (configuration.llama_bin) |configured| return configured;
        const managed = try std.fs.path.join(allocator, &.{ configuration.data_dir, "runtime", "llamacpp", "src", "build", "bin", "llama-server" });
        return if (pathExists(io, managed)) managed else "llama-server";
    }
    const executable = defaultBinary(backend) orelse return error.UnsupportedBackend;
    const python = try resolvePython(allocator, io, recipe, backend, configuration);
    if (python) |path| {
        const directory = std.fs.path.dirname(path) orelse return executable;
        const sibling = try std.fs.path.join(allocator, &.{ directory, executable });
        if (pathExists(io, sibling)) return sibling;
    }
    return executable;
}

fn selectedTargetBinary(allocator: std.mem.Allocator, io: std.Io, backend: []const u8, configuration: *const config_module.Config) !?[]const u8 {
    const selected_id = try studio_settings.selectedRuntimeTargetId(allocator, io, configuration.data_dir, backend) orelse return null;
    const prefix = try std.fmt.allocPrint(allocator, "{s}:", .{backend});
    if (!std.mem.startsWith(u8, selected_id, prefix)) return null;
    const identity = selected_id[prefix.len..];
    const separator = std.mem.indexOfScalar(u8, identity, ':') orelse return null;
    const kind = identity[0..separator];
    const encoded = identity[separator + 1 ..];
    const size = std.base64.url_safe_no_pad.Decoder.calcSizeForSlice(encoded) catch return null;
    if (size == 0) return null;
    const decoded = try allocator.alloc(u8, size);
    std.base64.url_safe_no_pad.Decoder.decode(decoded, encoded) catch return null;
    if (std.mem.eql(u8, kind, "venv")) {
        const executable = defaultBinary(backend) orelse return null;
        const directory = std.fs.path.dirname(decoded) orelse return null;
        const sibling = try std.fs.path.join(allocator, &.{ directory, executable });
        return if (pathExists(io, sibling)) sibling else null;
    }
    if (std.mem.eql(u8, kind, "binary")) return if (pathExists(io, decoded)) decoded else null;
    if (!std.mem.eql(u8, kind, "system")) return null;
    const expected = defaultBinary(backend) orelse return null;
    return if (std.mem.eql(u8, decoded, expected)) decoded else null;
}

fn resolvePython(allocator: std.mem.Allocator, io: std.Io, recipe: std.json.ObjectMap, backend: []const u8, configuration: *const config_module.Config) !?[]const u8 {
    if (nullableStringField(recipe, "python_path")) |configured| if (pathExists(io, configured)) return configured;
    if (std.mem.eql(u8, backend, "vllm")) {
        if (configuration.environment.get("LOCAL_STUDIO_RUNTIME_PYTHON")) |configured| {
            const trimmed = std.mem.trim(u8, configured, " \t\r\n");
            if (trimmed.len > 0 and pathExists(io, trimmed)) return trimmed;
        }
        if (pathExists(io, "/opt/venvs/active/vllm-latest/bin/python")) return "/opt/venvs/active/vllm-latest/bin/python";
    }
    const managed = try std.fs.path.join(allocator, &.{ configuration.data_dir, "runtime", "venvs", try std.fmt.allocPrint(allocator, "{s}-latest", .{backend}), "bin", "python" });
    if (pathExists(io, managed)) return managed;
    if (std.mem.eql(u8, backend, "sglang")) {
        if (configuration.sglang_python) |configured| if (pathExists(io, configured)) return configured;
    } else if (std.mem.eql(u8, backend, "mlx")) {
        if (configuration.mlx_python) |configured| if (pathExists(io, configured)) return configured;
    }
    return null;
}

fn pathExists(io: std.Io, path: []const u8) bool {
    _ = std.Io.Dir.cwd().statFile(io, path, .{}) catch return false;
    return true;
}

fn validateHostSupport(backend: []const u8) !void {
    if (std.mem.eql(u8, backend, "mlx") and (builtin.os.tag != .macos or builtin.cpu.arch != .aarch64)) return error.UnsupportedPlatform;
    if ((std.mem.eql(u8, backend, "vllm") or std.mem.eql(u8, backend, "sglang")) and builtin.os.tag == .macos) return error.UnsupportedPlatform;
    if (defaultBinary(backend) == null) return error.UnsupportedBackend;
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    return if (value == .string and value.string.len > 0) value.string else null;
}

fn nullableStringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    return if (value == .string and value.string.len > 0) value.string else null;
}

fn booleanField(object: std.json.ObjectMap, name: []const u8) bool {
    const value = object.get(name) orelse return false;
    return value == .bool and value.bool;
}

fn portField(object: std.json.ObjectMap, name: []const u8) ?u16 {
    const value = object.get(name) orelse return null;
    if (value != .integer or value.integer <= 0 or value.integer > std.math.maxInt(u16)) return null;
    return @intCast(value.integer);
}
