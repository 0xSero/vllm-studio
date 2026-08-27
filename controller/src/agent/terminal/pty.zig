const std = @import("std");
const builtin = @import("builtin");
const config = @import("../../app/config.zig");
const sqlite = @import("../../storage/sqlite.zig");
const agent_projects = @import("../projects/service.zig");
const harness_nodes = @import("../harness/nodes.zig");
const node_transport = @import("../../topology/node_transport.zig");

const Io = std.Io;
const max_sessions = 64;
const max_replay_bytes = 200_000;
const max_input_bytes = 32_768;

pub const RemoteId = struct {
    node: []const u8,
    session: []const u8,
};

pub fn splitRemoteId(id: []const u8) !RemoteId {
    const separator = std.mem.findScalar(u8, id, '~') orelse return error.InvalidPtyId;
    if (separator == 0 or separator + 1 >= id.len) return error.InvalidPtyId;
    const result = RemoteId{ .node = id[0..separator], .session = id[separator + 1 ..] };
    for (result.node) |character| if (!std.ascii.isAlphanumeric(character) and character != '-' and character != '_') return error.InvalidPtyId;
    for (result.session) |character| if (!std.ascii.isAlphanumeric(character) and character != '-' and character != '_') return error.InvalidPtyId;
    return result;
}

pub fn remoteTarget(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, id: RemoteId) !harness_nodes.Target {
    return (try harness_nodes.selectCapability(allocator, io, database, "terminal", id.node)) orelse error.TerminalNodeUnavailable;
}

pub fn openRemotePayload(allocator: std.mem.Allocator, io: Io, client: *std.http.Client, database: *sqlite.Database, preferred_node: ?[]const u8, document: []const u8) ![]u8 {
    var target = (try harness_nodes.selectCapability(allocator, io, database, "terminal", preferred_node)) orelse return error.TerminalNodeRequired;
    defer target.deinit();
    const response = node_transport.send(allocator, client, &target, "/internal/node/v1/terminal/pty/open", .POST, document) catch |failure| switch (failure) {
        error.NodeRequestRejected => return error.TerminalNodeRejected,
        else => return failure,
    };
    defer allocator.free(response);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, response, .{}) catch return error.InvalidPtyResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidPtyResponse;
    const remote_id = requiredString(parsed.value.object, "id") orelse return error.InvalidPtyResponse;
    const reused = parsed.value.object.get("reused");
    if (reused == null or reused.? != .bool) return error.InvalidPtyResponse;
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"id\":");
    const public_id = try std.fmt.allocPrint(allocator, "{s}~{s}", .{ target.id, remote_id });
    defer allocator.free(public_id);
    try std.json.Stringify.value(public_id, .{}, &output.writer);
    try output.writer.print(",\"reused\":{}}}", .{reused.?.bool});
    return output.toOwnedSlice();
}

pub fn actionRemotePayload(allocator: std.mem.Allocator, io: Io, client: *std.http.Client, database: *sqlite.Database, action: []const u8, document: []const u8) ![]u8 {
    var parsed = try parseAction(allocator, document);
    defer parsed.deinit();
    const public_id = requiredString(parsed.value.object, "id") orelse return error.PtyIdRequired;
    const remote = try splitRemoteId(public_id);
    var target = try remoteTarget(allocator, io, database, remote);
    defer target.deinit();
    const id_value = parsed.value.object.getPtr("id") orelse return error.PtyIdRequired;
    id_value.* = .{ .string = remote.session };
    var rewritten: Io.Writer.Allocating = .init(allocator);
    defer rewritten.deinit();
    try std.json.Stringify.value(parsed.value, .{}, &rewritten.writer);
    const path = try std.fmt.allocPrint(allocator, "/internal/node/v1/terminal/pty/{s}", .{action});
    defer allocator.free(path);
    return node_transport.send(allocator, client, &target, path, .POST, rewritten.writer.buffered()) catch |failure| switch (failure) {
        error.NodeRequestRejected => error.TerminalNodeRejected,
        else => failure,
    };
}

const Session = struct {
    allocator: std.mem.Allocator,
    id: []u8,
    owner: ?[]u8,
    master: std.posix.fd_t,
    pid: std.posix.pid_t,
    replay: std.ArrayList(u8) = .empty,
    running: bool = true,
    closed: bool = false,
    exit_code: ?u8 = null,
    signal: ?u8 = null,

    fn deinit(session: *Session) void {
        session.allocator.free(session.id);
        if (session.owner) |value| session.allocator.free(value);
        session.replay.deinit(session.allocator);
        session.allocator.destroy(session);
    }
};

