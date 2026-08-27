const std = @import("std");
const builtin = @import("builtin");
const config_module = @import("../../app/config.zig");
const runtime_info = @import("info.zig");

const max_finished_jobs = 50;
const max_jobs = 64;
const max_output_bytes = 8 * 1024 * 1024;
const max_output_tail = 4000;

pub const Options = struct {
    backend: []const u8,
    job_type: []const u8,
    target_id: ?[]const u8 = null,
    version: ?[]const u8 = null,
    prefer_bundled: ?bool = null,
};

const Status = enum { queued, running, success, failed, cancelled };

const Job = struct {
    allocator: std.mem.Allocator,
    id: []u8,
    backend: []u8,
    target_id: ?[]u8,
    version: ?[]u8,
    prefer_bundled: bool,
    job_type: []u8,
    status: Status,
    progress: f64,
    message: []u8,
    command: ?[]u8 = null,
    started_at: []u8,
    finished_at: ?[]u8 = null,
    output_tail: ?[]u8 = null,
    error_message: ?[]u8 = null,
    sequence: u64,
    active_handles: usize = 0,
    process_id: i32 = 0,
    group: std.Io.Group = .init,

    fn deinit(job: *Job) void {
        job.allocator.free(job.id);
        job.allocator.free(job.backend);
        if (job.target_id) |value| job.allocator.free(value);
        if (job.version) |value| job.allocator.free(value);
        job.allocator.free(job.job_type);
        job.allocator.free(job.message);
        if (job.command) |value| job.allocator.free(value);
        job.allocator.free(job.started_at);
        if (job.finished_at) |value| job.allocator.free(value);
        if (job.output_tail) |value| job.allocator.free(value);
        if (job.error_message) |value| job.allocator.free(value);
        job.allocator.destroy(job);
    }
};

pub const State = struct {
    allocator: std.mem.Allocator,
    io: std.Io,
    mutex: std.Io.Mutex = .init,
    jobs: std.StringHashMapUnmanaged(*Job) = .empty,
    next_sequence: std.atomic.Value(u64) = .init(1),

    pub fn init(allocator: std.mem.Allocator, io: std.Io) State {
        return .{ .allocator = allocator, .io = io };
    }

    pub fn deinit(state: *State) void {
        var pointers: [max_jobs]*Job = undefined;
        var count: usize = 0;
        state.mutex.lock(state.io) catch return;
        var iterator = state.jobs.valueIterator();
        while (iterator.next()) |job| {
            if (count < pointers.len) {
                pointers[count] = job.*;
                count += 1;
            }
        }
        state.mutex.unlock(state.io);
        for (pointers[0..count]) |job| {
            if (job.process_id > 0) signalProcessGroup(job.process_id, true);
            job.group.cancel(state.io);
        }
        for (pointers[0..count]) |job| job.deinit();
        state.jobs.deinit(state.allocator);
        state.* = undefined;
    }

    pub fn createPayload(state: *State, configuration: *const config_module.Config, cache: *runtime_info.Cache, options: Options, legacy: bool) ![]u8 {
        if (!validBackend(options.backend) or !validType(options.job_type)) return error.InvalidJobPayload;
        if (options.version) |version| if (!validVersion(version)) return error.InvalidJobPayload;
        try state.pruneFinished();
        const job = try state.createJob(options);
        var job_owned = true;
        defer if (job_owned) job.deinit();
        const response = try serializeEnvelope(state.allocator, job, legacy);
        errdefer state.allocator.free(response);
        try state.mutex.lock(state.io);
        var locked = true;
        defer if (locked) state.mutex.unlock(state.io);
        if (state.jobs.count() >= max_jobs) return error.TooManyRuntimeJobs;
        const entry = try state.jobs.getOrPut(state.allocator, job.id);
        if (entry.found_existing) {
            return error.JobIdentityCollision;
        }
        entry.value_ptr.* = job;
        job_owned = false;
        state.mutex.unlock(state.io);
        locked = false;
        job.group.concurrent(state.io, runJob, .{ state, configuration, cache, job.id }) catch |failure| {
            if (state.mutex.lock(state.io)) |_| {
                if (state.jobs.remove(job.id)) job_owned = true;
                state.mutex.unlock(state.io);
            } else |_| {}
            return failure;
        };
        return response;
    }

    pub fn listPayload(state: *State) ![]u8 {
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        const pointers = try state.allocator.alloc(*Job, state.jobs.count());
        defer state.allocator.free(pointers);
        var iterator = state.jobs.valueIterator();
        var index: usize = 0;
        while (iterator.next()) |job| : (index += 1) pointers[index] = job.*;
        std.mem.sort(*Job, pointers, {}, newerFirst);
        var output: std.Io.Writer.Allocating = .init(state.allocator);
        errdefer output.deinit();
        try output.writer.writeAll("{\"jobs\":[");
        for (pointers, 0..) |job, job_index| {
            if (job_index > 0) try output.writer.writeByte(',');
            try writeJob(&output.writer, job);
        }
        try output.writer.writeAll("]}");
        return output.toOwnedSlice();
    }

    pub fn onePayload(state: *State, id: []const u8) !?[]u8 {
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        const job = state.jobs.get(id) orelse return null;
        return @as(?[]u8, try serializeEnvelope(state.allocator, job, false));
    }

    pub fn cancelPayload(state: *State, id: []const u8) !?[]u8 {
        try state.mutex.lock(state.io);
        var locked = true;
        defer if (locked) state.mutex.unlock(state.io);
        const job = state.jobs.get(id) orelse {
            return null;
        };
        const should_cancel = job.status == .queued or job.status == .running;
        if (should_cancel) {
            try replaceString(job.allocator, &job.message, try job.allocator.dupe(u8, "cancelled by user"));
            job.status = .cancelled;
            job.progress = 1;
            try setOptionalString(job.allocator, &job.finished_at, try nowTimestamp(job.allocator, state.io));
            job.active_handles += 1;
        } else {
            return @as(?[]u8, try serializeEnvelope(state.allocator, job, false));
        }
        state.mutex.unlock(state.io);
        locked = false;
        if (job.process_id > 0) {
            signalProcessGroup(job.process_id, false);
            state.io.sleep(.fromSeconds(2), .awake) catch {};
            try state.mutex.lock(state.io);
            const current_process_id = job.process_id;
            if (current_process_id > 0) signalProcessGroup(current_process_id, true);
            state.mutex.unlock(state.io);
        }
        job.group.cancel(state.io);
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        const current = state.jobs.get(id) orelse return null;
        current.active_handles -= 1;
        return @as(?[]u8, try serializeEnvelope(state.allocator, current, false));
    }

    fn createJob(state: *State, options: Options) !*Job {
        const job = try state.allocator.create(Job);
        errdefer state.allocator.destroy(job);
        const id = try randomId(state.allocator, state.io);
        errdefer state.allocator.free(id);
        const backend = try state.allocator.dupe(u8, options.backend);
        errdefer state.allocator.free(backend);
        const target_id = if (options.target_id) |value| try state.allocator.dupe(u8, value) else null;
        errdefer if (target_id) |value| state.allocator.free(value);
        const version = if (options.version) |value| try state.allocator.dupe(u8, std.mem.trim(u8, value, " \t\r\n")) else null;
        errdefer if (version) |value| state.allocator.free(value);
        const job_type = try state.allocator.dupe(u8, options.job_type);
        errdefer state.allocator.free(job_type);
        const message = try std.fmt.allocPrint(state.allocator, "{s} queued for {s}", .{ options.job_type, options.backend });
        errdefer state.allocator.free(message);
        const started_at = try nowTimestamp(state.allocator, state.io);
        errdefer state.allocator.free(started_at);
        const sequence = state.next_sequence.fetchAdd(1, .monotonic);
        job.* = .{
            .allocator = state.allocator,
            .id = id,
            .backend = backend,
            .target_id = target_id,
            .version = version,
            .prefer_bundled = options.prefer_bundled orelse true,
            .job_type = job_type,
            .status = .queued,
            .progress = 0,
            .message = message,
            .started_at = started_at,
            .sequence = sequence,
        };
        return job;
    }

    fn pruneFinished(state: *State) !void {
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        while (finishedCount(state) > max_finished_jobs) {
            var oldest: ?*Job = null;
            var iterator = state.jobs.valueIterator();
            while (iterator.next()) |candidate| {
                if (!finished(candidate.*.status) or candidate.*.active_handles > 0) continue;
                if (oldest == null or candidate.*.sequence < oldest.?.sequence) oldest = candidate.*;
            }
            const job = oldest orelse break;
            _ = state.jobs.remove(job.id);
            job.group.cancel(state.io);
            job.deinit();
        }
    }
};

