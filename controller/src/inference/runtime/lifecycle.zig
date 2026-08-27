const std = @import("std");
const config_module = @import("../../app/config.zig");
const instances = @import("instance_store.zig");
const recipe_repository = @import("../recipes/store.zig");
const sqlite = @import("../../storage/sqlite.zig");
const launch_plan = @import("launch_plan.zig");
const processes = @import("processes.zig");
const recipes = @import("../recipes/service.zig");

const Io = std.Io;
const http = std.http;

pub const Supervisor = struct {
    allocator: std.mem.Allocator,
    io: Io,
    data_dir: []const u8,
    instance_path: []const u8,
    mutex: Io.Mutex = .init,
    children: Io.Group = .init,
    cancel_requested: std.atomic.Value(bool) = .init(false),

    pub fn init(allocator: std.mem.Allocator, io: Io, data_dir: []const u8, instance_path: []const u8) Supervisor {
        return .{
            .allocator = allocator,
            .io = io,
            .data_dir = data_dir,
            .instance_path = instance_path,
        };
    }

    pub fn deinit(supervisor: *Supervisor) void {
        supervisor.children.cancel(supervisor.io);
        supervisor.* = undefined;
    }

    pub fn launch(supervisor: *Supervisor, client: *http.Client, database: *sqlite.Database, recipe_column: recipe_repository.PayloadColumn, recipe_id: []const u8, configuration: *const config_module.Config) !void {
        const document = try recipes.detailPayload(supervisor.allocator, supervisor.io, database, recipe_column, recipe_id, configuration.default_trust_remote_code) orelse return error.RecipeNotFound;
        defer supervisor.allocator.free(document);
        var plan = try launch_plan.build(supervisor.allocator, supervisor.io, document, configuration);
        defer plan.deinit();

        try supervisor.mutex.lock(supervisor.io);
        var locked = true;
        defer if (locked) supervisor.mutex.unlock(supervisor.io);
        if (try instances.readLlm(supervisor.allocator, supervisor.io, supervisor.instance_path)) |record_value| {
            var record = record_value;
            defer record.deinit();
            if (processes.owns(supervisor.allocator, supervisor.io, &record)) return error.AlreadyRunning;
            try instances.dropLlm(supervisor.io, supervisor.instance_path);
        }

        var nonce_bytes: [16]u8 = undefined;
        supervisor.io.random(&nonce_bytes);
        const nonce_buffer = std.fmt.bytesToHex(nonce_bytes, .lower);
        const nonce = nonce_buffer[0..];
        supervisor.cancel_requested.store(false, .release);
        if (!portBindable(supervisor.io, plan.port)) return error.PortInUse;
        try instances.writeReservation(supervisor.io, supervisor.instance_path, plan.recipe_id, plan.backend, plan.port, nonce, plan.ready_timeout_seconds);
        var record_requires_cleanup = true;
        errdefer if (record_requires_cleanup) instances.dropLlm(supervisor.io, supervisor.instance_path) catch {};
        if (supervisor.cancel_requested.load(.acquire)) return error.LaunchCancelled;

        const logs_dir = try std.fs.path.join(supervisor.allocator, &.{ supervisor.data_dir, "instances", "logs" });
        defer supervisor.allocator.free(logs_dir);
        _ = try std.Io.Dir.cwd().createDirPathStatus(supervisor.io, logs_dir, @enumFromInt(0o700));
        const log_path = try std.fs.path.join(supervisor.allocator, &.{ logs_dir, "llm.log" });
        defer supervisor.allocator.free(log_path);
        var log_file = try std.Io.Dir.cwd().createFile(supervisor.io, log_path, .{ .permissions = @enumFromInt(0o600) });
        defer log_file.close(supervisor.io);

        var environment = try configuration.environment.clone(supervisor.allocator);
        defer environment.deinit();
        for (plan.environment) |entry| try environment.put(entry.key, entry.value);
        try environment.put("LOCAL_STUDIO_LAUNCH_NONCE", nonce);

        var child = try std.process.spawn(supervisor.io, .{
            .argv = plan.argv,
            .environ_map = &environment,
            .stdin = .ignore,
            .stdout = .{ .file = log_file },
            .stderr = .{ .file = log_file },
            .pgid = 0,
        });
        var child_transferred = false;
        errdefer if (!child_transferred) child.kill(supervisor.io);
        const pid: i32 = @intCast(child.id orelse return error.SpawnFailed);
        const reference = capture: {
            var attempts: usize = 0;
            while (attempts < 20) : (attempts += 1) {
                if (processes.capture(supervisor.allocator, supervisor.io, pid)) |captured| break :capture captured else |_| {}
                try supervisor.io.sleep(.fromMilliseconds(25), .awake);
            }
            return error.ProcessIdentityUnavailable;
        };
        defer if (reference.start_token) |token| supervisor.allocator.free(token);
        if (supervisor.cancel_requested.load(.acquire)) return error.LaunchCancelled;
        try instances.writeProcess(supervisor.io, supervisor.instance_path, plan.recipe_id, plan.backend, plan.port, nonce, reference, plan.ready_timeout_seconds);
        var ownership_attempts: usize = 0;
        while (ownership_attempts < 20) : (ownership_attempts += 1) {
            const record_value = try instances.readLlm(supervisor.allocator, supervisor.io, supervisor.instance_path) orelse return error.ProcessExitedEarly;
            var record = record_value;
            defer record.deinit();
            if (processes.owns(supervisor.allocator, supervisor.io, &record)) break;
            try supervisor.io.sleep(.fromMilliseconds(25), .awake);
        } else return error.ProcessIdentityUnavailable;

        const reaper_nonce = try supervisor.allocator.dupe(u8, nonce);
        supervisor.children.concurrent(supervisor.io, reapChild, .{ supervisor, child, pid, reaper_nonce }) catch |failure| {
            supervisor.allocator.free(reaper_nonce);
            return failure;
        };
        child_transferred = true;
        locked = false;
        supervisor.mutex.unlock(supervisor.io);

        const deadline = Io.Clock.awake.now(supervisor.io).addDuration(.fromSeconds(@intCast(plan.ready_timeout_seconds)));
        while (Io.Clock.awake.now(supervisor.io).durationTo(deadline).toNanoseconds() > 0) {
            if (supervisor.cancel_requested.load(.acquire)) {
                _ = try supervisor.evict();
                return error.LaunchCancelled;
            }
            const record_value = try instances.readLlm(supervisor.allocator, supervisor.io, supervisor.instance_path) orelse return error.ProcessExitedEarly;
            var record = record_value;
            defer record.deinit();
            if (!processes.owns(supervisor.allocator, supervisor.io, &record)) return error.ProcessExitedEarly;
            if (try healthy(supervisor.allocator, supervisor.io, client, record.port, plan.health_path)) {
                record_requires_cleanup = false;
                return;
            }
            try supervisor.io.sleep(.fromSeconds(2), .awake);
        }
        _ = try supervisor.evict();
        return error.ReadinessTimeout;
    }

    pub fn cancelLaunch(supervisor: *Supervisor) !bool {
        const record = try instances.readLlm(supervisor.allocator, supervisor.io, supervisor.instance_path) orelse return false;
        defer {
            var mutable = record;
            mutable.deinit();
        }
        supervisor.cancel_requested.store(true, .release);
        return true;
    }

    pub fn evict(supervisor: *Supervisor) !bool {
        try supervisor.mutex.lock(supervisor.io);
        defer supervisor.mutex.unlock(supervisor.io);
        const record_value = try instances.readLlm(supervisor.allocator, supervisor.io, supervisor.instance_path) orelse return false;
        var record = record_value;
        defer record.deinit();
        if (!processes.owns(supervisor.allocator, supervisor.io, &record)) {
            try instances.dropLlm(supervisor.io, supervisor.instance_path);
            return false;
        }
        _ = try processes.terminateOwned(supervisor.allocator, supervisor.io, &record, .TERM);
        var attempts: usize = 0;
        while (attempts < 100) : (attempts += 1) {
            if (!processes.owns(supervisor.allocator, supervisor.io, &record)) break;
            try supervisor.io.sleep(.fromMilliseconds(200), .awake);
        }
        if (processes.owns(supervisor.allocator, supervisor.io, &record)) _ = try processes.terminateOwned(supervisor.allocator, supervisor.io, &record, .KILL);
        try instances.dropLlm(supervisor.io, supervisor.instance_path);
        supervisor.cancel_requested.store(false, .release);
        return true;
    }

    pub fn waitReady(supervisor: *Supervisor, client: *http.Client, timeout_seconds: u64) !bool {
        const deadline = Io.Clock.awake.now(supervisor.io).addDuration(.fromSeconds(@intCast(timeout_seconds)));
        while (Io.Clock.awake.now(supervisor.io).durationTo(deadline).toNanoseconds() > 0) {
            const record_value = try instances.readLlm(supervisor.allocator, supervisor.io, supervisor.instance_path) orelse return false;
            var record = record_value;
            defer record.deinit();
            if (!processes.owns(supervisor.allocator, supervisor.io, &record)) return false;
            const health_path = if (std.mem.eql(u8, record.engine, "mlx")) "/v1/models" else "/health";
            if (try healthy(supervisor.allocator, supervisor.io, client, record.port, health_path)) return true;
            try supervisor.io.sleep(.fromSeconds(2), .awake);
        }
        return false;
    }

    pub fn instancesPayload(supervisor: *Supervisor, client: *http.Client) ![]u8 {
        try supervisor.mutex.lock(supervisor.io);
        defer supervisor.mutex.unlock(supervisor.io);
        const record_value = try instances.readLlm(supervisor.allocator, supervisor.io, supervisor.instance_path) orelse return try supervisor.allocator.dupe(u8, "{\"instances\":[]}");
        var record = record_value;
        defer record.deinit();
        const document = try instances.readDocument(supervisor.allocator, supervisor.io, supervisor.instance_path) orelse return try supervisor.allocator.dupe(u8, "{\"instances\":[]}");
        defer supervisor.allocator.free(document);
        const state: []const u8 = if (record.process == null)
            "reserving"
        else if (!processes.owns(supervisor.allocator, supervisor.io, &record))
            "exited"
        else if (try healthy(supervisor.allocator, supervisor.io, client, record.port, healthPath(record.engine)))
            "ready"
        else if (instances.timestampPassed(supervisor.io, record.ready_deadline_at))
            "unhealthy"
        else
            "starting";
        return try std.fmt.allocPrint(supervisor.allocator, "{{\"instances\":[{{\"record\":{s},\"state\":\"{s}\"}}]}}", .{ document, state });
    }

    pub fn statusPayload(supervisor: *Supervisor, database: *sqlite.Database, recipe_column: recipe_repository.PayloadColumn, inference_port: u16, default_trust_remote_code: bool) ![]u8 {
        try supervisor.mutex.lock(supervisor.io);
        defer supervisor.mutex.unlock(supervisor.io);
        const record_value = try instances.readLlm(supervisor.allocator, supervisor.io, supervisor.instance_path) orelse return try emptyStatusPayload(supervisor.allocator, inference_port);
        var record = record_value;
        defer record.deinit();
        if (record.process == null) {
            const Payload = struct {
                running: bool = false,
                process: ?u8 = null,
                inference_port: u16,
                launching: []const u8,
                launch_failures: []const std.json.Value = &.{},
            };
            return try stringifyOwned(supervisor.allocator, Payload{
                .inference_port = inference_port,
                .launching = record.recipe_id,
            });
        }
        if (!processes.owns(supervisor.allocator, supervisor.io, &record)) return try emptyStatusPayload(supervisor.allocator, inference_port);
        var metadata = try recipeMetadata(supervisor.allocator, supervisor.io, database, recipe_column, record.recipe_id, default_trust_remote_code);
        defer metadata.deinit();
        const Process = struct {
            pid: i32,
            backend: []const u8,
            model_path: ?[]const u8,
            port: u16,
            served_model_name: ?[]const u8,
        };
        const Payload = struct {
            running: bool = true,
            process: Process,
            inference_port: u16,
            launching: ?u8 = null,
            launch_failures: []const std.json.Value = &.{},
        };
        return try stringifyOwned(supervisor.allocator, Payload{
            .process = .{
                .pid = record.process.?.pid,
                .backend = record.engine,
                .model_path = metadata.model_path,
                .port = record.port,
                .served_model_name = metadata.served_model_name,
            },
            .inference_port = inference_port,
        });
    }

    pub fn stopNamed(supervisor: *Supervisor, name: []const u8) !bool {
        if (!std.mem.eql(u8, name, "llm")) return false;
        return supervisor.evict();
    }

    pub fn cancelNamed(supervisor: *Supervisor, name: []const u8) !bool {
        if (!std.mem.eql(u8, name, "llm")) return false;
        return supervisor.cancelLaunch();
    }

    pub fn isRunning(supervisor: *Supervisor) !bool {
        try supervisor.mutex.lock(supervisor.io);
        defer supervisor.mutex.unlock(supervisor.io);
        const record_value = try instances.readLlm(supervisor.allocator, supervisor.io, supervisor.instance_path) orelse return false;
        var record = record_value;
        defer record.deinit();
        return processes.owns(supervisor.allocator, supervisor.io, &record);
    }

    pub fn runningEngine(supervisor: *Supervisor, allocator: std.mem.Allocator) !?[]u8 {
        try supervisor.mutex.lock(supervisor.io);
        defer supervisor.mutex.unlock(supervisor.io);
        const record_value = try instances.readLlm(supervisor.allocator, supervisor.io, supervisor.instance_path) orelse return null;
        var record = record_value;
        defer record.deinit();
        if (!processes.owns(supervisor.allocator, supervisor.io, &record)) return null;
        return @as(?[]u8, try allocator.dupe(u8, record.engine));
    }

    pub fn run(supervisor: *Supervisor) Io.Cancelable!void {
        while (true) {
            supervisor.superviseOnce() catch |failure| switch (failure) {
                error.Canceled => return error.Canceled,
                else => std.log.err("instance supervision failed: {t}", .{failure}),
            };
            try supervisor.io.sleep(.fromSeconds(2), .awake);
        }
    }

    fn superviseOnce(supervisor: *Supervisor) !void {
        try supervisor.mutex.lock(supervisor.io);
        defer supervisor.mutex.unlock(supervisor.io);
        const record_value = try instances.readLlm(supervisor.allocator, supervisor.io, supervisor.instance_path) orelse return;
        var record = record_value;
        defer record.deinit();
        if (record.process == null) {
            if (instances.timestampOlderThan(supervisor.io, record.started_at, 60)) try instances.dropLlm(supervisor.io, supervisor.instance_path);
            return;
        }
        if (!processes.owns(supervisor.allocator, supervisor.io, &record)) try instances.dropLlm(supervisor.io, supervisor.instance_path);
    }
};

