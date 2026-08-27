const std = @import("std");
const config_module = @import("../../app/config.zig");
const system_info = @import("../../system/platform/system_info.zig");

const Io = std.Io;
const cache_seconds = 30;

pub const Cache = struct {
    allocator: std.mem.Allocator,
    io: Io,
    mutex: Io.Mutex = .init,
    value: ?[]u8 = null,
    expires_at: ?Io.Timestamp = null,

    pub fn init(allocator: std.mem.Allocator, io: Io) Cache {
        return .{ .allocator = allocator, .io = io };
    }

    pub fn deinit(cache: *Cache) void {
        if (cache.value) |value| cache.allocator.free(value);
        cache.* = undefined;
    }

    pub fn payload(cache: *Cache, allocator: std.mem.Allocator, config: *const config_module.Config, system: *const system_info.Snapshot) ![]u8 {
        try cache.mutex.lock(cache.io);
        defer cache.mutex.unlock(cache.io);
        const now = Io.Clock.awake.now(cache.io);
        if (cache.value) |value| {
            if (cache.expires_at) |expires_at| {
                if (now.durationTo(expires_at).toNanoseconds() > 0) return try allocator.dupe(u8, value);
            }
        }
        var info = try detect(cache.allocator, cache.io, config, system);
        defer info.deinit();
        var output: Io.Writer.Allocating = .init(cache.allocator);
        errdefer output.deinit();
        try std.json.Stringify.value(info.runtime, .{}, &output.writer);
        const next = try output.toOwnedSlice();
        if (cache.value) |value| cache.allocator.free(value);
        cache.value = next;
        cache.expires_at = now.addDuration(.fromSeconds(cache_seconds));
        return try allocator.dupe(u8, next);
    }

    pub fn invalidate(cache: *Cache) !void {
        try cache.mutex.lock(cache.io);
        defer cache.mutex.unlock(cache.io);
        if (cache.value) |value| cache.allocator.free(value);
        cache.value = null;
        cache.expires_at = null;
    }
};

pub const Backend = struct {
    installed: bool,
    version: ?[]const u8,
    python_path: ?[]const u8 = null,
    binary_path: ?[]const u8 = null,
    upgrade_command_available: bool = false,
};

pub const Torch = struct {
    torch_version: ?[]const u8 = null,
    torch_cuda: ?[]const u8 = null,
    torch_hip: ?[]const u8 = null,
};

pub const Runtime = struct {
    platform: struct {
        kind: []const u8,
        vendor: ?[]const u8,
        rocm: ?u8 = null,
        torch: Torch = .{},
    },
    gpu_monitoring: struct {
        available: bool,
        tool: ?[]const u8,
    },
    cuda: struct {
        driver_version: ?[]const u8 = null,
        cuda_version: ?[]const u8 = null,
        upgrade_command_available: bool = false,
    } = .{},
    gpus: struct {
        count: usize,
        types: []const []const u8,
    },
    backends: struct {
        vllm: Backend,
        sglang: Backend,
        llamacpp: Backend,
        mlx: Backend,
    },
};

pub const Info = struct {
    arena: std.heap.ArenaAllocator,
    runtime: Runtime,

    pub fn deinit(info: *Info) void {
        info.arena.deinit();
        info.* = undefined;
    }
};

pub fn detect(allocator: std.mem.Allocator, io: Io, config: *const config_module.Config, system: *const system_info.Snapshot) !Info {
    var arena = std.heap.ArenaAllocator.init(allocator);
    errdefer arena.deinit();
    const storage = arena.allocator();

    const gpu = try detectGpu(storage, allocator, io, system);
    const vllm_managed = try managedPython(storage, config.data_dir, "vllm");
    const sglang_managed = try managedPython(storage, config.data_dir, "sglang");
    const mlx_managed = try managedPython(storage, config.data_dir, "mlx");
    const vllm = try detectPythonBackend(storage, allocator, io, &.{ config.environment.get("LOCAL_STUDIO_RUNTIME_PYTHON"), vllm_managed, "/opt/venvs/active/vllm-latest/bin/python" }, "vllm", "vllm", &.{ "vllm", "--version" }, "vllm");
    const sglang = try detectPythonBackend(storage, allocator, io, &.{ config.sglang_python, sglang_managed, "/opt/venvs/active/sglang-latest/bin/python", "/opt/venvs/sglang-latest/bin/python" }, "sglang", "sglang", &.{ "sglang", "--version" }, "sglang");
    const managed_llama = try std.fs.path.join(storage, &.{ config.data_dir, "runtime", "llamacpp", "src", "build", "bin", "llama-server" });
    const llama_binary = config.llama_bin orelse if (pathExists(io, managed_llama)) managed_llama else "llama-server";
    var llamacpp = try commandBackend(storage, allocator, io, &.{ llama_binary, "--version" }, null, llama_binary);
    llamacpp.upgrade_command_available = llamacpp.installed and (std.mem.eql(u8, llama_binary, managed_llama) or config.environment.get("LOCAL_STUDIO_LLAMACPP_UPGRADE_CMD") != null);
    const mlx = try detectPythonBackend(storage, allocator, io, &.{ config.mlx_python, mlx_managed }, "mlx-lm", "mlx_lm", &.{ "mlx_lm.server", "--help" }, "mlx_lm.server");

    return .{
        .arena = arena,
        .runtime = .{
            .platform = .{
                .kind = gpu.kind,
                .vendor = gpu.vendor,
            },
            .gpu_monitoring = .{
                .available = gpu.monitoring_available,
                .tool = gpu.monitoring_tool,
            },
            .gpus = .{
                .count = gpu.count,
                .types = gpu.types,
            },
            .backends = .{
                .vllm = vllm,
                .sglang = sglang,
                .llamacpp = llamacpp,
                .mlx = mlx,
            },
        },
    };
}

