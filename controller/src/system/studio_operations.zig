const std = @import("std");
const builtin = @import("builtin");
const config_module = @import("../app/config.zig");
const system_info = @import("platform/system_info.zig");
const runtime_info = @import("../inference/runtime/info.zig");
const storage = @import("storage.zig");
const telemetry = @import("telemetry.zig");

const Io = std.Io;

pub fn diagnosticsPayload(allocator: std.mem.Allocator, io: Io, configuration: *const config_module.Config, models_dir: []const u8, system: *const system_info.Snapshot, runtime_cache: *runtime_info.Cache) ![]u8 {
    const gpu_document = try telemetry.gpuArrayPayload(allocator, io, system);
    defer allocator.free(gpu_document);
    var gpus = std.json.parseFromSlice(std.json.Value, allocator, gpu_document, .{}) catch return error.InvalidGpuPayload;
    defer gpus.deinit();
    if (gpus.value != .array) return error.InvalidGpuPayload;

    const runtime_document = try runtime_cache.payload(allocator, configuration, system);
    defer allocator.free(runtime_document);
    var runtime = std.json.parseFromSlice(std.json.Value, allocator, runtime_document, .{}) catch return error.InvalidRuntimePayload;
    defer runtime.deinit();
    if (runtime.value != .object) return error.InvalidRuntimePayload;
    const backends = objectField(runtime.value.object, "backends") orelse return error.InvalidRuntimePayload;
    const vllm = objectField(backends, "vllm") orelse return error.InvalidRuntimePayload;
    const vllm_installed = boolField(vllm, "installed") orelse false;

    const Runtime = struct {
        vllm_installed: bool,
        vllm_version: ?[]const u8,
        python_path: ?[]const u8,
        vllm_bin: ?[]const u8,
    };
    const Config = struct {
        host: []const u8,
        port: u16,
        inference_port: u16,
        api_key_configured: bool,
        models_dir: []const u8,
        data_dir: []const u8,
        db_path: []const u8,
        sglang_python: ?[]const u8,
        llama_bin: ?[]const u8,
        mlx_python: ?[]const u8,
    };
    const Payload = struct {
        app_version: []const u8,
        timestamp: []const u8,
        platform: []const u8,
        arch: []const u8,
        release: []const u8,
        cpu_model: ?[]const u8,
        cpu_cores: usize,
        cpu_usage_percent: ?f64,
        memory_total: u64,
        memory_free: u64,
        network_receive_bytes: ?u64,
        network_transmit_bytes: ?u64,
        gpus: std.json.Value,
        runtime: Runtime,
        disks: []const storage.Disk,
        config: Config,
    };
    var timestamp_buffer: [24]u8 = undefined;
    const disks = [_]storage.Disk{
        storage.inspectDisk(allocator, configuration.data_dir),
        storage.inspectDisk(allocator, models_dir),
    };
    const network = telemetry.networkCounters(allocator, io);
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(Payload{
        .app_version = configuration.environment.get("LOCAL_STUDIO_VERSION") orelse "dev",
        .timestamp = formatTimestamp(io, &timestamp_buffer),
        .platform = platformName(),
        .arch = architectureName(),
        .release = system.release,
        .cpu_model = system.cpu_model,
        .cpu_cores = system.cpu_cores,
        .cpu_usage_percent = telemetry.cpuUsagePercent(allocator, io, system.cpu_cores),
        .memory_total = system.memory_total_bytes,
        .memory_free = telemetry.availableMemoryBytes(allocator, io, system.memory_total_bytes),
        .network_receive_bytes = if (network) |sample| sample.receive_bytes else null,
        .network_transmit_bytes = if (network) |sample| sample.transmit_bytes else null,
        .gpus = gpus.value,
        .runtime = .{
            .vllm_installed = vllm_installed,
            .vllm_version = optionalString(vllm, "version"),
            .python_path = optionalString(vllm, "python_path"),
            .vllm_bin = if (vllm_installed) optionalString(vllm, "binary_path") else null,
        },
        .disks = &disks,
        .config = .{
            .host = configuration.host,
            .port = configuration.port,
            .inference_port = configuration.inference_port,
            .api_key_configured = configuration.api_key != null,
            .models_dir = models_dir,
            .data_dir = configuration.data_dir,
            .db_path = configuration.db_path,
            .sglang_python = configuration.sglang_python,
            .llama_bin = configuration.llama_bin,
            .mlx_python = configuration.mlx_python,
        },
    }, .{}, &output.writer);
    return output.toOwnedSlice();
}

