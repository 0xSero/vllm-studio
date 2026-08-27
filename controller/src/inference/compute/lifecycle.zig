const std = @import("std");
const config_module = @import("../../app/config.zig");
const compute_instances = @import("instance_store.zig");
const instances = @import("../runtime/instance_store.zig");
const system_info = @import("../../system/platform/system_info.zig");
const compute_plan = @import("plan.zig");
const processes = @import("../runtime/processes.zig");
const telemetry = @import("../../system/telemetry.zig");

const Io = std.Io;
const max_active_launches = 64;
const placement_timeout = Io.Duration.fromSeconds(5);
const placement_retry = Io.Duration.fromMilliseconds(25);
const stop_grace = Io.Duration.fromSeconds(20);

const Cancellation = struct {
    allocator: std.mem.Allocator,
    name: []u8,
    requested: std.atomic.Value(bool) = .init(false),

    fn deinit(cancellation: *Cancellation) void {
        cancellation.allocator.free(cancellation.name);
        cancellation.allocator.destroy(cancellation);
    }
};

pub const Manager = struct {
    allocator: std.mem.Allocator,
    io: Io,
    directory: []u8,
    mutex: Io.Mutex = .init,
    children: Io.Group = .init,
    cancellations: std.StringHashMapUnmanaged(*Cancellation) = .empty,

    pub fn init(allocator: std.mem.Allocator, io: Io, data_dir: []const u8) !Manager {
        const directory = try compute_instances.directoryPath(allocator, data_dir);
        errdefer allocator.free(directory);
        const logs = try std.fs.path.join(allocator, &.{ directory, "logs" });
        defer allocator.free(logs);
        _ = try Io.Dir.cwd().createDirPathStatus(io, logs, @enumFromInt(0o700));
        try hardenDirectory(allocator, directory);
        try hardenDirectory(allocator, logs);
        return .{ .allocator = allocator, .io = io, .directory = directory };
    }

    pub fn deinit(manager: *Manager) void {
        manager.children.cancel(manager.io);
        var iterator = manager.cancellations.valueIterator();
        while (iterator.next()) |cancellation| cancellation.*.deinit();
        manager.cancellations.deinit(manager.allocator);
        manager.allocator.free(manager.directory);
        manager.* = undefined;
    }

    pub fn launchPayload(manager: *Manager, client: *std.http.Client, configuration: *const config_module.Config, system: *const system_info.Snapshot, request: *const compute_plan.Request) ![]u8 {
        var devices = try telemetry.placementDevices(manager.allocator, manager.io, system);
        defer devices.deinit();
        try validateSupport(system, devices.accelerator, request.engine, request.runtime);
        const cancellation = try manager.installCancellation(request.name);
        defer manager.removeCancellation(cancellation);

        try manager.mutex.lock(manager.io);
        var locked = true;
        defer if (locked) manager.mutex.unlock(manager.io);
        if (try compute_instances.read(manager.allocator, manager.io, manager.directory, request.name)) |existing_value| {
            var existing = existing_value;
            defer existing.deinit();
            const current_state = try manager.state(client, &existing);
            if (std.mem.eql(u8, current_state, "ready") or std.mem.eql(u8, current_state, "starting") or std.mem.eql(u8, current_state, "reserving")) return error.AlreadyRunning;
            _ = try manager.stopRecordLocked(&existing);
        }
        var placement_lock = try manager.acquirePlacementLock();
        var placement_lock_released = false;
        defer if (!placement_lock_released) manager.releasePlacementLock(&placement_lock);
        var all = try compute_instances.list(manager.allocator, manager.io, manager.directory);
        defer all.deinit();
        const need = @min(request.device_count, devices.ids.len);
        const selected = try manager.selectDevices(all.records, devices.ids, need, devices.shareable);
        defer manager.allocator.free(selected);
        const port = try manager.allocatePort(all.records, compute_plan.basePort(request.engine));
        var nonce_bytes: [16]u8 = undefined;
        manager.io.random(&nonce_bytes);
        const nonce_buffer = std.fmt.bytesToHex(nonce_bytes, .lower);
        var record = try compute_instances.createReservation(manager.allocator, manager.io, request.name, request.engine, request.recipe_id, request.runtime, port, selected, nonce_buffer[0..], readyTimeout(configuration, request.engine));
        defer record.deinit();
        try compute_instances.write(manager.io, manager.directory, &record);
        manager.releasePlacementLock(&placement_lock);
        placement_lock_released = true;
        var record_requires_cleanup = true;
        errdefer if (record_requires_cleanup) {
            if (locked) {
                manager.mutex.unlock(manager.io);
                locked = false;
            }
            manager.cleanupFailed(request.name);
        };
        if (cancellation.requested.load(.acquire)) return error.LaunchCancelled;

        var plan = try compute_plan.build(manager.allocator, manager.io, request, configuration, devices.accelerator, port);
        defer plan.deinit();
        const process_plan = switch (plan) {
            .process => |*value| value,
            .docker => return error.DockerRuntimeNotImplemented,
        };
        const log_path = try compute_instances.logPath(manager.allocator, manager.directory, request.name);
        defer manager.allocator.free(log_path);
        var log_file = try Io.Dir.cwd().createFile(manager.io, log_path, .{ .permissions = @enumFromInt(0o600) });
        defer log_file.close(manager.io);
        var environment = try configuration.environment.clone(manager.allocator);
        defer environment.deinit();
        for (process_plan.environment) |entry| try environment.put(entry.key, entry.value);
        try applyDeviceEnvironment(manager.allocator, &environment, devices.accelerator, selected);
        try environment.put("LOCAL_STUDIO_LAUNCH_NONCE", record.nonce);
        var child = try std.process.spawn(manager.io, .{
            .argv = process_plan.argv,
            .environ_map = &environment,
            .stdin = .ignore,
            .stdout = .{ .file = log_file },
            .stderr = .{ .file = log_file },
            .pgid = 0,
        });
        var child_transferred = false;
        errdefer if (!child_transferred) child.kill(manager.io);
        const pid: i32 = @intCast(child.id orelse return error.SpawnFailed);
        const reference = try captureProcess(manager, pid);
        defer if (reference.start_token) |token| manager.allocator.free(token);
        try compute_instances.setProcess(&record, reference);
        try compute_instances.write(manager.io, manager.directory, &record);
        try waitOwned(manager, &record);
        const reaper_name = try manager.allocator.dupe(u8, record.name);
        errdefer manager.allocator.free(reaper_name);
        const reaper_nonce = try manager.allocator.dupe(u8, record.nonce);
        errdefer manager.allocator.free(reaper_nonce);
        manager.children.concurrent(manager.io, reapChild, .{ manager, child, pid, reaper_name, reaper_nonce }) catch |failure| return failure;
        child_transferred = true;
        locked = false;
        manager.mutex.unlock(manager.io);

        while (!instances.timestampPassed(manager.io, record.ready_deadline_at)) {
            if (cancellation.requested.load(.acquire)) {
                _ = try manager.stop(record.name);
                return error.LaunchCancelled;
            }
            const current_value = try compute_instances.read(manager.allocator, manager.io, manager.directory, record.name) orelse return error.ProcessExitedEarly;
            var current = current_value;
            defer current.deinit();
            if (!recordOwned(manager, &current)) return error.ProcessExitedEarly;
            if (try healthy(manager.allocator, manager.io, client, current.port, healthPath(current.engine))) {
                record_requires_cleanup = false;
                const document = try compute_instances.payload(manager.allocator, &current);
                defer manager.allocator.free(document);
                return std.fmt.allocPrint(manager.allocator, "{{\"instance\":{s}}}", .{document});
            }
            try manager.io.sleep(.fromSeconds(2), .awake);
        }
        _ = try manager.stop(record.name);
        return error.ReadinessTimeout;
    }

    pub fn instancesPayload(manager: *Manager, client: *std.http.Client) ![]u8 {
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        var list = try compute_instances.list(manager.allocator, manager.io, manager.directory);
        defer list.deinit();
        var output: Io.Writer.Allocating = .init(manager.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"instances\":[");
        for (list.records, 0..) |*record, index| {
            if (index > 0) try output.writer.writeByte(',');
            const document = try compute_instances.payload(manager.allocator, record);
            defer manager.allocator.free(document);
            const state_value = try manager.state(client, record);
            try output.writer.print("{{\"record\":{s},\"state\":\"{s}\"}}", .{ document, state_value });
        }
        try output.writer.writeAll("]}");
        return output.toOwnedSlice();
    }

    pub fn stop(manager: *Manager, name: []const u8) !bool {
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        if (manager.cancellations.get(name)) |cancellation| cancellation.requested.store(true, .release);
        const record_value = try compute_instances.read(manager.allocator, manager.io, manager.directory, name) orelse return false;
        var record = record_value;
        defer record.deinit();
        return manager.stopRecordLocked(&record);
    }

    pub fn cancel(manager: *Manager, name: []const u8) !bool {
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        const record = try compute_instances.read(manager.allocator, manager.io, manager.directory, name) orelse return false;
        defer {
            var mutable = record;
            mutable.deinit();
        }
        if (manager.cancellations.get(name)) |cancellation| cancellation.requested.store(true, .release);
        return true;
    }

    pub fn cancelActive(manager: *Manager, name: []const u8) !bool {
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        const cancellation = manager.cancellations.get(name) orelse return false;
        cancellation.requested.store(true, .release);
        return true;
    }

    pub fn evictAll(manager: *Manager) !void {
        var list = try compute_instances.list(manager.allocator, manager.io, manager.directory);
        defer list.deinit();
        for (list.records) |record| {
            if (std.mem.eql(u8, record.name, "llm")) continue;
            _ = manager.stop(record.name) catch {};
        }
    }

    pub fn run(manager: *Manager) Io.Cancelable!void {
        while (true) {
            manager.superviseOnce() catch |failure| switch (failure) {
                error.Canceled => return error.Canceled,
                else => std.log.err("compute supervision failed: {t}", .{failure}),
            };
            try manager.io.sleep(.fromSeconds(2), .awake);
        }
    }

    fn superviseOnce(manager: *Manager) !void {
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        var list = try compute_instances.list(manager.allocator, manager.io, manager.directory);
        defer list.deinit();
        for (list.records) |*record| {
            if (std.mem.eql(u8, record.name, "llm")) continue;
            if (record.reference == null) {
                if (instances.timestampOlderThan(manager.io, record.started_at, 60)) try compute_instances.drop(manager.allocator, manager.io, manager.directory, record.name);
            } else if (processReference(record) != null and !recordOwned(manager, record)) try compute_instances.drop(manager.allocator, manager.io, manager.directory, record.name);
        }
    }

    fn state(manager: *Manager, client: *std.http.Client, record: *const compute_instances.Record) ![]const u8 {
        if (record.reference == null) return "reserving";
        if (processReference(record) != null and !recordOwned(manager, record)) return "exited";
        if (try healthy(manager.allocator, manager.io, client, record.port, healthPath(record.engine))) return "ready";
        return if (instances.timestampPassed(manager.io, record.ready_deadline_at)) "unhealthy" else "starting";
    }

    fn stopRecordLocked(manager: *Manager, record: *const compute_instances.Record) !bool {
        if (record.reference == null) {
            try compute_instances.drop(manager.allocator, manager.io, manager.directory, record.name);
            return true;
        }
        if (processReference(record) == null) return false;
        if (!recordOwned(manager, record)) {
            try compute_instances.drop(manager.allocator, manager.io, manager.directory, record.name);
            return true;
        }
        var legacy = record.legacyView();
        _ = try processes.terminateOwned(manager.allocator, manager.io, &legacy, .TERM);
        const deadline = Io.Clock.awake.now(manager.io).addDuration(stop_grace);
        while (Io.Clock.awake.now(manager.io).durationTo(deadline).toNanoseconds() > 0) {
            if (!recordOwned(manager, record)) break;
            try manager.io.sleep(.fromMilliseconds(200), .awake);
        }
        if (recordOwned(manager, record)) _ = try processes.terminateOwned(manager.allocator, manager.io, &legacy, .KILL);
        try compute_instances.drop(manager.allocator, manager.io, manager.directory, record.name);
        return !recordOwned(manager, record);
    }

    fn installCancellation(manager: *Manager, name: []const u8) !*Cancellation {
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        if (manager.cancellations.count() >= max_active_launches) return error.TooManyActiveLaunches;
        if (manager.cancellations.contains(name)) return error.AlreadyRunning;
        const cancellation = try manager.allocator.create(Cancellation);
        errdefer manager.allocator.destroy(cancellation);
        cancellation.* = .{ .allocator = manager.allocator, .name = try manager.allocator.dupe(u8, name) };
        errdefer manager.allocator.free(cancellation.name);
        try manager.cancellations.put(manager.allocator, cancellation.name, cancellation);
        return cancellation;
    }

    fn removeCancellation(manager: *Manager, cancellation: *Cancellation) void {
        manager.mutex.lock(manager.io) catch return;
        _ = manager.cancellations.remove(cancellation.name);
        manager.mutex.unlock(manager.io);
        cancellation.deinit();
    }

    fn selectDevices(manager: *Manager, records: []const compute_instances.Record, candidates: []const []const u8, need: usize, shareable: bool) ![]const []const u8 {
        var free: std.ArrayList([]const u8) = .empty;
        defer free.deinit(manager.allocator);
        for (candidates) |candidate| {
            var held = false;
            if (!shareable) for (records) |*record| {
                if (processReference(record) != null and !recordOwned(manager, record)) continue;
                for (record.devices) |device| if (std.mem.eql(u8, device, candidate)) {
                    held = true;
                    break;
                };
                if (held) break;
            };
            if (!held) try free.append(manager.allocator, candidate);
        }
        if (free.items.len < need) return error.NoCapacity;
        return manager.allocator.dupe([]const u8, free.items[0..need]);
    }

    fn allocatePort(manager: *Manager, records: []const compute_instances.Record, base: u16) !u16 {
        var candidate: u32 = base;
        while (candidate <= std.math.maxInt(u16)) : (candidate += 1) {
            const port: u16 = @intCast(candidate);
            var held = false;
            for (records) |record| if (record.port == port) {
                held = true;
                break;
            };
            if (!held and portBindable(manager.io, port)) return port;
        }
        return error.NoAvailablePort;
    }

    fn acquirePlacementLock(manager: *Manager) !Io.File {
        const path = try compute_instances.placementLockPath(manager.allocator, manager.directory);
        defer manager.allocator.free(path);
        const deadline = Io.Clock.awake.now(manager.io).addDuration(placement_timeout);
        while (Io.Clock.awake.now(manager.io).durationTo(deadline).toNanoseconds() > 0) {
            var file = Io.Dir.cwd().createFile(manager.io, path, .{ .exclusive = true, .permissions = @enumFromInt(0o600) }) catch |failure| switch (failure) {
                error.PathAlreadyExists => {
                    if (try lockStale(manager, path)) Io.Dir.cwd().deleteFile(manager.io, path) catch {};
                    try manager.io.sleep(placement_retry, .awake);
                    continue;
                },
                else => return failure,
            };
            errdefer file.close(manager.io);
            var buffer: [32]u8 = undefined;
            const pid = try std.fmt.bufPrint(&buffer, "{d}", .{currentProcessId()});
            try file.writeStreamingAll(manager.io, pid);
            return file;
        }
        return error.PlacementLockTimeout;
    }

    fn releasePlacementLock(manager: *Manager, file: *Io.File) void {
        file.close(manager.io);
        const path = compute_instances.placementLockPath(manager.allocator, manager.directory) catch return;
        defer manager.allocator.free(path);
        Io.Dir.cwd().deleteFile(manager.io, path) catch {};
    }

    fn cleanupFailed(manager: *Manager, name: []const u8) void {
        _ = manager.stop(name) catch {};
    }
};

