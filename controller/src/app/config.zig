const std = @import("std");
const studio_settings = @import("../system/settings/studio_store.zig");

pub const Mode = enum {
    head,
    worker,
    standalone,

    pub fn parse(value: []const u8) !Mode {
        return std.meta.stringToEnum(Mode, value) orelse error.InvalidControllerMode;
    }
};

pub const Config = struct {
    arena: std.heap.ArenaAllocator,
    mode: Mode,
    host: []const u8,
    port: u16,
    inference_host: []const u8,
    inference_port: u16,
    inference_origin: []const u8,
    data_dir: []const u8,
    db_path: []const u8,
    llm_instance_path: []const u8,
    models_dir: []const u8,
    api_key: ?[]const u8,
    sglang_python: ?[]const u8,
    llama_bin: ?[]const u8,
    mlx_python: ?[]const u8,
    environment: *const std.process.Environ.Map,
    default_trust_remote_code: bool,
    spike_upstream: ?[]const u8,
    spike_fallback_upstream: ?[]const u8,

    pub fn load(init: std.process.Init) !Config {
        var arena = std.heap.ArenaAllocator.init(init.gpa);
        errdefer arena.deinit();
        const allocator = arena.allocator();

        var mode_value = init.environ_map.get("LOCAL_STUDIO_CONTROLLER_MODE") orelse "standalone";
        var host_value = init.environ_map.get("LOCAL_STUDIO_HOST") orelse "127.0.0.1";
        var port_value = init.environ_map.get("LOCAL_STUDIO_PORT") orelse "8080";
        var arguments = try std.process.Args.Iterator.initAllocator(init.minimal.args, init.gpa);
        defer arguments.deinit();
        _ = arguments.skip();
        while (arguments.next()) |argument| {
            if (std.mem.eql(u8, argument, "--mode")) {
                mode_value = arguments.next() orelse return error.MissingArgumentValue;
            } else if (std.mem.eql(u8, argument, "--host")) {
                host_value = arguments.next() orelse return error.MissingArgumentValue;
            } else if (std.mem.eql(u8, argument, "--port")) {
                port_value = arguments.next() orelse return error.MissingArgumentValue;
            } else {
                return error.UnknownArgument;
            }
        }

        const cwd = try std.Io.Dir.cwd().realPathFileAlloc(init.io, ".", allocator);
        const data_dir = if (init.environ_map.get("LOCAL_STUDIO_DATA_DIR")) |configured|
            try absolutePath(allocator, cwd, configured)
        else
            try std.fs.path.join(allocator, &.{ cwd, "data" });
        const db_path = if (init.environ_map.get("LOCAL_STUDIO_DB_PATH")) |configured|
            if (std.mem.eql(u8, configured, ":memory:")) configured else try absolutePath(allocator, cwd, configured)
        else
            try std.fs.path.join(allocator, &.{ data_dir, "controller.db" });
        const llm_instance_path = try std.fs.path.join(allocator, &.{ data_dir, "instances", "llm.json" });
        const models_value = init.environ_map.get("LOCAL_STUDIO_MODELS_DIR") orelse "/models";
        const host = try allocator.dupe(u8, std.mem.trim(u8, host_value, " \t\r\n"));
        const inference_host = try allocator.dupe(u8, init.environ_map.get("LOCAL_STUDIO_INFERENCE_HOST") orelse "localhost");
        const inference_port = try parsePort(init.environ_map.get("LOCAL_STUDIO_INFERENCE_PORT") orelse "8000");
        const inference_origin = try std.fmt.allocPrint(allocator, "http://{s}:{d}", .{ inference_host, inference_port });
        var persisted = try studio_settings.load(init.gpa, init.io, data_dir);
        defer persisted.deinit();
        const models_dir = try absolutePath(allocator, cwd, persisted.models_dir orelse models_value);
        const api_key = try optionalOwned(allocator, init.environ_map.get("LOCAL_STUDIO_API_KEY"));
        if (api_key == null and !loopbackHost(host)) return error.ApiKeyRequiredForRemoteHost;
        const sglang_python = try optionalOwned(allocator, init.environ_map.get("LOCAL_STUDIO_SGLANG_PYTHON"));
        const llama_bin = try optionalOwned(allocator, init.environ_map.get("LOCAL_STUDIO_LLAMA_BIN"));
        const mlx_python = try optionalOwned(allocator, init.environ_map.get("LOCAL_STUDIO_MLX_PYTHON"));
        const spike_upstream = try optionalOwned(allocator, init.environ_map.get("LOCAL_STUDIO_ZIG_SPIKE_UPSTREAM"));
        const spike_fallback_upstream = try optionalOwned(allocator, init.environ_map.get("LOCAL_STUDIO_ZIG_SPIKE_FALLBACK_UPSTREAM"));

        return .{
            .arena = arena,
            .mode = try Mode.parse(mode_value),
            .host = host,
            .port = try parsePort(port_value),
            .inference_host = inference_host,
            .inference_port = inference_port,
            .inference_origin = inference_origin,
            .data_dir = data_dir,
            .db_path = db_path,
            .llm_instance_path = llm_instance_path,
            .models_dir = models_dir,
            .api_key = api_key,
            .sglang_python = sglang_python,
            .llama_bin = llama_bin,
            .mlx_python = mlx_python,
            .environment = init.environ_map,
            .default_trust_remote_code = !std.mem.eql(u8, init.environ_map.get("LOCAL_STUDIO_DEFAULT_TRUST_REMOTE_CODE") orelse "true", "false"),
            .spike_upstream = spike_upstream,
            .spike_fallback_upstream = spike_fallback_upstream,
        };
    }

    pub fn deinit(config: *Config) void {
        config.arena.deinit();
        config.* = undefined;
    }
};

fn absolutePath(allocator: std.mem.Allocator, cwd: []const u8, value: []const u8) ![]const u8 {
    return if (std.fs.path.isAbsolute(value))
        try allocator.dupe(u8, value)
    else
        try std.fs.path.resolve(allocator, &.{ cwd, value });
}

fn optionalOwned(allocator: std.mem.Allocator, value: ?[]const u8) !?[]const u8 {
    const candidate = std.mem.trim(u8, value orelse return null, " \t\r\n");
    return if (candidate.len == 0) null else try allocator.dupe(u8, candidate);
}

fn loopbackHost(host: []const u8) bool {
    return std.ascii.eqlIgnoreCase(host, "localhost") or std.mem.eql(u8, host, "127.0.0.1") or std.mem.eql(u8, host, "::1");
}

fn parsePort(value: []const u8) !u16 {
    const port = try std.fmt.parseInt(u16, value, 10);
    if (port == 0) return error.InvalidPort;
    return port;
}
