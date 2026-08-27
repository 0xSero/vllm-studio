const std = @import("std");
const config_module = @import("../../app/config.zig");
const system_info = @import("../../system/platform/system_info.zig");
const runtime_info = @import("info.zig");
const lifecycle = @import("lifecycle.zig");
const settings_file = @import("../../system/settings/studio_store.zig");

pub const Backend = enum { vllm, sglang, llamacpp, mlx };

pub fn backendPayload(allocator: std.mem.Allocator, configuration: *const config_module.Config, system: *const system_info.Snapshot, cache: *runtime_info.Cache, backend: Backend) ![]u8 {
    const document = try cache.payload(allocator, configuration, system);
    defer allocator.free(document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidRuntimePayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidRuntimePayload;
    const backends = objectField(parsed.value.object, "backends") orelse return error.InvalidRuntimePayload;
    const value = backends.get(@tagName(backend)) orelse return error.InvalidRuntimePayload;
    if (value != .object) return error.InvalidRuntimePayload;
    if (backend != .vllm) return stringify(allocator, value);
    const Vllm = struct {
        installed: bool,
        version: ?[]const u8,
        python_path: ?[]const u8,
        vllm_bin: ?[]const u8,
        upgrade_command_available: bool,
        bundled_wheel: ?u8 = null,
    };
    return stringify(allocator, Vllm{
        .installed = boolean(value.object, "installed") orelse false,
        .version = optionalString(value.object, "version"),
        .python_path = optionalString(value.object, "python_path"),
        .vllm_bin = if (boolean(value.object, "installed") orelse false) optionalString(value.object, "binary_path") else null,
        .upgrade_command_available = boolean(value.object, "upgrade_command_available") orelse false,
    });
}

pub fn cudaPayload(allocator: std.mem.Allocator, configuration: *const config_module.Config, system: *const system_info.Snapshot, cache: *runtime_info.Cache) ![]u8 {
    return objectPayload(allocator, configuration, system, cache, "cuda");
}

pub fn rocmPayload(allocator: std.mem.Allocator, configuration: *const config_module.Config, system: *const system_info.Snapshot, cache: *runtime_info.Cache) ![]u8 {
    const document = try cache.payload(allocator, configuration, system);
    defer allocator.free(document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidRuntimePayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidRuntimePayload;
    const platform = objectField(parsed.value.object, "platform") orelse return error.InvalidRuntimePayload;
    const rocm = platform.get("rocm");
    if (rocm) |value| if (value == .object) return stringify(allocator, value);
    const Empty = struct {
        rocm_version: ?u8 = null,
        hip_version: ?u8 = null,
        smi_tool: ?u8 = null,
        gpu_arch: []const []const u8 = &.{},
        upgrade_command_available: bool = false,
    };
    return stringify(allocator, Empty{});
}

pub fn targetsPayload(allocator: std.mem.Allocator, io: std.Io, configuration: *const config_module.Config, system: *const system_info.Snapshot, cache: *runtime_info.Cache, supervisor: *lifecycle.Supervisor) ![]u8 {
    const document = try cache.payload(allocator, configuration, system);
    defer allocator.free(document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidRuntimePayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidRuntimePayload;
    const backends = objectField(parsed.value.object, "backends") orelse return error.InvalidRuntimePayload;
    const selected_document = try readSettings(allocator, io, configuration.data_dir);
    defer if (selected_document) |value| allocator.free(value);
    var selected_arena = std.heap.ArenaAllocator.init(allocator);
    defer selected_arena.deinit();
    const selected = if (selected_document) |value| selectedObject(selected_arena.allocator(), value) else null;
    const running_engine = try supervisor.runningEngine(allocator);
    defer if (running_engine) |value| allocator.free(value);

    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"targets\":[");
    inline for (std.meta.fields(Backend), 0..) |field, index| {
        if (index > 0) try output.writer.writeByte(',');
        const backend: Backend = @enumFromInt(field.value);
        const value = backends.get(field.name) orelse return error.InvalidRuntimePayload;
        if (value != .object) return error.InvalidRuntimePayload;
        try writeTarget(allocator, &output.writer, configuration, backend, value.object, selectedId(selected, field.name), running_engine);
    }
    try output.writer.writeAll("]}");
    return output.toOwnedSlice();
}

pub fn selectTargetPayload(allocator: std.mem.Allocator, io: std.Io, configuration: *const config_module.Config, system: *const system_info.Snapshot, cache: *runtime_info.Cache, supervisor: *lifecycle.Supervisor, target_id: []const u8) !?[]u8 {
    const targets_document = try targetsPayload(allocator, io, configuration, system, cache, supervisor);
    defer allocator.free(targets_document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, targets_document, .{}) catch return error.InvalidRuntimePayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidRuntimePayload;
    const targets = parsed.value.object.get("targets") orelse return error.InvalidRuntimePayload;
    if (targets != .array) return error.InvalidRuntimePayload;
    for (targets.array.items) |*target| {
        if (target.* != .object) continue;
        const id = optionalString(target.object, "id") orelse continue;
        if (!std.mem.eql(u8, id, target_id)) continue;
        const backend = optionalString(target.object, "backend") orelse return error.InvalidRuntimePayload;
        try settings_file.updateSelectedRuntimeTarget(allocator, io, configuration.data_dir, backend, id);
        try target.object.put(parsed.arena.allocator(), "active", .{ .bool = true });
        var output: std.Io.Writer.Allocating = .init(allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"target\":");
        try std.json.Stringify.value(target, .{}, &output.writer);
        try output.writer.writeByte('}');
        return @as(?[]u8, try output.toOwnedSlice());
    }
    return null;
}

pub fn configHelpPayload(allocator: std.mem.Allocator, io: std.Io, configuration: *const config_module.Config, backend: Backend) ![]u8 {
    const command: []const u8 = switch (backend) {
        .vllm => "vllm",
        .llamacpp => configuration.llama_bin orelse "llama-server",
        else => return error.ConfigHelpUnavailable,
    };
    const arguments: []const []const u8 = switch (backend) {
        .vllm => &.{ command, "serve", "--help" },
        .llamacpp => &.{ command, "--help" },
        else => unreachable,
    };
    const result = std.process.run(allocator, io, .{
        .argv = arguments,
        .stdout_limit = .limited(4 * 1024 * 1024),
        .stderr_limit = .limited(1024 * 1024),
        .timeout = .{ .duration = .{ .clock = .awake, .raw = std.Io.Duration.fromSeconds(5) } },
    }) catch return configHelpResult(allocator, null, if (backend == .vllm) "vLLM runtime not available" else "llama.cpp runtime not available");
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    const success = switch (result.term) {
        .exited => |code| code == 0,
        else => false,
    };
    if (!success) {
        const config = nonempty(result.stdout);
        const message = nonempty(result.stderr) orelse if (backend == .vllm) "Failed to fetch vLLM config" else "Failed to fetch llama.cpp config";
        return configHelpResult(allocator, config, message);
    }
    return configHelpResult(allocator, nonempty(result.stdout) orelse nonempty(result.stderr), null);
}

fn objectPayload(allocator: std.mem.Allocator, configuration: *const config_module.Config, system: *const system_info.Snapshot, cache: *runtime_info.Cache, name: []const u8) ![]u8 {
    const document = try cache.payload(allocator, configuration, system);
    defer allocator.free(document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidRuntimePayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidRuntimePayload;
    const value = parsed.value.object.get(name) orelse return error.InvalidRuntimePayload;
    if (value != .object) return error.InvalidRuntimePayload;
    return stringify(allocator, value);
}

fn configHelpResult(allocator: std.mem.Allocator, config: ?[]const u8, message: ?[]const u8) ![]u8 {
    const Result = struct { config: ?[]const u8, @"error": ?[]const u8 };
    return stringify(allocator, Result{ .config = config, .@"error" = message });
}

fn stringify(allocator: std.mem.Allocator, value: anytype) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(value, .{}, &output.writer);
    return output.toOwnedSlice();
}

fn objectField(object: std.json.ObjectMap, name: []const u8) ?std.json.ObjectMap {
    const value = object.get(name) orelse return null;
    return if (value == .object) value.object else null;
}

fn optionalString(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    return if (value == .string) value.string else null;
}

fn boolean(object: std.json.ObjectMap, name: []const u8) ?bool {
    const value = object.get(name) orelse return null;
    return if (value == .bool) value.bool else null;
}

fn nonempty(value: []const u8) ?[]const u8 {
    const trimmed = std.mem.trim(u8, value, " \t\r\n");
    return if (trimmed.len > 0) trimmed else null;
}

fn writeTarget(allocator: std.mem.Allocator, writer: *std.Io.Writer, configuration: *const config_module.Config, backend: Backend, info: std.json.ObjectMap, selected_id: ?[]const u8, running_engine: ?[]const u8) !void {
    const backend_name = @tagName(backend);
    const installed = boolean(info, "installed") orelse false;
    const python_path = optionalString(info, "python_path");
    const binary_path = optionalString(info, "binary_path");
    const key = python_path orelse binary_path orelse backend_name;
    const kind: []const u8 = if (python_path != null) "venv" else if (binary_path != null and std.mem.indexOfScalar(u8, binary_path.?, std.fs.path.sep) != null) "binary" else "system";
    const source: []const u8 = switch (backend) {
        .sglang => if (configuration.sglang_python != null) "configured" else "discovered",
        .llamacpp => if (configuration.llama_bin != null) "configured" else "discovered",
        .mlx => if (configuration.mlx_python != null) "configured" else "discovered",
        .vllm => "discovered",
    };
    const encoded_size = std.base64.url_safe_no_pad.Encoder.calcSize(key.len);
    const encoded = try allocator.alloc(u8, encoded_size);
    defer allocator.free(encoded);
    _ = std.base64.url_safe_no_pad.Encoder.encode(encoded, key);
    const id = try std.fmt.allocPrint(allocator, "{s}:{s}:{s}", .{ backend_name, kind, encoded });
    defer allocator.free(id);
    const label_name: []const u8 = switch (backend) {
        .vllm => "vLLM",
        .sglang => "SGLang",
        .llamacpp => "llama.cpp",
        .mlx => "MLX",
    };
    const label = try std.fmt.allocPrint(allocator, "{s} {s}", .{ label_name, if (source[0] == 'c') "configured" else "discovered" });
    defer allocator.free(label);
    const active = (selected_id != null and std.mem.eql(u8, selected_id.?, id)) or (running_engine != null and std.mem.eql(u8, running_engine.?, backend_name));
    const managed_llama_root = try std.fs.path.join(allocator, &.{ configuration.data_dir, "runtime", "llamacpp" });
    defer allocator.free(managed_llama_root);
    const managed_llama = backend == .llamacpp and binary_path != null and std.mem.startsWith(u8, binary_path.?, managed_llama_root);
    const can_update = switch (backend) {
        .vllm, .mlx => installed and python_path != null,
        .sglang => installed and (python_path != null or configuration.environment.get("LOCAL_STUDIO_SGLANG_UPGRADE_CMD") != null),
        .llamacpp => managed_llama or configuration.environment.get("LOCAL_STUDIO_LLAMACPP_UPGRADE_CMD") != null,
    };
    const Capabilities = struct {
        canLaunch: bool,
        canUpdate: bool,
        canInspectOptions: bool,
        supportsDocker: bool = false,
    };
    const Health = struct {
        status: []const u8,
    };
    const Update = struct {
        currentVersion: ?[]const u8,
        targetVersion: []const u8,
        packageSpec: []const u8,
        releaseNotesUrl: []const u8,
        restartRequired: bool = true,
        changes: []const []const u8,
    };
    const Target = struct {
        id: []const u8,
        backend: []const u8,
        kind: []const u8,
        label: []const u8,
        installed: bool,
        active: bool,
        version: ?[]const u8,
        pythonPath: ?[]const u8,
        binaryPath: ?[]const u8,
        dockerImage: ?u8 = null,
        source: []const u8,
        capabilities: Capabilities,
        health: Health,
        update: ?Update,
    };
    const configured_vllm_version = if (configuration.environment.get("LOCAL_STUDIO_VLLM_UPGRADE_VERSION")) |value| std.mem.trim(u8, value, " \t\r\n") else "";
    const update = if (can_update) Update{
        .currentVersion = optionalString(info, "version"),
        .targetVersion = if (backend == .vllm and configured_vllm_version.len > 0) configured_vllm_version else if (backend == .llamacpp and !managed_llama) "configured" else "latest",
        .packageSpec = switch (backend) {
            .vllm => if (configured_vllm_version.len > 0) try std.fmt.allocPrint(allocator, "vllm=={s}", .{configured_vllm_version}) else "vllm",
            .sglang => "sglang",
            .llamacpp => if (managed_llama) "llama.cpp source" else "configured llama.cpp upgrade command",
            .mlx => "mlx-lm",
        },
        .releaseNotesUrl = switch (backend) {
            .vllm => "https://github.com/vllm-project/vllm/releases",
            .sglang => "https://github.com/sgl-project/sglang/releases",
            .llamacpp => "https://github.com/ggml-org/llama.cpp/releases",
            .mlx => "https://github.com/ml-explore/mlx-lm/releases",
        },
        .changes = &.{ "Runtime package or binary", "Controller runtime target metadata after completion", "Running model process after restart or reload" },
    } else null;
    defer if (update) |value| if (backend == .vllm and configured_vllm_version.len > 0) allocator.free(value.packageSpec);
    try std.json.Stringify.value(Target{
        .id = id,
        .backend = backend_name,
        .kind = kind,
        .label = label,
        .installed = installed,
        .active = active,
        .version = optionalString(info, "version"),
        .pythonPath = python_path,
        .binaryPath = binary_path,
        .source = source,
        .capabilities = .{
            .canLaunch = installed,
            .canUpdate = can_update,
            .canInspectOptions = installed and (backend == .vllm or backend == .llamacpp),
        },
        .health = .{ .status = if (installed) "ok" else "warning" },
        .update = update,
    }, .{}, writer);
}

fn readSettings(allocator: std.mem.Allocator, io: std.Io, data_dir: []const u8) !?[]u8 {
    const settings_path = try settings_file.path(allocator, data_dir);
    defer allocator.free(settings_path);
    return std.Io.Dir.cwd().readFileAlloc(io, settings_path, allocator, .limited(1024 * 1024)) catch |failure| switch (failure) {
        error.FileNotFound => null,
        else => return failure,
    };
}

fn selectedObject(allocator: std.mem.Allocator, document: []const u8) ?std.json.ObjectMap {
    const value = std.json.parseFromSliceLeaky(std.json.Value, allocator, document, .{}) catch return null;
    if (value != .object) return null;
    const selected = value.object.get("selected_runtime_target_ids") orelse return null;
    return if (selected == .object) selected.object else null;
}

fn selectedId(selected: ?std.json.ObjectMap, backend: []const u8) ?[]const u8 {
    const object = selected orelse return null;
    const value = object.get(backend) orelse return null;
    return if (value == .string) value.string else null;
}