fn reapChild(supervisor: *Supervisor, child_value: std.process.Child, pid: i32, expected_nonce: []u8) Io.Cancelable!void {
    defer supervisor.allocator.free(expected_nonce);
    defer cleanupChildRecord(supervisor, pid, expected_nonce);
    var child = child_value;
    defer child.kill(supervisor.io);
    _ = child.wait(supervisor.io) catch |failure| switch (failure) {
        error.Canceled => return error.Canceled,
        else => return,
    };
}

fn cleanupChildRecord(supervisor: *Supervisor, pid: i32, expected_nonce: []const u8) void {
    const previous_protection = supervisor.io.swapCancelProtection(.blocked);
    defer _ = supervisor.io.swapCancelProtection(previous_protection);
    supervisor.mutex.lock(supervisor.io) catch return;
    defer supervisor.mutex.unlock(supervisor.io);
    const record_value = instances.readLlm(supervisor.allocator, supervisor.io, supervisor.instance_path) catch return;
    if (record_value) |loaded| {
        var record = loaded;
        defer record.deinit();
        const reference = record.process orelse return;
        if (reference.pid == pid and std.mem.eql(u8, record.nonce, expected_nonce)) {
            instances.dropLlm(supervisor.io, supervisor.instance_path) catch {};
        }
    }
}

