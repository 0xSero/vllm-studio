const std = @import("std");
const instances = @import("../runtime/instance_store.zig");

const max_field_bytes = 16 * 1024;

pub const Docker = struct {
    container_id: []u8,
    daemon_id: []u8,
    executable_path: []u8,
    executable_token: []u8,
};

pub const DockerPending = struct {
    container_name: []u8,
    nonce: []u8,
    daemon_id: []u8,
    executable_path: []u8,
    executable_token: []u8,
};

pub const Remote = struct {
    node_id: []u8,
    name: []u8,
};

pub const Reference = union(enum) {
    process: instances.ProcessReference,
    docker: Docker,
    docker_pending: DockerPending,
    remote: Remote,
    pinned: []u8,

    pub fn deinit(reference: *Reference, allocator: std.mem.Allocator) void {
        switch (reference.*) {
            .process => |process| if (process.start_token) |token| allocator.free(token),
            .docker => |value| {
                allocator.free(value.container_id);
                allocator.free(value.daemon_id);
                allocator.free(value.executable_path);
                allocator.free(value.executable_token);
            },
            .docker_pending => |value| {
                allocator.free(value.container_name);
                allocator.free(value.nonce);
                allocator.free(value.daemon_id);
                allocator.free(value.executable_path);
                allocator.free(value.executable_token);
            },
            .remote => |value| {
                allocator.free(value.node_id);
                allocator.free(value.name);
            },
            .pinned => |holder| allocator.free(holder),
        }
        reference.* = undefined;
    }

    pub fn processValue(reference: *const Reference) ?instances.ProcessReference {
        return switch (reference.*) {
            .process => |value| value,
            else => null,
        };
    }

    pub fn writeJson(reference: *const Reference, writer: *std.Io.Writer) !void {
        switch (reference.*) {
            .process => |value| {
                try writer.print("{{\"kind\":\"process\",\"pid\":{d},\"processGroupId\":", .{value.pid});
                if (value.process_group_id) |group| try writer.print("{d}", .{group}) else try writer.writeAll("null");
                try writer.writeAll(",\"sessionId\":");
                if (value.session_id) |session| try writer.print("{d}", .{session}) else try writer.writeAll("null");
                try writer.writeAll(",\"startToken\":");
                if (value.start_token) |token| try std.json.Stringify.value(token, .{}, writer) else try writer.writeAll("null");
                try writer.writeByte('}');
            },
            .docker => |value| {
                try writer.writeAll("{\"kind\":\"docker\",\"containerId\":");
                try std.json.Stringify.value(value.container_id, .{}, writer);
                try writer.writeAll(",\"daemonId\":");
                try std.json.Stringify.value(value.daemon_id, .{}, writer);
                try writer.writeAll(",\"executablePath\":");
                try std.json.Stringify.value(value.executable_path, .{}, writer);
                try writer.writeAll(",\"executableToken\":");
                try std.json.Stringify.value(value.executable_token, .{}, writer);
                try writer.writeByte('}');
            },
            .docker_pending => |value| {
                try writer.writeAll("{\"kind\":\"docker-pending\",\"containerName\":");
                try std.json.Stringify.value(value.container_name, .{}, writer);
                try writer.writeAll(",\"nonce\":");
                try std.json.Stringify.value(value.nonce, .{}, writer);
                try writer.writeAll(",\"daemonId\":");
                try std.json.Stringify.value(value.daemon_id, .{}, writer);
                try writer.writeAll(",\"executablePath\":");
                try std.json.Stringify.value(value.executable_path, .{}, writer);
                try writer.writeAll(",\"executableToken\":");
                try std.json.Stringify.value(value.executable_token, .{}, writer);
                try writer.writeByte('}');
            },
            .remote => |value| {
                try writer.writeAll("{\"kind\":\"remote\",\"nodeId\":");
                try std.json.Stringify.value(value.node_id, .{}, writer);
                try writer.writeAll(",\"name\":");
                try std.json.Stringify.value(value.name, .{}, writer);
                try writer.writeByte('}');
            },
            .pinned => |holder| {
                try writer.writeAll("{\"kind\":\"pinned\",\"holder\":");
                try std.json.Stringify.value(holder, .{}, writer);
                try writer.writeByte('}');
            },
        }
    }
};

