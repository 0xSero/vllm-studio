const std = @import("std");

const Io = std.Io;
const max_line_bytes = 512 * 1024;
const max_output_bytes = 8 * 1024 * 1024;
const max_write_bytes = 128 * 1024;

pub fn run(init: std.process.Init) !void {
    const host = init.environ_map.get("SSH_HOST") orelse return error.SshHostRequired;
    try validateHost(host);
    const timeout_seconds = parseTimeout(init.environ_map.get("SSH_TIMEOUT_S") orelse "60");
    var input_buffer: [16 * 1024]u8 = undefined;
    var output_buffer: [16 * 1024]u8 = undefined;
    var input = Io.File.stdin().reader(init.io, &input_buffer);
    var output = Io.File.stdout().writer(init.io, &output_buffer);
    while (try input.interface.takeDelimiter('\n')) |line_value| {
        const line = std.mem.trim(u8, line_value, " \t\r");
        if (line.len == 0) continue;
        if (line.len > max_line_bytes) return error.McpRequestTooLarge;
        const response = handle(init.gpa, init.io, host, timeout_seconds, line) catch |failure| try errorResponse(init.gpa, line, failure);
        defer init.gpa.free(response);
        try output.interface.writeAll(response);
        try output.interface.writeByte('\n');
        try output.interface.flush();
    }
}

fn handle(allocator: std.mem.Allocator, io: Io, host: []const u8, timeout_seconds: u64, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidMcpRequest;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidMcpRequest;
    const object = parsed.value.object;
    const method = stringField(object, "method") orelse return error.McpMethodRequired;
    const id = object.get("id");
    if (std.mem.eql(u8, method, "notifications/initialized")) return allocator.dupe(u8, "");
    if (id == null) return allocator.dupe(u8, "");
    if (std.mem.eql(u8, method, "initialize")) return initializeResponse(allocator, id.?, object.get("params"), host);
    if (std.mem.eql(u8, method, "tools/list")) return toolsResponse(allocator, id.?, host);
    if (std.mem.eql(u8, method, "tools/call")) return callResponse(allocator, io, id.?, object.get("params"), host, timeout_seconds);
    return rpcError(allocator, id.?, -32601, "unknown method");
}

fn initializeResponse(allocator: std.mem.Allocator, id: std.json.Value, params: ?std.json.Value, host: []const u8) ![]u8 {
    const protocol = if (params) |value| if (value == .object) stringField(value.object, "protocolVersion") orelse "2025-03-26" else "2025-03-26" else "2025-03-26";
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"jsonrpc\":\"2.0\",\"id\":");
    try std.json.Stringify.value(id, .{}, &output.writer);
    try output.writer.writeAll(",\"result\":{\"protocolVersion\":");
    try std.json.Stringify.value(protocol, .{}, &output.writer);
    try output.writer.writeAll(",\"capabilities\":{\"tools\":{}},\"serverInfo\":{\"name\":");
    const name = try std.fmt.allocPrint(allocator, "ssh-remote({s})", .{host});
    defer allocator.free(name);
    try std.json.Stringify.value(name, .{}, &output.writer);
    try output.writer.writeAll(",\"version\":\"1.0.0\"}}}");
    return output.toOwnedSlice();
}

fn toolsResponse(allocator: std.mem.Allocator, id: std.json.Value, host: []const u8) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"jsonrpc\":\"2.0\",\"id\":");
    try std.json.Stringify.value(id, .{}, &output.writer);
    try output.writer.writeAll(",\"result\":{\"tools\":[");
    const run_description = try std.fmt.allocPrint(allocator, "Run a shell command on {s} and return stdout/stderr.", .{host});
    defer allocator.free(run_description);
    const read_description = try std.fmt.allocPrint(allocator, "Read a text file from {s}.", .{host});
    defer allocator.free(read_description);
    const write_description = try std.fmt.allocPrint(allocator, "Write a text file on {s} (overwrites).", .{host});
    defer allocator.free(write_description);
    const list_description = try std.fmt.allocPrint(allocator, "List a directory on {s}.", .{host});
    defer allocator.free(list_description);
    try writeTool(&output.writer, "run_command", run_description, "command");
    try output.writer.writeByte(',');
    try writeTool(&output.writer, "read_file", read_description, "path");
    try output.writer.writeByte(',');
    try writeTool(&output.writer, "write_file", write_description, "path,content");
    try output.writer.writeByte(',');
    try writeTool(&output.writer, "list_dir", list_description, "path");
    try output.writer.writeAll("]}}");
    return output.toOwnedSlice();
}

fn writeTool(writer: *Io.Writer, name: []const u8, description: []const u8, fields: []const u8) !void {
    try writer.writeAll("{\"name\":");
    try std.json.Stringify.value(name, .{}, writer);
    try writer.writeAll(",\"description\":");
    try std.json.Stringify.value(description, .{}, writer);
    try writer.writeAll(",\"inputSchema\":{\"type\":\"object\",\"properties\":{");
    var values = std.mem.splitScalar(u8, fields, ',');
    var first = true;
    while (values.next()) |field| {
        if (!first) try writer.writeByte(',');
        try std.json.Stringify.value(field, .{}, writer);
        try writer.writeAll(":{\"type\":\"string\"}");
        first = false;
    }
    try writer.writeAll("},\"required\":[");
    values = std.mem.splitScalar(u8, fields, ',');
    first = true;
    while (values.next()) |field| {
        if (!first) try writer.writeByte(',');
        try std.json.Stringify.value(field, .{}, writer);
        first = false;
    }
    try writer.writeAll("]}}");
}