fn runJob(state: *State, configuration: *const config_module.Config, cache: *runtime_info.Cache, id: []const u8) void {
    runJobInner(state, configuration, cache, id) catch |failure| {
        if (failure == error.Canceled) {
            markCancelled(state, id);
        } else if (failure == error.RuntimeTargetNotFound) {
            markFailed(state, id, "Runtime target not found");
        } else if (failure == error.RuntimeTargetNotUpdatable) {
            markFailed(state, id, "Update is unsupported for this runtime target");
        } else if (failure == error.InstallLockTimeout) {
            markFailed(state, id, "Runtime install lock still present after 30 minutes");
        } else {
            markFailed(state, id, @errorName(failure));
        }
    };
}

fn runJobInner(state: *State, configuration: *const config_module.Config, cache: *runtime_info.Cache, id: []const u8) !void {
    const configured_command = command: {
        try state.mutex.lock(state.io);
        defer state.mutex.unlock(state.io);
        const job = state.jobs.get(id) orelse {
            return;
        };
        if (job.status != .queued) return;
        const message = try std.fmt.allocPrint(job.allocator, "{s} running for {s}", .{ job.job_type, job.backend });
        try replaceString(job.allocator, &job.message, message);
        job.status = .running;
        job.progress = 0.05;
        const environment_name = upgradeEnvironment(job.backend) orelse break :command null;
        const configured = configuration.environment.get(environment_name) orelse break :command null;
        const trimmed = std.mem.trim(u8, configured, " \t\r\n");
        if (trimmed.len == 0) break :command null;
        try setOptionalString(job.allocator, &job.command, try job.allocator.dupe(u8, trimmed));
        break :command try state.allocator.dupe(u8, trimmed);
    };
    const backend = try jobBackend(state, id);
    defer state.allocator.free(backend);
    var install_lock: ?std.Io.File = if (platformBackend(backend)) null else try acquireInstallLock(state, configuration, id, backend);
    defer if (install_lock) |*file| file.close(state.io);
    var operation_version: ?[]u8 = null;
    defer if (operation_version) |value| state.allocator.free(value);
    var operation_output: ?[]u8 = null;
    defer if (operation_output) |value| state.allocator.free(value);
    if (configured_command) |command| {
        defer state.allocator.free(command);
        const result = runCommand(state, configuration, id, &.{command}, 600) catch |failure| return commandFailure(state, id, failure, 10);
        defer state.allocator.free(result.stdout);
        defer state.allocator.free(result.stderr);
        const output = if (result.stdout.len > 0) result.stdout else result.stderr;
        if (!termSuccessful(result.term)) return markFailedWithOutput(state, id, if (result.stderr.len > 0) result.stderr else "Upgrade command failed", output);
        operation_output = try state.allocator.dupe(u8, output);
    } else if (managedPythonBackend(backend)) {
        const managed = try runManagedPythonInstall(state, configuration, id, backend) orelse return;
        operation_version = managed.version;
        operation_output = managed.output;
    } else if (std.mem.eql(u8, backend, "llamacpp")) {
        const managed = try runManagedLlamacppInstall(state, configuration, id) orelse return;
        operation_version = managed.version;
        operation_output = managed.output;
    } else {
        const environment_name = upgradeEnvironment(backend);
        const message = if (environment_name) |name|
            try std.fmt.allocPrint(state.allocator, "No {s} upgrade command configured. Set {s}.", .{ backend, name })
        else
            try std.fmt.allocPrint(state.allocator, "No {s} upgrade command configured.", .{backend});
        defer state.allocator.free(message);
        return markFailed(state, id, message);
    }
    try cache.invalidate();
    try state.mutex.lock(state.io);
    defer state.mutex.unlock(state.io);
    const job = state.jobs.get(id) orelse return;
    if (job.status != .running) return;
    const message = if (operation_version) |version|
        try std.fmt.allocPrint(job.allocator, "{s} complete ({s})", .{ job.job_type, version })
    else
        try std.fmt.allocPrint(job.allocator, "{s} complete", .{job.job_type});
    try replaceString(job.allocator, &job.message, message);
    job.status = .success;
    job.progress = 1;
    try setOptionalString(job.allocator, &job.finished_at, try nowTimestamp(job.allocator, state.io));
    if (operation_output) |output| if (tail(output)) |value| try setOptionalString(job.allocator, &job.output_tail, try job.allocator.dupe(u8, value));
}

