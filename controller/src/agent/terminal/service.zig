const std = @import("std");
const config = @import("../../app/config.zig");
const sqlite = @import("../../storage/sqlite.zig");
const agent_projects = @import("../projects/service.zig");
const harness_nodes = @import("../harness/nodes.zig");
const node_transport = @import("../../topology/node_transport.zig");

const Io = std.Io;
const http = std.http;
const max_output_bytes = 2 * 1024 * 1024;

pub fn runPayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, configuration: *const config.Config, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8, cwd: []const u8, document: []const u8) ![]u8 {
    if (mode == .standalone) return runLocal(allocator, io, configuration, cwd, document);
    var target = (try harness_nodes.selectCapability(allocator, io, database, "terminal", preferred_node)) orelse return error.TerminalNodeRequired;
    defer target.deinit();
    const encoded_cwd = try encodeQuery(allocator, cwd);
    defer allocator.free(encoded_cwd);
    const path = try std.fmt.allocPrint(allocator, "/internal/node/v1/terminal?cwd={s}", .{encoded_cwd});
    defer allocator.free(path);
    return node_transport.send(allocator, client, &target, path, .POST, document) catch |failure| switch (failure) {
        error.NodeRequestRejected => error.TerminalNodeRejected,
        else => failure,
    };
}

pub fn resolvePayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, configuration: *const config.Config, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8, document: []const u8) ![]u8 {
    if (mode == .standalone) return resolveLocal(allocator, io, configuration, document);
    var target = (try harness_nodes.selectCapability(allocator, io, database, "terminal", preferred_node)) orelse return error.TerminalNodeRequired;
    defer target.deinit();
    return node_transport.send(allocator, client, &target, "/internal/node/v1/terminal/resolve-cwd", .POST, document) catch |failure| switch (failure) {
        error.NodeRequestRejected => error.TerminalNodeRejected,
        else => failure,
    };
}

pub fn runLocal(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config, cwd: []const u8, document: []const u8) ![]u8 {
    const resolved_cwd = try agent_projects.resolveAllowedPath(allocator, io, configuration.environment, cwd);
    defer allocator.free(resolved_cwd);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidTerminalPayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidTerminalPayload;
    const command = stringField(parsed.value.object, "command") orelse return error.TerminalCommandRequired;
    if (command.len > 64 * 1024) return error.TerminalCommandTooLarge;
    const shell = configuration.environment.get("SHELL") orelse if (@import("builtin").os.tag == .windows) configuration.environment.get("COMSPEC") orelse "cmd.exe" else "/bin/sh";
    const shell_flag = if (@import("builtin").os.tag == .windows) "/c" else "-lc";
    const result = std.process.run(allocator, io, .{
        .argv = &.{ shell, shell_flag, command },
        .cwd = .{ .path = resolved_cwd },
        .environ_map = configuration.environment,
        .stdout_limit = .limited(max_output_bytes),
        .stderr_limit = .limited(max_output_bytes),
        .timeout = .{ .duration = .{ .clock = .awake, .raw = .fromSeconds(60) } },
    }) catch |failure| return terminalFailure(allocator, command, failure);
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    const exit_code: ?u8 = switch (result.term) {
        .exited => |code| code,
        else => null,
    };
    const ok = exit_code != null and exit_code.? == 0;
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.print("{{\"ok\":{},\"command\":", .{ok});
    try std.json.Stringify.value(command, .{}, &output.writer);
    try output.writer.writeAll(",\"stdout\":");
    try std.json.Stringify.value(result.stdout, .{}, &output.writer);
    try output.writer.writeAll(",\"stderr\":");
    try std.json.Stringify.value(result.stderr, .{}, &output.writer);
    try output.writer.writeAll(",\"exitCode\":");
    if (exit_code) |value| try output.writer.print("{d}", .{value}) else try output.writer.writeAll("null");
    if (!ok) try output.writer.writeAll(",\"error\":\"Command failed\"");
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

pub fn resolveLocal(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidTerminalPayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidTerminalPayload;
    const target = stringField(parsed.value.object, "target") orelse "";
    const from = stringField(parsed.value.object, "from");
    const previous = stringField(parsed.value.object, "previous");
    const home = configuration.environment.get("HOME") orelse return error.HomeDirectoryUnavailable;
    const candidate = if (target.len == 0 or std.mem.eql(u8, target, "~"))
        try allocator.dupe(u8, home)
    else if (std.mem.eql(u8, target, "-"))
        try allocator.dupe(u8, previous orelse return error.PreviousDirectoryUnavailable)
    else if (std.mem.startsWith(u8, target, "~/"))
        try std.fs.path.join(allocator, &.{ home, target[2..] })
    else if (std.fs.path.isAbsolute(target))
        try allocator.dupe(u8, target)
    else
        try std.fs.path.resolve(allocator, &.{ from orelse return error.TerminalFromMustBeAbsolute, target });
    defer allocator.free(candidate);
    if (!std.fs.path.isAbsolute(candidate)) return error.TerminalFromMustBeAbsolute;
    const resolved = try agent_projects.resolveAllowedPath(allocator, io, configuration.environment, candidate);
    defer allocator.free(resolved);
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"ok\":true,\"cwd\":");
    try std.json.Stringify.value(resolved, .{}, &output.writer);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn terminalFailure(allocator: std.mem.Allocator, command: []const u8, failure: anyerror) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"ok\":false,\"command\":");
    try std.json.Stringify.value(command, .{}, &output.writer);
    try output.writer.writeAll(",\"stdout\":\"\",\"stderr\":\"\",\"exitCode\":null,\"error\":");
    try std.json.Stringify.value(@errorName(failure), .{}, &output.writer);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len == 0) null else trimmed;
}

fn encodeQuery(allocator: std.mem.Allocator, value: []const u8) ![]u8 {
    const hex = "0123456789ABCDEF";
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    for (value) |byte| {
        if (std.ascii.isAlphanumeric(byte) or byte == '-' or byte == '_' or byte == '.' or byte == '~') try output.writer.writeByte(byte) else {
            try output.writer.writeByte('%');
            try output.writer.writeByte(hex[byte >> 4]);
            try output.writer.writeByte(hex[byte & 15]);
        }
    }
    return output.toOwnedSlice();
}