fn reapChild(manager: *Manager, child_value: std.process.Child, pid: i32, name: []u8, nonce: []u8) Io.Cancelable!void {
    defer manager.allocator.free(name);
    defer manager.allocator.free(nonce);
    defer cleanupChildRecord(manager, pid, name, nonce);
    var child = child_value;
    defer child.kill(manager.io);
    _ = child.wait(manager.io) catch |failure| switch (failure) {
        error.Canceled => return error.Canceled,
        else => return,
    };
}

fn cleanupChildRecord(manager: *Manager, pid: i32, name: []const u8, nonce: []const u8) void {
    const previous = manager.io.swapCancelProtection(.blocked);
    defer _ = manager.io.swapCancelProtection(previous);
    manager.mutex.lock(manager.io) catch return;
    defer manager.mutex.unlock(manager.io);
    const record_value = compute_instances.read(manager.allocator, manager.io, manager.directory, name) catch return;
    if (record_value) |loaded| {
        var record = loaded;
        defer record.deinit();
        const reference = processReference(&record) orelse return;
        if (reference.pid == pid and std.mem.eql(u8, record.nonce, nonce)) compute_instances.drop(manager.allocator, manager.io, manager.directory, name) catch {};
    }
}

fn captureProcess(manager: *Manager, pid: i32) !instances.ProcessReference {
    var attempts: usize = 0;
    while (attempts < 20) : (attempts += 1) {
        if (processes.capture(manager.allocator, manager.io, pid)) |reference| return reference else |_| {}
        try manager.io.sleep(.fromMilliseconds(25), .awake);
    }
    return error.ProcessIdentityUnavailable;
}