const ManagedResult = struct {
    version: ?[]u8,
    output: ?[]u8,
};

fn runManagedPythonInstall(state: *State, configuration: *const config_module.Config, id: []const u8, backend: []const u8) !?ManagedResult {
    const target_python = try installPythonPath(state, configuration, id, backend);
    defer state.allocator.free(target_python.path);
    if (target_python.create_venv and !pathExists(state.io, target_python.path)) {
        const base_python = try resolveBasePython(state, configuration, id) orelse {
            markFailed(state, id, "Python 3 was not found on PATH");
            return null;
        };
        defer state.allocator.free(base_python);
        const venv_directory = std.fs.path.dirname(std.fs.path.dirname(target_python.path) orelse return error.InvalidManagedPythonPath) orelse return error.InvalidManagedPythonPath;
        const parent = std.fs.path.dirname(venv_directory) orelse return error.InvalidManagedPythonPath;
        _ = try std.Io.Dir.cwd().createDirPathStatus(state.io, parent, @enumFromInt(0o700));
        const command = try renderCommand(state.allocator, &.{ base_python, "-m", "venv", venv_directory });
        defer state.allocator.free(command);
        try updateJobStage(state, id, 0.1, try std.fmt.allocPrint(state.allocator, "Creating {s} virtual environment...", .{backend}), command, null);
        const create = runCommand(state, configuration, id, &.{ base_python, "-m", "venv", venv_directory }, 600) catch |failure| {
            commandFailure(state, id, failure, 10);
            return null;
        };
        defer state.allocator.free(create.stdout);
        defer state.allocator.free(create.stderr);
        if (!termSuccessful(create.term)) {
            const message = if (create.stderr.len > 0) create.stderr else "Failed to create managed virtual environment";
            markFailedWithOutput(state, id, message, if (create.stdout.len > 0) create.stdout else message);
            return null;
        }
        if (!pathExists(state.io, target_python.path)) {
            markFailed(state, id, "Managed virtual environment did not create its Python executable");
            return null;
        }
    }
    const requested_version = try jobVersion(state, id);
    defer if (requested_version) |value| state.allocator.free(value);
    const package_spec = try managedPackageSpec(state.allocator, state.io, backend, requested_version, try jobPreferBundled(state, id));
    defer state.allocator.free(package_spec);
    const installer = try resolveInstaller(state, configuration, id, target_python.path, package_spec) orelse return null;
    defer installer.deinit(state.allocator);
    const display = try renderCommand(state.allocator, installer.argv);
    defer state.allocator.free(display);
    const message = try std.fmt.allocPrint(state.allocator, "Installing {s} with {s}...", .{ package_spec, installer.name });
    try updateJobStage(state, id, 0.2, message, display, null);
    const install = runCommand(state, configuration, id, installer.argv, 1800) catch |failure| {
        commandFailure(state, id, failure, 30);
        return null;
    };
    defer state.allocator.free(install.stdout);
    defer state.allocator.free(install.stderr);
    const install_output = if (install.stdout.len > 0) install.stdout else install.stderr;
    if (!termSuccessful(install.term)) {
        const failure_message = if (install.stderr.len > 0) install.stderr else "Runtime package installation failed";
        markFailedWithOutput(state, id, failure_message, install_output);
        return null;
    }
    try updateJobStage(state, id, 0.92, try std.fmt.allocPrint(state.allocator, "Verifying {s} runtime...", .{backend}), null, tail(install_output));
    const probe_script = if (std.mem.eql(u8, backend, "vllm"))
        "import importlib.metadata as m; import vllm; print(m.version('vllm'))"
    else if (std.mem.eql(u8, backend, "sglang"))
        "import importlib.metadata as m; import sglang; print(m.version('sglang'))"
    else
        "import importlib.metadata as m; import mlx_lm; print(m.version('mlx-lm'))";
    const probe = runCommand(state, configuration, id, &.{ target_python.path, "-c", probe_script }, 10) catch |failure| {
        commandFailure(state, id, failure, 1);
        return null;
    };
    defer state.allocator.free(probe.stdout);
    defer state.allocator.free(probe.stderr);
    if (!termSuccessful(probe.term)) {
        const failure_message = if (probe.stderr.len > 0) probe.stderr else "Runtime import probe failed";
        markFailedWithOutput(state, id, failure_message, failure_message);
        return null;
    }
    const version = if (firstLine(probe.stdout)) |value| try state.allocator.dupe(u8, value) else null;
    const output = if (install_output.len > 0) try state.allocator.dupe(u8, install_output) else null;
    return .{ .version = version, .output = output };
}