pub const Manager = struct {
    allocator: std.mem.Allocator,
    io: Io,
    environment: *const std.process.Environ.Map,
    mutex: Io.Mutex = .init,
    tasks: Io.Group = .init,
    sessions: std.StringHashMapUnmanaged(*Session) = .empty,

    pub fn init(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config) Manager {
        return .{ .allocator = allocator, .io = io, .environment = configuration.environment };
    }

    pub fn deinit(manager: *Manager) void {
        manager.mutex.lock(manager.io) catch {};
        var iterator = manager.sessions.valueIterator();
        while (iterator.next()) |session| manager.stopLocked(session.*);
        manager.mutex.unlock(manager.io);
        manager.tasks.cancel(manager.io);
        iterator = manager.sessions.valueIterator();
        while (iterator.next()) |session| session.*.deinit();
        manager.sessions.deinit(manager.allocator);
        manager.* = undefined;
    }

    pub fn openPayload(manager: *Manager, document: []const u8) ![]u8 {
        if (builtin.os.tag == .windows) return error.PtyUnavailable;
        var parsed = std.json.parseFromSlice(std.json.Value, manager.allocator, document, .{}) catch return error.InvalidPtyPayload;
        defer parsed.deinit();
        if (parsed.value != .object) return error.InvalidPtyPayload;
        const cwd_value = optionalString(parsed.value.object, "cwd") orelse manager.environment.get("HOME") orelse return error.HomeDirectoryUnavailable;
        const cwd = try agent_projects.resolveAllowedPath(manager.allocator, manager.io, manager.environment, cwd_value);
        defer manager.allocator.free(cwd);
        const owner = optionalString(parsed.value.object, "ownerKey");
        const cols = dimension(parsed.value.object, "cols", 80);
        const rows = dimension(parsed.value.object, "rows", 24);
        try manager.mutex.lock(manager.io);
        var locked = true;
        defer if (locked) manager.mutex.unlock(manager.io);
        if (owner) |owner_key| {
            var iterator = manager.sessions.valueIterator();
            while (iterator.next()) |session| if (session.*.running and session.*.owner != null and std.mem.eql(u8, session.*.owner.?, owner_key)) {
                _ = resizeLocked(session.*, cols, rows);
                const payload = try openResponse(manager.allocator, session.*.id, true);
                manager.mutex.unlock(manager.io);
                locked = false;
                return payload;
            };
        }
        var active: usize = 0;
        var iterator = manager.sessions.valueIterator();
        while (iterator.next()) |session| if (session.*.running) {
            active += 1;
        };
        if (active >= max_sessions) return error.PtyLimitReached;
        const session = try manager.spawn(cwd, owner, cols, rows);
        errdefer session.deinit();
        try manager.sessions.put(manager.allocator, session.id, session);
        manager.tasks.concurrent(manager.io, readOutput, .{ manager, session }) catch |failure| {
            _ = manager.sessions.remove(session.id);
            manager.stopLocked(session);
            return failure;
        };
        const payload = try openResponse(manager.allocator, session.id, false);
        manager.mutex.unlock(manager.io);
        locked = false;
        return payload;
    }

    pub fn inputPayload(manager: *Manager, document: []const u8) ![]u8 {
        var parsed = try parseAction(manager.allocator, document);
        defer parsed.deinit();
        const id = requiredString(parsed.value.object, "id") orelse return error.PtyIdRequired;
        const data = rawString(parsed.value.object, "data") orelse return error.PtyInputRequired;
        if (data.len > max_input_bytes) return error.PtyInputTooLarge;
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        const session = manager.sessions.get(id);
        const ok = if (session) |value| value.running and std.c.write(value.master, data.ptr, data.len) >= 0 else false;
        return boolPayload(manager.allocator, ok);
    }

    pub fn resizePayload(manager: *Manager, document: []const u8) ![]u8 {
        var parsed = try parseAction(manager.allocator, document);
        defer parsed.deinit();
        const id = requiredString(parsed.value.object, "id") orelse return error.PtyIdRequired;
        const cols = dimension(parsed.value.object, "cols", 80);
        const rows = dimension(parsed.value.object, "rows", 24);
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        const ok = if (manager.sessions.get(id)) |session| resizeLocked(session, cols, rows) else false;
        return boolPayload(manager.allocator, ok);
    }

    pub fn closePayload(manager: *Manager, document: []const u8) ![]u8 {
        var parsed = try parseAction(manager.allocator, document);
        defer parsed.deinit();
        const id = requiredString(parsed.value.object, "id") orelse return error.PtyIdRequired;
        try manager.mutex.lock(manager.io);
        defer manager.mutex.unlock(manager.io);
        if (manager.sessions.get(id)) |session| manager.stopLocked(session);
        return manager.allocator.dupe(u8, "{\"ok\":true}");
    }

    pub fn serveStream(manager: *Manager, id: []const u8, request: *std.http.Server.Request) !void {
        var stream_buffer: [16 * 1024]u8 = undefined;
        var body = try request.respondStreaming(&stream_buffer, .{
            .respond_options = .{
                .keep_alive = false,
                .extra_headers = &.{
                    .{ .name = "Content-Type", .value = "text/event-stream; charset=utf-8" },
                    .{ .name = "Cache-Control", .value = "no-cache, no-transform" },
                    .{ .name = "X-Accel-Buffering", .value = "no" },
                },
            },
        });
        var offset: usize = 0;
        var heartbeat: usize = 0;
        var first = true;
        while (true) {
            try manager.mutex.lock(manager.io);
            const session = manager.sessions.get(id);
            if (session == null) {
                manager.mutex.unlock(manager.io);
                try body.writer.writeAll("event: gone\ndata: {}\n\n");
                try body.end();
                return;
            }
            const value = session.?;
            if (offset > value.replay.items.len) offset = 0;
            const chunk = try manager.allocator.dupe(u8, value.replay.items[offset..]);
            offset = value.replay.items.len;
            const running = value.running;
            const exit_code = value.exit_code;
            const signal = value.signal;
            manager.mutex.unlock(manager.io);
            defer manager.allocator.free(chunk);
            if (first) {
                try writeFrame(manager.allocator, &body.writer, "snapshot", chunk);
                first = false;
            } else if (chunk.len > 0) try writeFrame(manager.allocator, &body.writer, null, chunk);
            if (!running) {
                try body.writer.writeAll("event: exit\ndata: {\"exitCode\":");
                if (exit_code) |code| try body.writer.print("{d}", .{code}) else try body.writer.writeAll("null");
                try body.writer.writeAll(",\"signal\":");
                if (signal) |code| try body.writer.print("{d}", .{code}) else try body.writer.writeAll("null");
                try body.writer.writeAll("}\n\n");
                try body.end();
                return;
            }
            if (chunk.len > 0 or heartbeat % 150 == 0) {
                if (chunk.len == 0) try body.writer.writeAll(": ping\n\n");
                try body.writer.flush();
                try body.flush();
            }
            heartbeat += 1;
            try manager.io.sleep(.fromMilliseconds(100), .awake);
        }
    }

    fn spawn(manager: *Manager, cwd: []const u8, owner: ?[]const u8, cols: u16, rows: u16) !*Session {
        const cwd_z = try manager.allocator.dupeZ(u8, cwd);
        defer manager.allocator.free(cwd_z);
        const shell = manager.environment.get("SHELL") orelse "/bin/sh";
        const shell_z = try manager.allocator.dupeZ(u8, shell);
        defer manager.allocator.free(shell_z);
        var master: std.posix.fd_t = undefined;
        var window = std.posix.winsize{ .row = rows, .col = cols, .xpixel = 0, .ypixel = 0 };
        const pid = forkpty(&master, null, null, &window);
        if (pid < 0) return error.PtySpawnFailed;
        if (pid == 0) {
            _ = std.c.chdir(cwd_z.ptr);
            var arguments = [_:null]?[*:0]const u8{ shell_z.ptr, null };
            _ = std.c.execve(shell_z.ptr, &arguments, @ptrCast(std.c.environ));
            std.c._exit(127);
        }
        var random: [16]u8 = undefined;
        manager.io.random(&random);
        const id_buffer = std.fmt.bytesToHex(random, .lower);
        const session = try manager.allocator.create(Session);
        errdefer manager.allocator.destroy(session);
        session.* = .{
            .allocator = manager.allocator,
            .id = try manager.allocator.dupe(u8, id_buffer[0..]),
            .owner = if (owner) |value| try manager.allocator.dupe(u8, value[0..@min(value.len, 512)]) else null,
            .master = master,
            .pid = pid,
        };
        return session;
    }

    fn stopLocked(manager: *Manager, session: *Session) void {
        _ = manager;
        if (!session.running or session.closed) return;
        session.closed = true;
        std.posix.kill(session.pid, .HUP) catch {};
        _ = std.posix.system.close(session.master);
    }
};