const GpuSummary = struct {
    kind: []const u8,
    vendor: ?[]const u8,
    monitoring_available: bool,
    monitoring_tool: ?[]const u8,
    count: usize,
    types: []const []const u8,
};

fn detectGpu(storage: std.mem.Allocator, allocator: std.mem.Allocator, io: Io, system: *const system_info.Snapshot) !GpuSummary {
    if (system.apple_silicon) {
        const name = try std.fmt.allocPrint(storage, "{s} GPU", .{system.cpu_model orelse "Apple Silicon"});
        const types = try storage.alloc([]const u8, 1);
        types[0] = name;
        return .{
            .kind = "metal",
            .vendor = "apple",
            .monitoring_available = false,
            .monitoring_tool = "apple-metal",
            .count = 1,
            .types = types,
        };
    }
    const result = run(allocator, io, &.{ "nvidia-smi", "--query-gpu=name", "--format=csv,noheader,nounits" }) orelse return .{
        .kind = "unknown",
        .vendor = null,
        .monitoring_available = false,
        .monitoring_tool = null,
        .count = 0,
        .types = &.{},
    };
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    if (!successful(result.term)) return .{
        .kind = "unknown",
        .vendor = null,
        .monitoring_available = false,
        .monitoring_tool = null,
        .count = 0,
        .types = &.{},
    };
    var types: std.ArrayList([]const u8) = .empty;
    var count: usize = 0;
    var lines = std.mem.splitScalar(u8, result.stdout, '\n');
    while (lines.next()) |raw| {
        const name = std.mem.trim(u8, raw, " \t\r");
        if (name.len == 0) continue;
        count += 1;
        if (contains(types.items, name)) continue;
        try types.append(storage, try storage.dupe(u8, name));
    }
    return .{
        .kind = "cuda",
        .vendor = "nvidia",
        .monitoring_available = true,
        .monitoring_tool = "nvidia-smi",
        .count = count,
        .types = try types.toOwnedSlice(storage),
    };
}

fn commandBackend(storage: std.mem.Allocator, allocator: std.mem.Allocator, io: Io, argv: []const []const u8, python_path: ?[]const u8, binary_path: ?[]const u8) !Backend {
    const result = run(allocator, io, argv) orelse return .{
        .installed = false,
        .version = null,
        .python_path = python_path,
        .binary_path = binary_path,
    };
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    if (!successful(result.term)) return .{
        .installed = false,
        .version = null,
        .python_path = python_path,
        .binary_path = binary_path,
    };
    const version = firstLine(result.stdout) orelse firstLine(result.stderr);
    return .{
        .installed = true,
        .version = if (version) |value| try storage.dupe(u8, value) else null,
        .python_path = python_path,
        .binary_path = binary_path,
    };
}

fn pythonBackend(storage: std.mem.Allocator, allocator: std.mem.Allocator, io: Io, python: []const u8, package: []const u8, module: []const u8) !Backend {
    const script = try std.fmt.allocPrint(storage, "import importlib.metadata as m; import {s}; print(m.version('{s}'))", .{ module, package });
    var backend = try commandBackend(storage, allocator, io, &.{ python, "-c", script }, python, null);
    backend.upgrade_command_available = backend.installed;
    return backend;
}

fn detectPythonBackend(storage: std.mem.Allocator, allocator: std.mem.Allocator, io: Io, candidates: []const ?[]const u8, package: []const u8, module: []const u8, fallback_argv: []const []const u8, fallback_binary: []const u8) !Backend {
    for (candidates) |candidate| {
        const raw = candidate orelse continue;
        const python = std.mem.trim(u8, raw, " \t\r\n");
        if (python.len == 0 or !pathExists(io, python)) continue;
        const backend = try pythonBackend(storage, allocator, io, python, package, module);
        if (backend.installed) return backend;
    }
    return commandBackend(storage, allocator, io, fallback_argv, null, fallback_binary);
}

fn managedPython(allocator: std.mem.Allocator, data_dir: []const u8, backend: []const u8) ![]const u8 {
    const name = try std.fmt.allocPrint(allocator, "{s}-latest", .{backend});
    return std.fs.path.join(allocator, &.{ data_dir, "runtime", "venvs", name, "bin", "python" });
}

fn pathExists(io: Io, path: []const u8) bool {
    _ = std.Io.Dir.cwd().statFile(io, path, .{}) catch return false;
    return true;
}

fn run(allocator: std.mem.Allocator, io: Io, argv: []const []const u8) ?std.process.RunResult {
    return std.process.run(allocator, io, .{
        .argv = argv,
        .stdout_limit = .limited(64 * 1024),
        .stderr_limit = .limited(64 * 1024),
        .timeout = .{ .duration = .{ .clock = .awake, .raw = Io.Duration.fromSeconds(5) } },
    }) catch null;
}

fn successful(term: std.process.Child.Term) bool {
    return switch (term) {
        .exited => |code| code == 0,
        else => false,
    };
}

fn firstLine(value: []const u8) ?[]const u8 {
    var lines = std.mem.splitScalar(u8, value, '\n');
    while (lines.next()) |raw| {
        const line = std.mem.trim(u8, raw, " \t\r");
        if (line.len > 0) return line;
    }
    return null;
}

fn contains(values: []const []const u8, candidate: []const u8) bool {
    for (values) |value| if (std.mem.eql(u8, value, candidate)) return true;
    return false;
}