fn runManagedLlamacppInstall(state: *State, configuration: *const config_module.Config, id: []const u8) !?ManagedResult {
    for ([_][]const u8{ "git", "cmake" }) |tool| {
        const probe = runCommand(state, configuration, id, &.{ tool, "--version" }, 10) catch |failure| {
            if (failure == error.Canceled) return error.Canceled;
            const message = try std.fmt.allocPrint(state.allocator, "llama.cpp source build needs \"{s}\" on PATH. Install it or configure LOCAL_STUDIO_LLAMACPP_UPGRADE_CMD.", .{tool});
            defer state.allocator.free(message);
            markFailed(state, id, message);
            return null;
        };
        defer state.allocator.free(probe.stdout);
        defer state.allocator.free(probe.stderr);
        if (!termSuccessful(probe.term)) {
            const message = try std.fmt.allocPrint(state.allocator, "llama.cpp source build needs \"{s}\" on PATH. Install it or configure LOCAL_STUDIO_LLAMACPP_UPGRADE_CMD.", .{tool});
            defer state.allocator.free(message);
            markFailed(state, id, message);
            return null;
        }
    }
    const root = try std.fs.path.join(state.allocator, &.{ configuration.data_dir, "runtime", "llamacpp" });
    defer state.allocator.free(root);
    const source = try std.fs.path.join(state.allocator, &.{ root, "src" });
    defer state.allocator.free(source);
    _ = try std.Io.Dir.cwd().createDirPathStatus(state.io, root, @enumFromInt(0o700));
    if (!pathExists(state.io, source)) {
        const clone_argv = &.{ "git", "clone", "--depth", "1", "https://github.com/ggml-org/llama.cpp", source };
        const display = try renderCommand(state.allocator, clone_argv);
        defer state.allocator.free(display);
        try updateJobStage(state, id, 0.1, try state.allocator.dupe(u8, "Cloning llama.cpp source..."), display, null);
        const clone = runCommandIn(state, configuration.environment, id, clone_argv, 2700, null) catch |failure| {
            commandFailure(state, id, failure, 45);
            return null;
        };
        defer state.allocator.free(clone.stdout);
        defer state.allocator.free(clone.stderr);
        if (!termSuccessful(clone.term)) {
            const message = if (clone.stderr.len > 0) clone.stderr else "git clone failed";
            markFailedWithOutput(state, id, message, if (clone.stdout.len > 0) clone.stdout else message);
            return null;
        }
    } else {
        const pull: ?CommandResult = runCommandIn(state, configuration.environment, id, &.{ "git", "-C", source, "pull", "--ff-only" }, 2700, null) catch |failure| pull: {
            if (failure == error.Canceled) return error.Canceled;
            break :pull null;
        };
        if (pull) |result| {
            state.allocator.free(result.stdout);
            state.allocator.free(result.stderr);
        }
    }
    var build_environment = try configuration.environment.clone(state.allocator);
    defer build_environment.deinit();
    const nvcc = try resolveNvcc(state, configuration, id);
    defer if (nvcc) |value| state.allocator.free(value);
    if (nvcc) |value| try build_environment.put("CUDACXX", value);
    var configure_argv: std.ArrayList([]const u8) = .empty;
    defer configure_argv.deinit(state.allocator);
    try configure_argv.appendSlice(state.allocator, &.{ "cmake", "-B", "build", "-DCMAKE_BUILD_TYPE=Release", "-DLLAMA_CURL=OFF", "-DLLAMA_BUILD_TESTS=OFF", "-DLLAMA_BUILD_EXAMPLES=OFF" });
    if (nvcc != null) try configure_argv.append(state.allocator, "-DGGML_CUDA=ON");
    const configure_display = try renderCommand(state.allocator, configure_argv.items);
    defer state.allocator.free(configure_display);
    try updateJobStage(state, id, 0.35, try state.allocator.dupe(u8, "Configuring llama.cpp..."), configure_display, null);
    const configure = runCommandIn(state, &build_environment, id, configure_argv.items, 2700, source) catch |failure| {
        commandFailure(state, id, failure, 45);
        return null;
    };
    defer state.allocator.free(configure.stdout);
    defer state.allocator.free(configure.stderr);
    if (!termSuccessful(configure.term)) {
        const message = if (configure.stderr.len > 0) configure.stderr else "cmake configure failed";
        markFailedWithOutput(state, id, message, if (configure.stdout.len > 0) configure.stdout else message);
        return null;
    }
    const cpu_count = std.Thread.getCpuCount() catch 1;
    const jobs = try std.fmt.allocPrint(state.allocator, "{d}", .{@max(cpu_count -| 1, 1)});
    defer state.allocator.free(jobs);
    const build_argv = &.{ "cmake", "--build", "build", "--target", "llama-server", "-j", jobs };
    const build_display = try renderCommand(state.allocator, build_argv);
    defer state.allocator.free(build_display);
    try updateJobStage(state, id, 0.65, try state.allocator.dupe(u8, "Building llama-server..."), build_display, null);
    const build = runCommandIn(state, &build_environment, id, build_argv, 2700, source) catch |failure| {
        commandFailure(state, id, failure, 45);
        return null;
    };
    defer state.allocator.free(build.stdout);
    defer state.allocator.free(build.stderr);
    const build_output = if (build.stdout.len > 0) build.stdout else build.stderr;
    if (!termSuccessful(build.term)) {
        const message = if (build.stderr.len > 0) build.stderr else "cmake build failed";
        markFailedWithOutput(state, id, message, build_output);
        return null;
    }
    const binary = try std.fs.path.join(state.allocator, &.{ source, "build", "bin", "llama-server" });
    defer state.allocator.free(binary);
    if (!pathExists(state.io, binary)) {
        const message = try std.fmt.allocPrint(state.allocator, "Build finished but {s} was not produced", .{binary});
        defer state.allocator.free(message);
        markFailedWithOutput(state, id, message, build_output);
        return null;
    }
    const version_probe = runCommand(state, configuration, id, &.{ binary, "--version" }, 30) catch null;
    var version: ?[]u8 = null;
    if (version_probe) |probe| {
        defer state.allocator.free(probe.stdout);
        defer state.allocator.free(probe.stderr);
        const text = firstLine(probe.stdout) orelse firstLine(probe.stderr);
        if (termSuccessful(probe.term) and text != null) version = try state.allocator.dupe(u8, text.?);
    }
    const output = try std.fmt.allocPrint(state.allocator, "Built llama-server at {s}", .{binary});
    return .{ .version = version, .output = output };
}

fn resolveNvcc(state: *State, configuration: *const config_module.Config, id: []const u8) !?[]u8 {
    for ([_][]const u8{ "nvcc", "/usr/local/cuda/bin/nvcc" }) |candidate| {
        const probe = runCommand(state, configuration, id, &.{ candidate, "--version" }, 10) catch |failure| switch (failure) {
            error.Canceled => return error.Canceled,
            else => continue,
        };
        defer state.allocator.free(probe.stdout);
        defer state.allocator.free(probe.stderr);
        if (termSuccessful(probe.term)) return @as(?[]u8, try state.allocator.dupe(u8, candidate));
    }
    return null;
}