pub fn parse(allocator: std.mem.Allocator, value: ?std.json.Value) !?Reference {
    const present = value orelse return null;
    if (present == .null) return null;
    if (present != .object) return error.InvalidInstanceRecord;
    const kind = stringField(present.object, "kind") orelse return error.InvalidInstanceRecord;
    if (std.mem.eql(u8, kind, "process")) return .{ .process = try parseProcess(allocator, present.object) };
    if (std.mem.eql(u8, kind, "docker")) return .{ .docker = try parseDocker(allocator, present.object) };
    if (std.mem.eql(u8, kind, "docker-pending")) return .{ .docker_pending = try parseDockerPending(allocator, present.object) };
    if (std.mem.eql(u8, kind, "remote")) return .{ .remote = try parseRemote(allocator, present.object) };
    if (std.mem.eql(u8, kind, "pinned")) return .{ .pinned = try duplicateField(allocator, present.object, "holder") };
    return error.InvalidInstanceRecord;
}

fn parseProcess(allocator: std.mem.Allocator, object: std.json.ObjectMap) !instances.ProcessReference {
    const pid = positiveI32(object.get("pid")) orelse return error.InvalidInstanceRecord;
    const group = nullableI32(object.get("processGroupId")) orelse return error.InvalidInstanceRecord;
    const session = nullableI32(object.get("sessionId")) orelse return error.InvalidInstanceRecord;
    const token_value = object.get("startToken") orelse return error.InvalidInstanceRecord;
    const token = if (token_value == .null) null else if (token_value == .string and token_value.string.len > 0 and token_value.string.len <= max_field_bytes) try allocator.dupe(u8, token_value.string) else return error.InvalidInstanceRecord;
    return .{ .pid = pid, .process_group_id = group.value, .session_id = session.value, .start_token = token };
}

fn parseDocker(allocator: std.mem.Allocator, object: std.json.ObjectMap) !Docker {
    const container_id = try duplicateField(allocator, object, "containerId");
    errdefer allocator.free(container_id);
    const daemon_id = try duplicateField(allocator, object, "daemonId");
    errdefer allocator.free(daemon_id);
    const executable_path = try duplicateField(allocator, object, "executablePath");
    errdefer allocator.free(executable_path);
    return .{
        .container_id = container_id,
        .daemon_id = daemon_id,
        .executable_path = executable_path,
        .executable_token = try duplicateField(allocator, object, "executableToken"),
    };
}

fn parseDockerPending(allocator: std.mem.Allocator, object: std.json.ObjectMap) !DockerPending {
    const container_name = try duplicateField(allocator, object, "containerName");
    errdefer allocator.free(container_name);
    const nonce = try duplicateField(allocator, object, "nonce");
    errdefer allocator.free(nonce);
    const daemon_id = try duplicateField(allocator, object, "daemonId");
    errdefer allocator.free(daemon_id);
    const executable_path = try duplicateField(allocator, object, "executablePath");
    errdefer allocator.free(executable_path);
    return .{
        .container_name = container_name,
        .nonce = nonce,
        .daemon_id = daemon_id,
        .executable_path = executable_path,
        .executable_token = try duplicateField(allocator, object, "executableToken"),
    };
}

fn parseRemote(allocator: std.mem.Allocator, object: std.json.ObjectMap) !Remote {
    const node_id = try duplicateField(allocator, object, "nodeId");
    errdefer allocator.free(node_id);
    return .{ .node_id = node_id, .name = try duplicateField(allocator, object, "name") };
}

fn duplicateField(allocator: std.mem.Allocator, object: std.json.ObjectMap, name: []const u8) ![]u8 {
    return allocator.dupe(u8, stringField(object, name) orelse return error.InvalidInstanceRecord);
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string or value.string.len == 0 or value.string.len > max_field_bytes) return null;
    return value.string;
}

const NullableI32 = struct { value: ?i32 };

fn nullableI32(value: ?std.json.Value) ?NullableI32 {
    const present = value orelse return null;
    if (present == .null) return .{ .value = null };
    return .{ .value = positiveI32(present) orelse return null };
}

fn positiveI32(value: ?std.json.Value) ?i32 {
    const present = value orelse return null;
    if (present != .integer or present.integer <= 0 or present.integer > std.math.maxInt(i32)) return null;
    return @intCast(present.integer);
}
