const std = @import("std");
const compute_instances = @import("instance_store.zig");
const compute_references = @import("reference_store.zig");

const Io = std.Io;
const inspect_format = "{{.Id}}\n{{index .Config.Labels \"local-studio.nonce\"}}\n{{index .Config.Labels \"local-studio.instance\"}}\n{{.State.Running}}";
const max_output_bytes = 4 * 1024 * 1024;

pub const State = enum { owned, stopped, gone, unknown };

pub const CommandResult = struct {
    allocator: std.mem.Allocator,
    term: std.process.Child.Term,
    stdout: []u8,
    stderr: []u8,

    pub fn deinit(result: *CommandResult) void {
        result.allocator.free(result.stdout);
        result.allocator.free(result.stderr);
        result.* = undefined;
    }

    pub fn successful(result: *const CommandResult) bool {
        return switch (result.term) {
            .exited => |code| code == 0,
            else => false,
        };
    }
};

pub const Context = struct {
    allocator: std.mem.Allocator,
    path: []u8,
    token: []u8,
    daemon_id: []u8,

    pub fn deinit(context: *Context) void {
        context.allocator.free(context.path);
        context.allocator.free(context.token);
        context.allocator.free(context.daemon_id);
        context.* = undefined;
    }

    pub fn command(context: *const Context, io: Io, arguments: []const []const u8, timeout_seconds: u64) !CommandResult {
        const argv = try context.allocator.alloc([]const u8, arguments.len + 1);
        defer context.allocator.free(argv);
        argv[0] = context.path;
        @memcpy(argv[1..], arguments);
        const result = try std.process.run(context.allocator, io, .{
            .argv = argv,
            .stdout_limit = .limited(max_output_bytes),
            .stderr_limit = .limited(max_output_bytes),
            .timeout = .{ .duration = .{ .clock = .awake, .raw = Io.Duration.fromSeconds(timeout_seconds) } },
        });
        return .{ .allocator = context.allocator, .term = result.term, .stdout = result.stdout, .stderr = result.stderr };
    }
};

const Inspect = union(enum) {
    found: struct {
        container_id: [64]u8,
        running: bool,
    },
    absent,
    unknown,
};

pub fn connect(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map) !?Context {
    const executable = try resolveExecutable(allocator, io, environment) orelse return null;
    var executable_owned = true;
    defer if (executable_owned) {
        allocator.free(executable.path);
        allocator.free(executable.token);
    };
    var partial = Context{ .allocator = allocator, .path = executable.path, .token = executable.token, .daemon_id = undefined };
    var result = partial.command(io, &.{ "info", "--format", "{{.ID}}" }, 30) catch return null;
    defer result.deinit();
    if (!result.successful()) return null;
    const daemon_id = std.mem.trim(u8, result.stdout, " \t\r\n");
    if (daemon_id.len == 0 or daemon_id.len > 16 * 1024) return null;
    partial.daemon_id = try allocator.dupe(u8, daemon_id);
    executable_owned = false;
    return partial;
}

pub fn state(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, record: *const compute_instances.Record) !State {
    const reference = record.reference orelse return .gone;
    return switch (reference) {
        .docker => |value| stateDocker(allocator, io, environment, record, value),
        .docker_pending => |value| statePending(allocator, io, environment, record, value),
        else => .unknown,
    };
}

pub fn discover(context: *const Context, io: Io, record: *const compute_instances.Record) !State {
    const name = try containerName(context.allocator, record.name);
    defer context.allocator.free(name);
    const inspected = try inspect(context, io, name, record);
    return switch (inspected) {
        .found => |value| if (value.running) .owned else .stopped,
        .absent => .gone,
        .unknown => .unknown,
    };
}

pub fn containerId(context: *const Context, io: Io, record: *const compute_instances.Record) !?[]u8 {
    const name = try containerName(context.allocator, record.name);
    defer context.allocator.free(name);
    const inspected = try inspect(context, io, name, record);
    return switch (inspected) {
        .found => |value| try context.allocator.dupe(u8, &value.container_id),
        else => null,
    };
}

pub fn containerName(allocator: std.mem.Allocator, name: []const u8) ![]u8 {
    const output = try allocator.alloc(u8, "local-studio-".len + name.len);
    @memcpy(output[0.."local-studio-".len], "local-studio-");
    for (name, output["local-studio-".len..]) |character, *target| target.* = if (std.ascii.isAlphanumeric(character) or character == '_' or character == '.' or character == '-') character else '_';
    return output;
}