const PythonTarget = struct { path: []u8, create_venv: bool };

fn installPythonPath(state: *State, configuration: *const config_module.Config, id: []const u8, backend: []const u8) !PythonTarget {
    const target_id = try jobTargetId(state, id);
    defer if (target_id) |value| state.allocator.free(value);
    if (target_id) |value| {
        const prefix = try std.fmt.allocPrint(state.allocator, "{s}:", .{backend});
        defer state.allocator.free(prefix);
        if (!std.mem.startsWith(u8, value, prefix)) return error.RuntimeTargetNotFound;
        const identity = value[prefix.len..];
        const separator = std.mem.indexOfScalar(u8, identity, ':') orelse return error.RuntimeTargetNotFound;
        const kind = identity[0..separator];
        if (!std.mem.eql(u8, kind, "venv") and !std.mem.eql(u8, kind, "system")) return error.RuntimeTargetNotUpdatable;
        const encoded = identity[separator + 1 ..];
        const size = std.base64.url_safe_no_pad.Decoder.calcSizeForSlice(encoded) catch return error.RuntimeTargetNotFound;
        if (size == 0) return error.RuntimeTargetNotFound;
        const decoded = try state.allocator.alloc(u8, size);
        errdefer state.allocator.free(decoded);
        std.base64.url_safe_no_pad.Decoder.decode(decoded, encoded) catch return error.RuntimeTargetNotFound;
        const executable_name = std.fs.path.basename(decoded);
        if (!std.fs.path.isAbsolute(decoded) or !std.mem.startsWith(u8, executable_name, "python") or !pathExists(state.io, decoded)) return error.RuntimeTargetNotFound;
        return .{ .path = decoded, .create_venv = false };
    }
    const name = try std.fmt.allocPrint(state.allocator, "{s}-latest", .{backend});
    defer state.allocator.free(name);
    return .{ .path = try std.fs.path.join(state.allocator, &.{ configuration.data_dir, "runtime", "venvs", name, "bin", "python" }), .create_venv = true };
}

const Installer = struct {
    argv: [][]const u8,
    name: []const u8,

    fn deinit(installer: Installer, allocator: std.mem.Allocator) void {
        allocator.free(installer.argv);
    }
};

fn resolveInstaller(state: *State, configuration: *const config_module.Config, id: []const u8, python: []const u8, package_spec: []const u8) !?Installer {
    const uv_probe = runCommand(state, configuration, id, &.{ "uv", "--version" }, 10) catch |failure| switch (failure) {
        error.Canceled => return error.Canceled,
        else => null,
    };
    if (uv_probe) |probe| {
        defer state.allocator.free(probe.stdout);
        defer state.allocator.free(probe.stderr);
        if (termSuccessful(probe.term)) {
            const argv = try state.allocator.alloc([]const u8, 7);
            @memcpy(argv, &[_][]const u8{ "uv", "pip", "install", "--python", python, "--upgrade", package_spec });
            return .{ .argv = argv, .name = "uv" };
        }
    }
    const pip_probe = runCommand(state, configuration, id, &.{ python, "-m", "pip", "--version" }, 10) catch |failure| {
        if (failure == error.Canceled) return error.Canceled;
        markFailed(state, id, "Neither uv nor a working pip is available. Install uv with: curl -LsSf https://astral.sh/uv/install.sh | sh");
        return null;
    };
    defer state.allocator.free(pip_probe.stdout);
    defer state.allocator.free(pip_probe.stderr);
    if (!termSuccessful(pip_probe.term)) {
        markFailed(state, id, "Neither uv nor a working pip is available. Install uv with: curl -LsSf https://astral.sh/uv/install.sh | sh");
        return null;
    }
    const argv = try state.allocator.alloc([]const u8, 6);
    @memcpy(argv, &[_][]const u8{ python, "-m", "pip", "install", "--upgrade", package_spec });
    return .{ .argv = argv, .name = "pip" };
}

fn resolveBasePython(state: *State, configuration: *const config_module.Config, id: []const u8) !?[]u8 {
    const configured = if (configuration.environment.get("LOCAL_STUDIO_RUNTIME_PYTHON")) |value| std.mem.trim(u8, value, " \t\r\n") else "";
    const candidates = [_][]const u8{ configured, "python3", "python" };
    for (candidates) |candidate| {
        if (candidate.len == 0) continue;
        const probe = runCommand(state, configuration, id, &.{ candidate, "--version" }, 10) catch |failure| switch (failure) {
            error.Canceled => return error.Canceled,
            else => continue,
        };
        defer state.allocator.free(probe.stdout);
        defer state.allocator.free(probe.stderr);
        if (termSuccessful(probe.term)) return try state.allocator.dupe(u8, candidate);
    }
    return null;
}

fn managedPackageSpec(allocator: std.mem.Allocator, io: std.Io, backend: []const u8, version: ?[]const u8, prefer_bundled: bool) ![]u8 {
    if (std.mem.eql(u8, backend, "vllm") and prefer_bundled) if (try newestBundledWheel(allocator, io)) |wheel| return wheel;
    if (std.mem.eql(u8, backend, "mlx")) return allocator.dupe(u8, "mlx-lm");
    const package = if (std.mem.eql(u8, backend, "vllm")) "vllm" else "sglang[all]";
    return if (version) |value| std.fmt.allocPrint(allocator, "{s}=={s}", .{ package, value }) else allocator.dupe(u8, package);
}