fn recordOwned(manager: *Manager, record: *const compute_instances.Record) bool {
    var legacy = record.legacyView();
    return processes.owns(manager.allocator, manager.io, &legacy);
}

fn processReference(record: *const compute_instances.Record) ?instances.ProcessReference {
    const legacy = record.legacyView();
    return legacy.process;
}

fn waitOwned(manager: *Manager, record: *const compute_instances.Record) !void {
    var attempts: usize = 0;
    while (attempts < 20) : (attempts += 1) {
        if (recordOwned(manager, record)) return;
        try manager.io.sleep(.fromMilliseconds(25), .awake);
    }
    return error.ProcessIdentityUnavailable;
}

fn validateSupport(system: *const system_info.Snapshot, accelerator: []const u8, engine: []const u8, runtime: []const u8) !void {
    if (!std.mem.eql(u8, runtime, "process")) return error.DockerRuntimeNotImplemented;
    if (std.mem.eql(u8, engine, "mlx") and !system.apple_silicon) return error.UnsupportedEngine;
    if ((std.mem.eql(u8, engine, "vllm") or std.mem.eql(u8, engine, "sglang") or std.mem.eql(u8, engine, "exllamav3")) and !std.mem.eql(u8, accelerator, "cuda")) return error.UnsupportedEngine;
}

