const std = @import("std");
const builtin = @import("builtin");
const instances = @import("instance_store.zig");

const launch_marker = "LOCAL_STUDIO_LAUNCH_NONCE";

const Identity = struct {
    pid: i32,
    process_group_id: i32,
    session_id: i32,
    start_token: []const u8,
    marker: ?[]const u8,
};

pub fn owns(allocator: std.mem.Allocator, io: std.Io, record: *const instances.Record) bool {
    const reference = record.process orelse return false;
    const expected_group = reference.process_group_id orelse return false;
    const expected_session = reference.session_id orelse return false;
    const expected_token = reference.start_token orelse return false;
    const identity = readIdentity(allocator, io, reference.pid) orelse return false;
    defer identity.deinit(allocator);
    return identity.value.pid == reference.pid and
        identity.value.process_group_id == expected_group and
        identity.value.session_id == expected_session and
        std.mem.eql(u8, identity.value.start_token, expected_token) and
        identity.value.marker != null and
        std.mem.eql(u8, identity.value.marker.?, record.nonce);
}

pub fn capture(allocator: std.mem.Allocator, io: std.Io, pid: i32) !instances.ProcessReference {
    const identity = readIdentity(allocator, io, pid) orelse return error.ProcessIdentityUnavailable;
    defer identity.deinit(allocator);
    return .{
        .pid = identity.value.pid,
        .process_group_id = identity.value.process_group_id,
        .session_id = identity.value.session_id,
        .start_token = try allocator.dupe(u8, identity.value.start_token),
    };
}

pub fn terminateOwned(allocator: std.mem.Allocator, io: std.Io, record: *const instances.Record, signal: std.posix.SIG) !bool {
    if (!owns(allocator, io, record)) return false;
    const reference = record.process orelse return false;
    const group = reference.process_group_id orelse return false;
    std.posix.kill(-group, signal) catch |failure| switch (failure) {
        error.ProcessNotFound => return false,
        else => return failure,
    };
    return true;
}

const OwnedIdentity = struct {
    value: Identity,
    storage: []u8,
    marker_storage: ?[]u8,

    fn deinit(identity: OwnedIdentity, allocator: std.mem.Allocator) void {
        allocator.free(identity.storage);
        if (identity.marker_storage) |marker| allocator.free(marker);
    }
};

fn readIdentity(allocator: std.mem.Allocator, io: std.Io, pid: i32) ?OwnedIdentity {
    return switch (builtin.os.tag) {
        .linux => readLinuxIdentity(allocator, io, pid),
        .macos => readMacIdentity(allocator, io, pid),
        else => null,
    };
}

fn readLinuxIdentity(allocator: std.mem.Allocator, io: std.Io, pid: i32) ?OwnedIdentity {
    const stat_path = std.fmt.allocPrint(allocator, "/proc/{d}/stat", .{pid}) catch return null;
    defer allocator.free(stat_path);
    const stat = std.Io.Dir.cwd().readFileAlloc(io, stat_path, allocator, .limited(64 * 1024)) catch return null;
    errdefer allocator.free(stat);
    const close_index = std.mem.lastIndexOfScalar(u8, stat, ')') orelse return null;
    if (close_index + 2 >= stat.len) return null;
    var fields = std.mem.splitScalar(u8, stat[close_index + 2 ..], ' ');
    const state = fields.next() orelse return null;
    if (std.mem.eql(u8, state, "Z")) return null;
    _ = fields.next() orelse return null;
    const process_group_id = parseI32(fields.next() orelse return null) orelse return null;
    const session_id = parseI32(fields.next() orelse return null) orelse return null;
    var field_index: usize = 4;
    var start_token: ?[]const u8 = null;
    while (fields.next()) |field| : (field_index += 1) {
        if (field_index == 19) {
            start_token = field;
            break;
        }
    }
    const token = start_token orelse return null;
    if (token.len == 0) return null;
    const marker = readLinuxMarker(allocator, io, pid);
    return .{
        .value = .{
            .pid = pid,
            .process_group_id = process_group_id,
            .session_id = session_id,
            .start_token = token,
            .marker = marker,
        },
        .storage = stat,
        .marker_storage = marker,
    };
}