fn newestBundledWheel(allocator: std.mem.Allocator, io: std.Io) !?[]u8 {
    const root = try std.fs.path.resolve(allocator, &.{ "runtime", "wheels" });
    defer allocator.free(root);
    var directory = std.Io.Dir.cwd().openDir(io, root, .{ .iterate = true }) catch |failure| switch (failure) {
        error.FileNotFound, error.NotDir => return null,
        else => return failure,
    };
    defer directory.close(io);
    var latest_name: ?[]u8 = null;
    defer if (latest_name) |value| allocator.free(value);
    var latest_time: i128 = std.math.minInt(i128);
    var iterator = directory.iterateAssumeFirstIteration();
    while (try iterator.next(io)) |entry| {
        if (entry.kind != .file or !std.mem.startsWith(u8, entry.name, "vllm-") or !std.mem.endsWith(u8, entry.name, ".whl")) continue;
        const path = try std.fs.path.join(allocator, &.{ root, entry.name });
        defer allocator.free(path);
        const stat = try std.Io.Dir.cwd().statFile(io, path, .{});
        if (stat.mtime.nanoseconds <= latest_time) continue;
        if (latest_name) |value| allocator.free(value);
        latest_name = try allocator.dupe(u8, entry.name);
        latest_time = stat.mtime.nanoseconds;
    }
    const name = latest_name orelse return null;
    return try std.fs.path.join(allocator, &.{ root, name });
}

fn acquireInstallLock(state: *State, configuration: *const config_module.Config, id: []const u8, backend: []const u8) !std.Io.File {
    const lock_directory = try std.fs.path.join(state.allocator, &.{ configuration.data_dir, "runtime", "locks" });
    defer state.allocator.free(lock_directory);
    _ = try std.Io.Dir.cwd().createDirPathStatus(state.io, lock_directory, @enumFromInt(0o700));
    const lock_name = try std.fmt.allocPrint(state.allocator, "{s}.install.lock", .{backend});
    defer state.allocator.free(lock_name);
    const lock_path = try std.fs.path.join(state.allocator, &.{ lock_directory, lock_name });
    defer state.allocator.free(lock_path);
    const deadline = std.Io.Clock.awake.now(state.io).addDuration(.fromSeconds(1800));
    var waiting_reported = false;
    while (std.Io.Clock.awake.now(state.io).durationTo(deadline).toNanoseconds() > 0) {
        if (!try jobIsRunning(state, id)) return error.Canceled;
        var file = std.Io.Dir.cwd().createFile(state.io, lock_path, .{ .read = true, .truncate = false, .lock = .exclusive, .lock_nonblocking = true, .permissions = @enumFromInt(0o600) }) catch |failure| switch (failure) {
            error.WouldBlock => {
                if (!waiting_reported) {
                    waiting_reported = true;
                    try updateJobStage(state, id, 0.05, try std.fmt.allocPrint(state.allocator, "waiting for in-progress {s} install...", .{backend}), null, null);
                }
                try state.io.sleep(.fromSeconds(3), .awake);
                continue;
            },
            else => return failure,
        };
        errdefer file.close(state.io);
        const record = try std.fmt.allocPrint(state.allocator, "{{\"backend\":\"{s}\",\"pid\":{d}}}", .{ backend, currentProcessId() });
        defer state.allocator.free(record);
        try file.setLength(state.io, 0);
        try file.writePositionalAll(state.io, record, 0);
        return file;
    }
    return error.InstallLockTimeout;
}

fn updateJobStage(state: *State, id: []const u8, progress: f64, message: []u8, command: ?[]const u8, output: ?[]const u8) !void {
    var message_owned = true;
    defer if (message_owned) state.allocator.free(message);
    try state.mutex.lock(state.io);
    defer state.mutex.unlock(state.io);
    const job = state.jobs.get(id) orelse return error.Canceled;
    if (job.status != .running) return error.Canceled;
    try replaceString(job.allocator, &job.message, message);
    message_owned = false;
    job.progress = progress;
    if (command) |value| try setOptionalString(job.allocator, &job.command, try job.allocator.dupe(u8, value));
    if (output) |value| try setOptionalString(job.allocator, &job.output_tail, try job.allocator.dupe(u8, value));
}

fn renderCommand(allocator: std.mem.Allocator, argv: []const []const u8) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    for (argv, 0..) |argument, index| {
        if (index > 0) try output.writer.writeByte(' ');
        try output.writer.writeAll(argument);
    }
    return output.toOwnedSlice();
}

fn jobBackend(state: *State, id: []const u8) ![]u8 {
    try state.mutex.lock(state.io);
    defer state.mutex.unlock(state.io);
    const job = state.jobs.get(id) orelse return error.Canceled;
    return state.allocator.dupe(u8, job.backend);
}

fn jobTargetId(state: *State, id: []const u8) !?[]u8 {
    try state.mutex.lock(state.io);
    defer state.mutex.unlock(state.io);
    const job = state.jobs.get(id) orelse return error.Canceled;
    return if (job.target_id) |value| try state.allocator.dupe(u8, value) else null;
}

fn jobVersion(state: *State, id: []const u8) !?[]u8 {
    try state.mutex.lock(state.io);
    defer state.mutex.unlock(state.io);
    const job = state.jobs.get(id) orelse return error.Canceled;
    return if (job.version) |value| try state.allocator.dupe(u8, value) else null;
}

fn jobPreferBundled(state: *State, id: []const u8) !bool {
    try state.mutex.lock(state.io);
    defer state.mutex.unlock(state.io);
    return (state.jobs.get(id) orelse return error.Canceled).prefer_bundled;
}

fn jobIsRunning(state: *State, id: []const u8) !bool {
    try state.mutex.lock(state.io);
    defer state.mutex.unlock(state.io);
    const job = state.jobs.get(id) orelse return false;
    return job.status == .running;
}

fn commandFailure(state: *State, id: []const u8, failure: anyerror, timeout_minutes: u32) void {
    if (failure == error.Canceled) return markCancelled(state, id);
    if (failure == error.Timeout) {
        var buffer: [96]u8 = undefined;
        const message = std.fmt.bufPrint(&buffer, "Runtime command timed out after {d} minutes", .{timeout_minutes}) catch "Runtime command timed out";
        return markFailed(state, id, message);
    }
    if (failure == error.StreamTooLong) return markFailed(state, id, "Runtime command output exceeded 8 MiB");
    return markFailed(state, id, @errorName(failure));
}

fn termSuccessful(term: std.process.Child.Term) bool {
    return switch (term) {
        .exited => |code| code == 0,
        else => false,
    };
}