fn readOutput(manager: *Manager, session: *Session) Io.Cancelable!void {
    var buffer: [8192]u8 = undefined;
    while (true) {
        const count = std.posix.read(session.master, &buffer) catch break;
        if (count == 0) break;
        try manager.mutex.lock(manager.io);
        const overflow = session.replay.items.len + count -| max_replay_bytes;
        if (overflow > 0) std.mem.copyForwards(u8, session.replay.items[0 .. session.replay.items.len - overflow], session.replay.items[overflow..]);
        if (overflow > 0) session.replay.shrinkRetainingCapacity(session.replay.items.len - overflow);
        session.replay.appendSlice(manager.allocator, buffer[0..count]) catch {
            manager.mutex.unlock(manager.io);
            break;
        };
        manager.mutex.unlock(manager.io);
    }
    var status: c_int = 0;
    _ = std.c.waitpid(session.pid, &status, 0);
    try manager.mutex.lock(manager.io);
    session.running = false;
    const wait_status: u32 = @bitCast(status);
    if (std.c.W.IFEXITED(wait_status)) session.exit_code = @intCast(std.c.W.EXITSTATUS(wait_status));
    if (std.c.W.IFSIGNALED(wait_status)) session.signal = @intCast(@intFromEnum(std.c.W.TERMSIG(wait_status)));
    manager.mutex.unlock(manager.io);
}