fn healthy(allocator: std.mem.Allocator, io: Io, client: *http.Client, port: u16, path: []const u8) !bool {
    const FetchResult = anyerror!bool;
    const TimerResult = Io.Cancelable!void;
    const Selection = union(enum) {
        fetch: FetchResult,
        timer: TimerResult,
    };
    var selections: [2]Selection = undefined;
    var select = Io.Select(Selection).init(io, &selections);
    try select.concurrent(.fetch, fetchHealth, .{ allocator, client, port, path });
    select.concurrent(.timer, healthTimeout, .{io}) catch {
        select.cancelDiscard();
        return false;
    };
    const selected = try select.await();
    switch (selected) {
        .fetch => |result| {
            select.cancelDiscard();
            return result catch false;
        },
        .timer => |result| {
            result catch |failure| switch (failure) {
                error.Canceled => return error.Canceled,
            };
            select.cancelDiscard();
            return false;
        },
    }
}

fn healthPath(engine: []const u8) []const u8 {
    return if (std.mem.eql(u8, engine, "mlx")) "/v1/models" else "/health";
}

const RecipeMetadata = struct {
    allocator: std.mem.Allocator,
    model_path: ?[]u8 = null,
    served_model_name: ?[]u8 = null,

    fn deinit(metadata: *RecipeMetadata) void {
        if (metadata.model_path) |value| metadata.allocator.free(value);
        if (metadata.served_model_name) |value| metadata.allocator.free(value);
        metadata.* = undefined;
    }
};