fn managedPythonBackend(backend: []const u8) bool {
    return std.mem.eql(u8, backend, "vllm") or std.mem.eql(u8, backend, "sglang") or std.mem.eql(u8, backend, "mlx");
}

fn platformBackend(backend: []const u8) bool {
    return std.mem.eql(u8, backend, "cuda") or std.mem.eql(u8, backend, "rocm");
}

fn pathExists(io: std.Io, path: []const u8) bool {
    _ = std.Io.Dir.cwd().statFile(io, path, .{}) catch return false;
    return true;
}

fn firstLine(value: []const u8) ?[]const u8 {
    var lines = std.mem.splitScalar(u8, value, '\n');
    while (lines.next()) |raw| {
        const line = std.mem.trim(u8, raw, " \t\r");
        if (line.len > 0) return line;
    }
    return null;
}

fn currentProcessId() i32 {
    return switch (builtin.os.tag) {
        .windows => 0,
        else => @intCast(std.c.getpid()),
    };
}

const CommandResult = struct {
    term: std.process.Child.Term,
    stdout: []u8,
    stderr: []u8,
};

fn runCommand(state: *State, configuration: *const config_module.Config, id: []const u8, argv: []const []const u8, timeout_seconds: i64) !CommandResult {
    return runCommandIn(state, configuration.environment, id, argv, timeout_seconds, null);
}

fn runCommandIn(state: *State, environment: *const std.process.Environ.Map, id: []const u8, argv: []const []const u8, timeout_seconds: i64, cwd: ?[]const u8) !CommandResult {
    var child = try std.process.spawn(state.io, .{
        .argv = argv,
        .environ_map = environment,
        .cwd = if (cwd) |path| .{ .path = path } else .inherit,
        .stdin = .ignore,
        .stdout = .pipe,
        .stderr = .pipe,
        .pgid = 0,
    });
    const process_id: i32 = @intCast(child.id orelse return error.SpawnFailed);
    defer if (child.id != null) {
        signalProcessGroup(process_id, true);
        child.kill(state.io);
    };
    try state.mutex.lock(state.io);
    const job = state.jobs.get(id) orelse {
        state.mutex.unlock(state.io);
        return error.Canceled;
    };
    if (job.status != .running) {
        state.mutex.unlock(state.io);
        return error.Canceled;
    }
    job.process_id = process_id;
    state.mutex.unlock(state.io);
    defer clearProcessId(state, id, process_id);

    var multi_reader_buffer: std.Io.File.MultiReader.Buffer(2) = undefined;
    var multi_reader: std.Io.File.MultiReader = undefined;
    multi_reader.init(state.allocator, state.io, multi_reader_buffer.toStreams(), &.{ child.stdout.?, child.stderr.? });
    defer multi_reader.deinit();
    const stdout_reader = multi_reader.reader(0);
    const stderr_reader = multi_reader.reader(1);
    const timeout: std.Io.Timeout = .{ .duration = .{ .clock = .awake, .raw = std.Io.Duration.fromSeconds(timeout_seconds) } };
    while (multi_reader.fill(64, timeout)) |_| {
        if (stdout_reader.buffered().len > max_output_bytes or stderr_reader.buffered().len > max_output_bytes) return error.StreamTooLong;
    } else |failure| switch (failure) {
        error.EndOfStream => {},
        else => |other| return other,
    }
    try multi_reader.checkAnyError();
    const term = try child.wait(state.io);
    const stdout = try multi_reader.toOwnedSlice(0);
    errdefer state.allocator.free(stdout);
    const stderr = try multi_reader.toOwnedSlice(1);
    return .{ .term = term, .stdout = stdout, .stderr = stderr };
}

fn clearProcessId(state: *State, id: []const u8, process_id: i32) void {
    const previous_protection = state.io.swapCancelProtection(.blocked);
    defer _ = state.io.swapCancelProtection(previous_protection);
    state.mutex.lock(state.io) catch return;
    defer state.mutex.unlock(state.io);
    const job = state.jobs.get(id) orelse return;
    if (job.process_id == process_id) job.process_id = 0;
}

fn signalProcessGroup(process_id: i32, force: bool) void {
    switch (builtin.os.tag) {
        .windows, .wasi => {},
        else => {
            const signal: std.posix.SIG = if (force) .KILL else .TERM;
            std.posix.kill(-@as(std.posix.pid_t, @intCast(process_id)), signal) catch {};
        },
    }
}

fn failJobLocked(job: *Job, io: std.Io, message: []u8) !void {
    try replaceString(job.allocator, &job.message, message);
    try setOptionalString(job.allocator, &job.error_message, try job.allocator.dupe(u8, message));
    try setOptionalString(job.allocator, &job.output_tail, try job.allocator.dupe(u8, tail(message) orelse message));
    job.status = .failed;
    job.progress = 1;
    try setOptionalString(job.allocator, &job.finished_at, try nowTimestamp(job.allocator, io));
}

fn markCancelled(state: *State, id: []const u8) void {
    state.mutex.lock(state.io) catch return;
    defer state.mutex.unlock(state.io);
    const job = state.jobs.get(id) orelse return;
    if (finished(job.status)) return;
    replaceString(job.allocator, &job.message, job.allocator.dupe(u8, "cancelled by user") catch return) catch return;
    job.status = .cancelled;
    job.progress = 1;
    setOptionalString(job.allocator, &job.finished_at, nowTimestamp(job.allocator, state.io) catch return) catch return;
}

fn markFailed(state: *State, id: []const u8, message: []const u8) void {
    markFailedWithOutput(state, id, message, message);
}

fn markFailedWithOutput(state: *State, id: []const u8, message: []const u8, output: []const u8) void {
    state.mutex.lock(state.io) catch return;
    defer state.mutex.unlock(state.io);
    const job = state.jobs.get(id) orelse return;
    if (job.status == .cancelled or job.status == .success) return;
    replaceString(job.allocator, &job.message, job.allocator.dupe(u8, message) catch return) catch return;
    setOptionalString(job.allocator, &job.error_message, job.allocator.dupe(u8, message) catch return) catch return;
    if (tail(output)) |value| setOptionalString(job.allocator, &job.output_tail, job.allocator.dupe(u8, value) catch return) catch return;
    job.status = .failed;
    job.progress = 1;
    setOptionalString(job.allocator, &job.finished_at, nowTimestamp(job.allocator, state.io) catch return) catch return;
}