fn resizeLocked(session: *Session, cols: u16, rows: u16) bool {
    if (!session.running) return false;
    var window = std.posix.winsize{ .row = rows, .col = cols, .xpixel = 0, .ypixel = 0 };
    const request: c_int = @bitCast(@as(u32, if (builtin.os.tag == .linux) std.c.T.IOCSWINSZ else 0x80087467));
    return std.posix.system.ioctl(session.master, request, &window) == 0;
}

fn writeFrame(allocator: std.mem.Allocator, writer: *Io.Writer, event: ?[]const u8, data: []const u8) !void {
    const encoded = try allocator.alloc(u8, std.base64.standard.Encoder.calcSize(data.len));
    defer allocator.free(encoded);
    _ = std.base64.standard.Encoder.encode(encoded, data);
    if (event) |name| try writer.print("event: {s}\n", .{name});
    try writer.print("data: {s}\n\n", .{encoded});
}

fn parseAction(allocator: std.mem.Allocator, document: []const u8) !std.json.Parsed(std.json.Value) {
    const parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidPtyPayload;
    if (parsed.value != .object) {
        var owned = parsed;
        owned.deinit();
        return error.InvalidPtyPayload;
    }
    return parsed;
}

fn openResponse(allocator: std.mem.Allocator, id: []const u8, reused: bool) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"id\":");
    try std.json.Stringify.value(id, .{}, &output.writer);
    try output.writer.print(",\"reused\":{}}}", .{reused});
    return output.toOwnedSlice();
}

fn boolPayload(allocator: std.mem.Allocator, ok: bool) ![]u8 {
    return std.fmt.allocPrint(allocator, "{{\"ok\":{}}}", .{ok});
}

fn rawString(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    return if (value == .string) value.string else null;
}

fn requiredString(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = rawString(object, name) orelse return null;
    const trimmed = std.mem.trim(u8, value, " \t\r\n");
    return if (trimmed.len == 0) null else trimmed;
}

fn optionalString(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    return requiredString(object, name);
}

fn dimension(object: std.json.ObjectMap, name: []const u8, fallback: u16) u16 {
    const value = object.get(name) orelse return fallback;
    if (value != .integer or value.integer < 2 or value.integer > 1000) return fallback;
    return @intCast(value.integer);
}

extern "c" fn forkpty(master: *std.posix.fd_t, name: ?[*:0]u8, termios: ?*anyopaque, window: ?*const std.posix.winsize) std.posix.pid_t;