fn recipeMetadata(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, recipe_column: recipe_repository.PayloadColumn, recipe_id: []const u8, default_trust_remote_code: bool) !RecipeMetadata {
    const document = recipes.detailPayload(allocator, io, database, recipe_column, recipe_id, default_trust_remote_code) catch return .{ .allocator = allocator };
    const recipe_document = document orelse return .{ .allocator = allocator };
    defer allocator.free(recipe_document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, recipe_document, .{}) catch return .{ .allocator = allocator };
    defer parsed.deinit();
    if (parsed.value != .object) return .{ .allocator = allocator };
    const model_path = optionalString(parsed.value.object, "model_path");
    const served_model_name = optionalString(parsed.value.object, "served_model_name");
    const owned_model_path = if (model_path) |value| try allocator.dupe(u8, value) else null;
    errdefer if (owned_model_path) |value| allocator.free(value);
    const owned_served_model_name = if (served_model_name) |value| try allocator.dupe(u8, value) else null;
    return .{
        .allocator = allocator,
        .model_path = owned_model_path,
        .served_model_name = owned_served_model_name,
    };
}

fn optionalString(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value == .null) return null;
    if (value != .string or value.string.len == 0) return null;
    return value.string;
}

fn emptyStatusPayload(allocator: std.mem.Allocator, inference_port: u16) ![]u8 {
    const Payload = struct {
        running: bool = false,
        process: ?u8 = null,
        inference_port: u16,
        launching: ?u8 = null,
        launch_failures: []const std.json.Value = &.{},
    };
    return stringifyOwned(allocator, Payload{ .inference_port = inference_port });
}