fn readyTimeout(configuration: *const config_module.Config, engine: []const u8) u64 {
    if (configuration.environment.get("LOCAL_STUDIO_READY_TIMEOUT_MS")) |value| {
        const milliseconds = std.fmt.parseInt(u64, value, 10) catch 0;
        if (milliseconds > 0) return @max((milliseconds + 999) / 1000, 1);
    }
    if (std.mem.eql(u8, engine, "vllm")) return 1800;
    if (std.mem.eql(u8, engine, "sglang") or std.mem.eql(u8, engine, "exllamav3")) return 900;
    if (std.mem.eql(u8, engine, "llamacpp")) return 600;
    return 300;
}

fn applyDeviceEnvironment(allocator: std.mem.Allocator, environment: *std.process.Environ.Map, accelerator: []const u8, devices: []const []const u8) !void {
    if (devices.len == 0 or std.mem.eql(u8, accelerator, "metal") or std.mem.eql(u8, accelerator, "cpu")) return;
    var joined: Io.Writer.Allocating = .init(allocator);
    defer joined.deinit();
    for (devices, 0..) |device, index| {
        if (index > 0) try joined.writer.writeByte(',');
        try joined.writer.writeAll(device);
    }
    if (std.mem.eql(u8, accelerator, "cuda")) try environment.put("CUDA_VISIBLE_DEVICES", joined.writer.buffered());
}