fn callResponse(allocator: std.mem.Allocator, io: Io, id: std.json.Value, params_value: ?std.json.Value, host: []const u8, timeout_seconds: u64) ![]u8 {
    const params = params_value orelse return error.McpParamsRequired;
    if (params != .object) return error.McpParamsRequired;
    const name = stringField(params.object, "name") orelse return error.McpToolRequired;
    const arguments_value: std.json.Value = params.object.get("arguments") orelse .{ .object = .empty };
    if (arguments_value != .object) return error.InvalidMcpArguments;
    const remote_command = try toolCommand(allocator, name, arguments_value.object);
    defer allocator.free(remote_command);
    const result = try std.process.run(allocator, io, .{
        .argv = &.{ "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", host, remote_command },
        .stdout_limit = .limited(max_output_bytes),
        .stderr_limit = .limited(max_output_bytes),
        .timeout = .{ .duration = .{ .clock = .awake, .raw = .fromSeconds(@intCast(timeout_seconds)) } },
    });
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    const ok = switch (result.term) {
        .exited => |code| code == 0,
        else => false,
    };
    var text: Io.Writer.Allocating = .init(allocator);
    defer text.deinit();
    if (!ok) try text.writer.writeAll("ERROR: ");
    if (result.stderr.len > 0) try text.writer.writeAll(result.stderr);
    if (result.stdout.len > 0) try text.writer.writeAll(result.stdout);
    if (text.writer.buffered().len == 0) try text.writer.writeAll("(no output)");
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"jsonrpc\":\"2.0\",\"id\":");
    try std.json.Stringify.value(id, .{}, &output.writer);
    try output.writer.writeAll(",\"result\":{\"content\":[{\"type\":\"text\",\"text\":");
    try std.json.Stringify.value(text.writer.buffered()[0..@min(text.writer.buffered().len, 200_000)], .{}, &output.writer);
    try output.writer.print("}}],\"isError\":{}}}}}", .{!ok});
    return output.toOwnedSlice();
}

fn toolCommand(allocator: std.mem.Allocator, name: []const u8, arguments: std.json.ObjectMap) ![]u8 {
    if (std.mem.eql(u8, name, "run_command")) return allocator.dupe(u8, stringField(arguments, "command") orelse return error.McpCommandRequired);
    const path = stringField(arguments, "path") orelse return error.McpPathRequired;
    const quoted_path = try shellQuote(allocator, path);
    defer allocator.free(quoted_path);
    if (std.mem.eql(u8, name, "read_file")) return std.fmt.allocPrint(allocator, "cat {s}", .{quoted_path});
    if (std.mem.eql(u8, name, "list_dir")) return std.fmt.allocPrint(allocator, "ls -la {s}", .{quoted_path});
    if (std.mem.eql(u8, name, "write_file")) {
        const content = stringField(arguments, "content") orelse return error.McpContentRequired;
        if (content.len > max_write_bytes) return error.McpContentTooLarge;
        const encoded = try allocator.alloc(u8, std.base64.standard.Encoder.calcSize(content.len));
        defer allocator.free(encoded);
        _ = std.base64.standard.Encoder.encode(encoded, content);
        const quoted = try shellQuote(allocator, encoded);
        defer allocator.free(quoted);
        return std.fmt.allocPrint(allocator, "printf %s {s} | base64 -d > {s}", .{ quoted, quoted_path });
    }
    return error.UnknownMcpTool;
}

fn shellQuote(allocator: std.mem.Allocator, value: []const u8) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeByte('\'');
    for (value) |character| if (character == '\'') try output.writer.writeAll("'\\''") else try output.writer.writeByte(character);
    try output.writer.writeByte('\'');
    return output.toOwnedSlice();
}

fn errorResponse(allocator: std.mem.Allocator, request: []const u8, failure: anyerror) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, request, .{}) catch return rpcError(allocator, .null, -32700, "parse error");
    defer parsed.deinit();
    const id = if (parsed.value == .object) parsed.value.object.get("id") orelse .null else .null;
    return rpcError(allocator, id, -32603, @errorName(failure));
}

fn rpcError(allocator: std.mem.Allocator, id: std.json.Value, code: i32, message: []const u8) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"jsonrpc\":\"2.0\",\"id\":");
    try std.json.Stringify.value(id, .{}, &output.writer);
    try output.writer.print(",\"error\":{{\"code\":{d},\"message\":", .{code});
    try std.json.Stringify.value(message, .{}, &output.writer);
    try output.writer.writeAll("}}");
    return output.toOwnedSlice();
}

fn validateHost(host: []const u8) !void {
    if (host.len == 0 or host.len > 512 or host[0] == '-') return error.InvalidSshHost;
    for (host) |character| if (!std.ascii.isAlphanumeric(character) and character != '.' and character != '_' and character != '@' and character != '-') return error.InvalidSshHost;
}

fn parseTimeout(value: []const u8) u64 {
    return std.math.clamp(std.fmt.parseInt(u64, value, 10) catch 60, 1, 600);
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    return if (value == .string) value.string else null;
}