fn readLinuxMarker(allocator: std.mem.Allocator, io: std.Io, pid: i32) ?[]u8 {
    const environ_path = std.fmt.allocPrint(allocator, "/proc/{d}/environ", .{pid}) catch return null;
    defer allocator.free(environ_path);
    const environ = std.Io.Dir.cwd().readFileAlloc(io, environ_path, allocator, .limited(4 * 1024 * 1024)) catch return null;
    defer allocator.free(environ);
    const prefix = launch_marker ++ "=";
    var entries = std.mem.splitScalar(u8, environ, 0);
    while (entries.next()) |entry| {
        if (std.mem.startsWith(u8, entry, prefix)) return allocator.dupe(u8, entry[prefix.len..]) catch null;
    }
    return null;
}

fn readMacIdentity(allocator: std.mem.Allocator, io: std.Io, pid: i32) ?OwnedIdentity {
    const pid_text = std.fmt.allocPrint(allocator, "{d}", .{pid}) catch return null;
    defer allocator.free(pid_text);
    const result = std.process.run(allocator, io, .{
        .argv = &.{ "ps", "-o", "pid=,ppid=,pgid=,lstart=", "-p", pid_text },
        .stdout_limit = .limited(64 * 1024),
        .stderr_limit = .limited(64 * 1024),
        .timeout = .{ .duration = .{ .clock = .awake, .raw = std.Io.Duration.fromSeconds(2) } },
    }) catch return null;
    defer allocator.free(result.stderr);
    errdefer allocator.free(result.stdout);
    switch (result.term) {
        .exited => |code| if (code != 0) return null,
        else => return null,
    }
    var fields = std.mem.tokenizeAny(u8, result.stdout, " \t\r\n");
    const actual_pid = parseI32(fields.next() orelse return null) orelse return null;
    _ = fields.next() orelse return null;
    const process_group_id = parseI32(fields.next() orelse return null) orelse return null;
    var token_start: ?usize = null;
    var token_end: usize = 0;
    var token_count: usize = 0;
    while (fields.next()) |field| {
        token_start = token_start orelse @intFromPtr(field.ptr) - @intFromPtr(result.stdout.ptr);
        token_end = @intFromPtr(field.ptr) - @intFromPtr(result.stdout.ptr) + field.len;
        token_count += 1;
    }
    if (token_count != 5) return null;
    const start = token_start orelse return null;
    const marker = readMacMarker(allocator, io, pid_text);
    return .{
        .value = .{
            .pid = actual_pid,
            .process_group_id = process_group_id,
            .session_id = process_group_id,
            .start_token = result.stdout[start..token_end],
            .marker = marker,
        },
        .storage = result.stdout,
        .marker_storage = marker,
    };
}

fn readMacMarker(allocator: std.mem.Allocator, io: std.Io, pid_text: []const u8) ?[]u8 {
    const result = std.process.run(allocator, io, .{
        .argv = &.{ "ps", "eww", "-p", pid_text, "-o", "command=" },
        .stdout_limit = .limited(4 * 1024 * 1024),
        .stderr_limit = .limited(64 * 1024),
        .timeout = .{ .duration = .{ .clock = .awake, .raw = std.Io.Duration.fromSeconds(2) } },
    }) catch return null;
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    switch (result.term) {
        .exited => |code| if (code != 0) return null,
        else => return null,
    }
    const prefix = launch_marker ++ "=";
    const start = std.mem.indexOf(u8, result.stdout, prefix) orelse return null;
    const value_start = start + prefix.len;
    const suffix = result.stdout[value_start..];
    const value_end = std.mem.indexOfAny(u8, suffix, " \t\r\n") orelse suffix.len;
    if (value_end == 0) return null;
    return allocator.dupe(u8, suffix[0..value_end]) catch null;
}

fn parseI32(value: []const u8) ?i32 {
    const parsed = std.fmt.parseInt(i64, value, 10) catch return null;
    if (parsed <= 0 or parsed > std.math.maxInt(i32)) return null;
    return @intCast(parsed);
}