pub fn presetsPayload(allocator: std.mem.Allocator, io: Io, system: *const system_info.Snapshot) ![]u8 {
    const gpu_document = try telemetry.gpuArrayPayload(allocator, io, system);
    defer allocator.free(gpu_document);
    var gpus = std.json.parseFromSlice(std.json.Value, allocator, gpu_document, .{}) catch return error.InvalidGpuPayload;
    defer gpus.deinit();
    if (gpus.value != .array) return error.InvalidGpuPayload;
    var total_megabytes: f64 = 0;
    for (gpus.value.array.items) |gpu| {
        if (gpu != .object) continue;
        total_megabytes += numeric(gpu.object.get("memory_total_mb"));
    }
    const max_vram_gb = total_megabytes / 1024;
    const qwen_fits = max_vram_gb == 0 or max_vram_gb >= 24;
    const apple_silicon = builtin.os.tag == .macos and builtin.cpu.arch == .aarch64;
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"presets\":[");
    var count: usize = 0;
    if (!apple_silicon) {
        try writePreset(&output.writer, qwen_preset, qwen_fits, &count);
    }
    try writePreset(&output.writer, lfm_preset, true, &count);
    try writePreset(&output.writer, remote_preset, true, &count);
    try output.writer.writeAll("],\"max_vram_gb\":");
    try std.json.Stringify.value(max_vram_gb, .{}, &output.writer);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn writePreset(writer: *Io.Writer, document: []const u8, fits: bool, count: *usize) !void {
    if (count.* > 0) try writer.writeByte(',');
    count.* += 1;
    try writer.writeAll(document[0 .. document.len - 1]);
    try writer.writeAll(",\"fits\":");
    try writer.writeAll(if (fits) "true}" else "false}");
}

fn objectField(object: std.json.ObjectMap, name: []const u8) ?std.json.ObjectMap {
    const value = object.get(name) orelse return null;
    return if (value == .object) value.object else null;
}

fn optionalString(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    return if (value == .string) value.string else null;
}

fn boolField(object: std.json.ObjectMap, name: []const u8) ?bool {
    const value = object.get(name) orelse return null;
    return if (value == .bool) value.bool else null;
}

fn numeric(value: ?std.json.Value) f64 {
    const entry = value orelse return 0;
    return switch (entry) {
        .integer => |number| @floatFromInt(number),
        .float => |number| number,
        else => 0,
    };
}

fn platformName() []const u8 {
    return switch (builtin.os.tag) {
        .macos => "darwin",
        .linux => "linux",
        .windows => "win32",
        else => @tagName(builtin.os.tag),
    };
}

fn architectureName() []const u8 {
    return switch (builtin.cpu.arch) {
        .aarch64 => "arm64",
        .x86_64 => "x64",
        else => @tagName(builtin.cpu.arch),
    };
}

fn formatTimestamp(io: Io, buffer: *[24]u8) []const u8 {
    const seconds = Io.Clock.real.now(io).toSeconds();
    const now: u64 = @intCast(@max(seconds, 0));
    const epoch = std.time.epoch.EpochSeconds{ .secs = now };
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

const qwen_preset =
    "{\"id\":\"qwen3-6-35b\",\"name\":\"Qwen3.6 35B\",\"description\":\"Hybrid MoE in native FP4 — frontier-class local chat, tool use, and reasoning on a single Blackwell GPU.\",\"kind\":\"download\",\"tags\":[\"local\",\"reasoning\",\"tool-use\",\"recommended\"],\"size_gb\":20,\"min_vram_gb\":24,\"model_id\":\"nvidia/Qwen3.6-35B-A3B-NVFP4\",\"backend\":\"vllm\",\"recipe_overrides\":{\"served_model_name\":\"qwen3.6-35b\",\"max_model_len\":131072,\"tool_call_parser\":\"qwen3_coder\",\"reasoning_parser\":\"qwen3\",\"enable_auto_tool_choice\":true,\"trust_remote_code\":true}}";

const lfm_preset =
    "{\"id\":\"lfm2-5\",\"name\":\"LFM2.5 8B\",\"description\":\"Liquid AI's on-device MoE (8B-A1B, Q4_K_M) — a ~5 GB download that chats instantly on modest hardware.\",\"kind\":\"download\",\"tags\":[\"local\",\"fast\",\"small\"],\"size_gb\":5,\"min_vram_gb\":null,\"model_id\":\"LiquidAI/LFM2.5-8B-A1B-GGUF\",\"allow_patterns\":[\"*Q4_K_M.gguf\"],\"backend\":\"llamacpp\",\"gguf_file\":\"LFM2.5-8B-A1B-Q4_K_M.gguf\",\"recipe_overrides\":{\"served_model_name\":\"lfm2.5\",\"max_model_len\":32768}}";

const remote_preset =
    "{\"id\":\"deepseek-v4-flash\",\"name\":\"DeepSeek V4 Flash\",\"description\":\"Connect a hosted endpoint with one API key — full-strength chat with nothing to download.\",\"kind\":\"remote\",\"tags\":[\"remote\",\"instant\"],\"size_gb\":null,\"min_vram_gb\":null,\"remote\":{\"base_url\":\"http://pop-os-1.tailadb2c1.ts.net:8080/v1\",\"model\":\"deepseek-v4-flash\"}}";