pub fn validContainerId(value: []const u8) bool {
    if (value.len != 64) return false;
    for (value) |character| if (!std.ascii.isDigit(character) and (character < 'a' or character > 'f')) return false;
    return true;
}

fn stateDocker(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, record: *const compute_instances.Record, reference: compute_references.Docker) !State {
    if (!validContainerId(reference.container_id)) return .unknown;
    var context = try connect(allocator, io, environment) orelse return .unknown;
    defer context.deinit();
    if (!sameContext(&context, reference.daemon_id, reference.executable_path, reference.executable_token)) return .unknown;
    const inspected = try inspect(&context, io, reference.container_id, record);
    return switch (inspected) {
        .found => |value| if (!std.mem.eql(u8, &value.container_id, reference.container_id)) .unknown else if (value.running) .owned else .stopped,
        .absent => .gone,
        .unknown => .unknown,
    };
}

fn statePending(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, record: *const compute_instances.Record, reference: compute_references.DockerPending) !State {
    var context = try connect(allocator, io, environment) orelse return .unknown;
    defer context.deinit();
    const expected_name = try containerName(allocator, record.name);
    defer allocator.free(expected_name);
    if (!std.mem.eql(u8, reference.container_name, expected_name) or !std.mem.eql(u8, reference.nonce, record.nonce) or !sameContext(&context, reference.daemon_id, reference.executable_path, reference.executable_token)) return .unknown;
    const inspected = try inspect(&context, io, reference.container_name, record);
    return switch (inspected) {
        .found => |value| if (value.running) .owned else .stopped,
        .absent => .gone,
        .unknown => .unknown,
    };
}

fn inspect(context: *const Context, io: Io, identifier: []const u8, record: *const compute_instances.Record) !Inspect {
    var result = context.command(io, &.{ "inspect", "--format", inspect_format, identifier }, 30) catch return .unknown;
    defer result.deinit();
    if (!result.successful()) return if (std.mem.indexOf(u8, result.stderr, "No such object") != null) .absent else .unknown;
    var lines = std.mem.splitScalar(u8, std.mem.trim(u8, result.stdout, " \t\r\n"), '\n');
    const id = std.mem.trim(u8, lines.next() orelse return .unknown, " \t\r");
    const nonce = std.mem.trim(u8, lines.next() orelse return .unknown, " \t\r");
    const name = std.mem.trim(u8, lines.next() orelse return .unknown, " \t\r");
    const running_text = std.mem.trim(u8, lines.next() orelse return .unknown, " \t\r");
    if (lines.next() != null or !validContainerId(id) or !std.mem.eql(u8, nonce, record.nonce) or !std.mem.eql(u8, name, record.name)) return .unknown;
    const running = if (std.mem.eql(u8, running_text, "true")) true else if (std.mem.eql(u8, running_text, "false")) false else return .unknown;
    var container_id: [64]u8 = undefined;
    @memcpy(&container_id, id);
    return .{ .found = .{ .container_id = container_id, .running = running } };
}

fn sameContext(context: *const Context, daemon_id: []const u8, executable_path: []const u8, executable_token: []const u8) bool {
    return std.mem.eql(u8, context.daemon_id, daemon_id) and std.mem.eql(u8, context.path, executable_path) and std.mem.eql(u8, context.token, executable_token);
}

const Executable = struct {
    path: []u8,
    token: []u8,
};

fn resolveExecutable(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map) !?Executable {
    const path_value = environment.get("PATH") orelse return null;
    var directories = std.mem.splitScalar(u8, path_value, std.fs.path.delimiter);
    while (directories.next()) |directory| {
        if (directory.len == 0) continue;
        const candidate = try std.fs.path.join(allocator, &.{ directory, "docker" });
        defer allocator.free(candidate);
        const stat = Io.Dir.cwd().statFile(io, candidate, .{}) catch continue;
        if (stat.kind != .file or stat.permissions.toMode() & 0o111 == 0) continue;
        const absolute = if (std.fs.path.isAbsolute(candidate)) try allocator.dupe(u8, candidate) else try std.fs.path.resolve(allocator, &.{candidate});
        defer allocator.free(absolute);
        const path_z = Io.Dir.realPathFileAbsoluteAlloc(io, absolute, allocator) catch continue;
        errdefer allocator.free(path_z);
        const resolved_stat = try Io.Dir.cwd().statFile(io, path_z, .{});
        return .{
            .path = path_z,
            .token = try std.fmt.allocPrint(allocator, "{d}:{d}:{d}", .{ resolved_stat.inode, resolved_stat.size, resolved_stat.mtime.nanoseconds }),
        };
    }
    return null;
}