fn healthy(allocator: std.mem.Allocator, io: Io, client: *std.http.Client, port: u16, path: []const u8) !bool {
    const Selection = union(enum) { request: anyerror!bool, timer: Io.Cancelable!void };
    var selections: [2]Selection = undefined;
    var select = Io.Select(Selection).init(io, &selections);
    try select.concurrent(.request, fetchHealth, .{ allocator, client, port, path });
    select.concurrent(.timer, healthTimeout, .{io}) catch {
        select.cancelDiscard();
        return false;
    };
    const selected = try select.await();
    switch (selected) {
        .request => |result| {
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

fn fetchHealth(allocator: std.mem.Allocator, client: *std.http.Client, port: u16, path: []const u8) !bool {
    const url = try std.fmt.allocPrint(allocator, "http://127.0.0.1:{d}{s}", .{ port, path });
    defer allocator.free(url);
    const response = try client.fetch(.{ .location = .{ .url = url }, .redirect_behavior = .not_allowed, .keep_alive = false });
    return response.status.class() == .success;
}

fn healthTimeout(io: Io) Io.Cancelable!void {
    return io.sleep(.fromSeconds(3), .awake);
}

fn healthPath(engine: []const u8) []const u8 {
    return if (std.mem.eql(u8, engine, "mlx")) "/v1/models" else "/health";
}

fn portBindable(io: Io, port: u16) bool {
    const loopback = Io.net.IpAddress.parse("127.0.0.1", port) catch return false;
    var loopback_server = loopback.listen(io, .{ .reuse_address = false }) catch return false;
    loopback_server.deinit(io);
    const wildcard = Io.net.IpAddress.parse("0.0.0.0", port) catch return false;
    var wildcard_server = wildcard.listen(io, .{ .reuse_address = false }) catch return false;
    wildcard_server.deinit(io);
    return true;
}

fn lockStale(manager: *Manager, path: []const u8) !bool {
    const document = Io.Dir.cwd().readFileAlloc(manager.io, path, manager.allocator, .limited(64)) catch return false;
    defer manager.allocator.free(document);
    const pid = std.fmt.parseInt(i32, std.mem.trim(u8, document, " \t\r\n"), 10) catch return false;
    if (pid <= 0) return false;
    std.posix.kill(pid, @enumFromInt(0)) catch |failure| return switch (failure) {
        error.ProcessNotFound => true,
        else => false,
    };
    return false;
}

fn currentProcessId() i32 {
    return @intCast(std.c.getpid());
}

fn hardenDirectory(allocator: std.mem.Allocator, path: []const u8) !void {
    const path_z = try allocator.dupeZ(u8, path);
    defer allocator.free(path_z);
    if (std.c.chmod(path_z.ptr, 0o700) != 0) return error.PermissionHardeningFailed;
}