fn stringifyOwned(allocator: std.mem.Allocator, value: anytype) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(value, .{}, &output.writer);
    return try output.toOwnedSlice();
}

fn healthTimeout(io: Io) Io.Cancelable!void {
    return io.sleep(.fromSeconds(3), .awake);
}

fn fetchHealth(allocator: std.mem.Allocator, client: *http.Client, port: u16, path: []const u8) !bool {
    const url = try std.fmt.allocPrint(allocator, "http://127.0.0.1:{d}{s}", .{ port, path });
    defer allocator.free(url);
    var storage: [64 * 1024]u8 = undefined;
    var output: Io.Writer = .fixed(&storage);
    const response = client.fetch(.{
        .location = .{ .url = url },
        .method = .GET,
        .redirect_behavior = .unhandled,
        .keep_alive = false,
        .headers = .{ .accept_encoding = .omit },
        .response_writer = &output,
    }) catch return false;
    const status = @intFromEnum(response.status);
    return status >= 200 and status < 300;
}

fn portBindable(io: Io, port: u16) bool {
    for ([_][]const u8{ "127.0.0.1", "0.0.0.0" }) |host| {
        const address = std.Io.net.IpAddress.parse(host, port) catch return false;
        var listener = address.listen(io, .{ .reuse_address = true }) catch return false;
        listener.deinit(io);
    }
    return true;
}