fn serializeEnvelope(allocator: std.mem.Allocator, job: *const Job, legacy: bool) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    if (legacy) {
        try output.writer.writeAll("{\"job_id\":");
        try std.json.Stringify.value(job.id, .{}, &output.writer);
        try output.writer.writeAll(",\"job\":");
    } else try output.writer.writeAll("{\"job\":");
    try writeJob(&output.writer, job);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn writeJob(writer: *std.Io.Writer, job: *const Job) !void {
    try writer.writeAll("{\"id\":");
    try std.json.Stringify.value(job.id, .{}, writer);
    try writer.writeAll(",\"backend\":");
    try std.json.Stringify.value(job.backend, .{}, writer);
    if (job.target_id) |target_id| {
        try writer.writeAll(",\"targetId\":");
        try std.json.Stringify.value(target_id, .{}, writer);
    }
    try writer.writeAll(",\"type\":");
    try std.json.Stringify.value(job.job_type, .{}, writer);
    try writer.writeAll(",\"status\":");
    try std.json.Stringify.value(if (job.status == .failed) "error" else @tagName(job.status), .{}, writer);
    try writer.print(",\"progress\":{d},\"message\":", .{job.progress});
    try std.json.Stringify.value(job.message, .{}, writer);
    if (job.command) |value| {
        try writer.writeAll(",\"command\":");
        try std.json.Stringify.value(value, .{}, writer);
    }
    try writer.writeAll(",\"startedAt\":");
    try std.json.Stringify.value(job.started_at, .{}, writer);
    if (job.finished_at) |value| {
        try writer.writeAll(",\"finishedAt\":");
        try std.json.Stringify.value(value, .{}, writer);
    }
    if (job.output_tail) |value| {
        try writer.writeAll(",\"outputTail\":");
        try std.json.Stringify.value(value, .{}, writer);
    }
    if (job.error_message) |value| {
        try writer.writeAll(",\"error\":");
        try std.json.Stringify.value(value, .{}, writer);
    }
    try writer.writeByte('}');
}

fn validBackend(value: []const u8) bool {
    for ([_][]const u8{ "vllm", "sglang", "llamacpp", "mlx", "cuda", "rocm" }) |backend| if (std.mem.eql(u8, value, backend)) return true;
    return false;
}

fn validType(value: []const u8) bool {
    return std.mem.eql(u8, value, "install") or std.mem.eql(u8, value, "update");
}

fn validVersion(value: []const u8) bool {
    const trimmed = std.mem.trim(u8, value, " \t\r\n");
    if (trimmed.len == 0 or trimmed.len > 128 or trimmed[0] == '-') return false;
    for (trimmed) |character| if (!std.ascii.isAlphanumeric(character) and character != '.' and character != '+' and character != '-' and character != '_') return false;
    return true;
}

fn upgradeEnvironment(backend: []const u8) ?[]const u8 {
    if (std.mem.eql(u8, backend, "vllm")) return "LOCAL_STUDIO_VLLM_UPGRADE_CMD";
    if (std.mem.eql(u8, backend, "sglang")) return "LOCAL_STUDIO_SGLANG_UPGRADE_CMD";
    if (std.mem.eql(u8, backend, "llamacpp")) return "LOCAL_STUDIO_LLAMACPP_UPGRADE_CMD";
    if (std.mem.eql(u8, backend, "cuda")) return "LOCAL_STUDIO_CUDA_UPGRADE_CMD";
    if (std.mem.eql(u8, backend, "rocm")) return "LOCAL_STUDIO_ROCM_UPGRADE_CMD";
    return null;
}

fn finished(status: Status) bool {
    return status == .success or status == .failed or status == .cancelled;
}

fn finishedCount(state: *const State) usize {
    var count: usize = 0;
    var iterator = state.jobs.valueIterator();
    while (iterator.next()) |job| if (finished(job.*.status)) {
        count += 1;
    };
    return count;
}

fn newerFirst(_: void, left: *Job, right: *Job) bool {
    return left.sequence > right.sequence;
}

fn replaceString(allocator: std.mem.Allocator, target: *[]u8, replacement: []u8) !void {
    allocator.free(target.*);
    target.* = replacement;
}

fn setOptionalString(allocator: std.mem.Allocator, target: *?[]u8, replacement: []u8) !void {
    if (target.*) |value| allocator.free(value);
    target.* = replacement;
}

fn tail(value: []const u8) ?[]const u8 {
    if (value.len == 0) return null;
    return value[value.len - @min(value.len, max_output_tail) ..];
}

fn randomId(allocator: std.mem.Allocator, io: std.Io) ![]u8 {
    var bytes: [16]u8 = undefined;
    io.random(&bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return std.fmt.allocPrint(allocator, "{x:0>2}{x:0>2}{x:0>2}{x:0>2}-{x:0>2}{x:0>2}-{x:0>2}{x:0>2}-{x:0>2}{x:0>2}-{x:0>2}{x:0>2}{x:0>2}{x:0>2}{x:0>2}{x:0>2}", .{ bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7], bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15] });
}

fn nowTimestamp(allocator: std.mem.Allocator, io: std.Io) ![]u8 {
    const seconds = std.Io.Clock.real.now(io).toSeconds();
    const epoch = std.time.epoch.EpochSeconds{ .secs = @intCast(@max(seconds, 0)) };
    const year_day = epoch.getEpochDay().calculateYearDay();
    const month_day = year_day.calculateMonthDay();
    const day_seconds = epoch.getDaySeconds();
    return std.fmt.allocPrint(allocator, "{d:0>4}-{d:0>2}-{d:0>2}T{d:0>2}:{d:0>2}:{d:0>2}.000Z", .{ year_day.year, month_day.month.numeric(), month_day.day_index + 1, day_seconds.getHoursIntoDay(), day_seconds.getMinutesIntoHour(), day_seconds.getSecondsIntoMinute() });
}
