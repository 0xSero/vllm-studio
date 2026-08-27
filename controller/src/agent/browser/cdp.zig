const std = @import("std");

const Io = std.Io;
const max_message_bytes = 8 * 1024 * 1024;

pub const Client = struct {
    allocator: std.mem.Allocator,
    io: Io,
    child: std.process.Child,
    stream: Io.net.Stream,
    reader: Io.net.Stream.Reader,
    writer: Io.net.Stream.Writer,
    read_buffer: []u8,
    write_buffer: []u8,
    profile_dir: []u8,
    host_mode: bool,
    next_id: u64 = 1,

    pub fn start(allocator: std.mem.Allocator, io: Io, executable: []const u8, host_script: ?[]const u8, data_dir: []const u8) !Client {
        const profile_dir = try std.fs.path.join(allocator, &.{ data_dir, "browser", "chromium" });
        defer allocator.free(profile_dir);
        _ = try Io.Dir.cwd().createDirPathStatus(io, profile_dir, @enumFromInt(0o700));
        const profile_arg = try std.fmt.allocPrint(allocator, "--user-data-dir={s}", .{profile_dir});
        defer allocator.free(profile_arg);
        const port_file = try std.fs.path.join(allocator, &.{ profile_dir, "DevToolsActivePort" });
        defer allocator.free(port_file);
        Io.Dir.cwd().deleteFile(io, port_file) catch |failure| switch (failure) {
            error.FileNotFound => {},
            else => return failure,
        };
        var argv: std.ArrayList([]const u8) = .empty;
        defer argv.deinit(allocator);
        try argv.appendSlice(allocator, &.{ executable, "--headless=new", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync", profile_arg });
        try argv.append(allocator, host_script orelse "about:blank");
        var child = try std.process.spawn(io, .{
            .argv = argv.items,
            .stdin = .ignore,
            .stdout = .ignore,
            .stderr = .ignore,
            .pgid = 0,
        });
        errdefer if (child.id != null) child.kill(io);
        var document: ?[]u8 = null;
        for (0..100) |_| {
            document = Io.Dir.cwd().readFileAlloc(io, port_file, allocator, .limited(4096)) catch null;
            if (document != null) break;
            try io.sleep(.fromMilliseconds(50), .awake);
        }
        const port_document = document orelse return error.BrowserLaunchTimedOut;
        defer allocator.free(port_document);
        var lines = std.mem.splitScalar(u8, port_document, '\n');
        const port = std.fmt.parseInt(u16, std.mem.trim(u8, lines.next() orelse "", " \t\r"), 10) catch return error.InvalidDevToolsPort;
        const path = std.mem.trim(u8, lines.next() orelse return error.InvalidDevToolsPort, " \t\r");
        const address = try Io.net.IpAddress.parse("127.0.0.1", port);
        const stream = try address.connect(io, .{ .mode = .stream, .protocol = .tcp });
        errdefer stream.close(io);
        const read_buffer = try allocator.alloc(u8, 64 * 1024);
        errdefer allocator.free(read_buffer);
        const write_buffer = try allocator.alloc(u8, 64 * 1024);
        errdefer allocator.free(write_buffer);
        var reader = stream.reader(io, read_buffer);
        var writer = stream.writer(io, write_buffer);
        var key_bytes: [16]u8 = undefined;
        io.random(&key_bytes);
        var key_buffer: [std.base64.standard.Encoder.calcSize(key_bytes.len)]u8 = undefined;
        const key = std.base64.standard.Encoder.encode(&key_buffer, &key_bytes);
        try writer.interface.print("GET {s} HTTP/1.1\r\nHost: 127.0.0.1:{d}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {s}\r\nSec-WebSocket-Version: 13\r\n\r\n", .{ path, port, key });
        try writer.interface.flush();
        const status = try reader.interface.takeDelimiter('\n') orelse return error.BrowserHandshakeFailed;
        if (std.mem.indexOf(u8, status, "101") == null) return error.BrowserHandshakeFailed;
        while (try reader.interface.takeDelimiter('\n')) |line| if (std.mem.trim(u8, line, " \t\r").len == 0) break;
        return .{
            .allocator = allocator,
            .io = io,
            .child = child,
            .stream = stream,
            .reader = reader,
            .writer = writer,
            .read_buffer = read_buffer,
            .write_buffer = write_buffer,
            .profile_dir = try allocator.dupe(u8, profile_dir),
            .host_mode = host_script != null,
        };
    }

    pub fn deinit(client: *Client) void {
        client.stream.close(client.io);
        if (client.child.id != null) client.child.kill(client.io);
        client.allocator.free(client.read_buffer);
        client.allocator.free(client.write_buffer);
        client.allocator.free(client.profile_dir);
        client.* = undefined;
    }

    pub fn command(client: *Client, allocator: std.mem.Allocator, method: []const u8, params: []const u8, session_id: ?[]const u8) ![]u8 {
        const id = client.next_id;
        client.next_id += 1;
        var request: Io.Writer.Allocating = .init(allocator);
        defer request.deinit();
        try request.writer.print("{{\"id\":{d},\"method\":", .{id});
        try std.json.Stringify.value(method, .{}, &request.writer);
        try request.writer.writeAll(",\"params\":");
        try request.writer.writeAll(params);
        if (session_id) |value| {
            try request.writer.writeAll(",\"sessionId\":");
            try std.json.Stringify.value(value, .{}, &request.writer);
        }
        try request.writer.writeByte('}');
        try client.writeFrame(request.writer.buffered(), 0x1);
        while (true) {
            const message = try client.readFrame(allocator);
            defer allocator.free(message);
            var parsed = std.json.parseFromSlice(std.json.Value, allocator, message, .{}) catch continue;
            defer parsed.deinit();
            if (parsed.value != .object) continue;
            const response_id = parsed.value.object.get("id") orelse continue;
            if (response_id != .integer or response_id.integer != id) continue;
            if (parsed.value.object.get("error") != null) {
                std.log.warn("DevTools command {s} rejected: {s}", .{ method, message });
                return error.DevToolsCommandFailed;
            }
            return allocator.dupe(u8, message);
        }
    }

    pub fn createTarget(client: *Client, allocator: std.mem.Allocator, session_key: []const u8, browser_context_id: ?[]const u8) ![]u8 {
        if (!client.host_mode) {
            var params: Io.Writer.Allocating = .init(allocator);
            defer params.deinit();
            try params.writer.writeAll("{\"url\":\"about:blank\"");
            if (browser_context_id) |value| {
                try params.writer.writeAll(",\"browserContextId\":");
                try std.json.Stringify.value(value, .{}, &params.writer);
            }
            try params.writer.writeByte('}');
            const response = try client.command(allocator, "Target.createTarget", params.writer.buffered(), null);
            defer allocator.free(response);
            return responseString(allocator, response, "targetId");
        }
        var digest: [32]u8 = undefined;
        std.crypto.hash.sha2.Sha256.hash(session_key, &digest, .{});
        const hex = std.fmt.bytesToHex(digest, .lower);
        const marker = try std.fmt.allocPrint(allocator, "local-studio-{s}", .{hex[0..]});
        defer allocator.free(marker);
        const requests_dir = try std.fs.path.join(allocator, &.{ client.profile_dir, "browser-host", "requests" });
        defer allocator.free(requests_dir);
        const responses_dir = try std.fs.path.join(allocator, &.{ client.profile_dir, "browser-host", "responses" });
        defer allocator.free(responses_dir);
        _ = try Io.Dir.cwd().createDirPathStatus(client.io, requests_dir, @enumFromInt(0o700));
        _ = try Io.Dir.cwd().createDirPathStatus(client.io, responses_dir, @enumFromInt(0o700));
        const filename = try std.fmt.allocPrint(allocator, "{s}.json", .{hex[0..]});
        defer allocator.free(filename);
        const request_path = try std.fs.path.join(allocator, &.{ requests_dir, filename });
        defer allocator.free(request_path);
        const response_path = try std.fs.path.join(allocator, &.{ responses_dir, filename });
        defer allocator.free(response_path);
        var document: Io.Writer.Allocating = .init(allocator);
        defer document.deinit();
        try document.writer.writeAll("{\"sessionId\":");
        try std.json.Stringify.value(session_key, .{}, &document.writer);
        try document.writer.writeAll(",\"marker\":");
        try std.json.Stringify.value(marker, .{}, &document.writer);
        try document.writer.writeByte('}');
        var request_file = try Io.Dir.cwd().createFile(client.io, request_path, .{ .permissions = @enumFromInt(0o600), .truncate = true });
        defer request_file.close(client.io);
        try request_file.writeStreamingAll(client.io, document.writer.buffered());
        var ready = false;
        for (0..100) |_| {
            _ = Io.Dir.cwd().statFile(client.io, response_path, .{}) catch {
                try client.io.sleep(.fromMilliseconds(50), .awake);
                continue;
            };
            ready = true;
            break;
        }
        if (!ready) return error.BrowserHostTimedOut;
        const targets = try client.command(allocator, "Target.getTargets", "{}", null);
        defer allocator.free(targets);
        return targetForMarker(allocator, targets, marker);
    }

    fn writeFrame(client: *Client, payload: []const u8, opcode: u8) !void {
        if (payload.len > max_message_bytes) return error.DevToolsMessageTooLarge;
        var header: [14]u8 = undefined;
        var length: usize = 0;
        header[length] = 0x80 | opcode;
        length += 1;
        if (payload.len < 126) {
            header[length] = 0x80 | @as(u8, @intCast(payload.len));
            length += 1;
        } else if (payload.len <= std.math.maxInt(u16)) {
            header[length] = 0x80 | 126;
            std.mem.writeInt(u16, header[length + 1 ..][0..2], @intCast(payload.len), .big);
            length += 3;
        } else {
            header[length] = 0x80 | 127;
            std.mem.writeInt(u64, header[length + 1 ..][0..8], @intCast(payload.len), .big);
            length += 9;
        }
        var mask: [4]u8 = undefined;
        client.io.random(&mask);
        @memcpy(header[length..][0..4], &mask);
        length += 4;
        const masked = try client.allocator.alloc(u8, payload.len);
        defer client.allocator.free(masked);
        for (payload, 0..) |byte, index| masked[index] = byte ^ mask[index % 4];
        try client.writer.interface.writeAll(header[0..length]);
        try client.writer.interface.writeAll(masked);
        try client.writer.interface.flush();
    }

    fn readFrame(client: *Client, allocator: std.mem.Allocator) ![]u8 {
        while (true) {
            const first = try client.reader.interface.takeByte();
            const second = try client.reader.interface.takeByte();
            const opcode = first & 0x0f;
            var length: u64 = second & 0x7f;
            if (length == 126) {
                var value: [2]u8 = undefined;
                try client.reader.interface.readSliceAll(&value);
                length = std.mem.readInt(u16, &value, .big);
            } else if (length == 127) {
                var value: [8]u8 = undefined;
                try client.reader.interface.readSliceAll(&value);
                length = std.mem.readInt(u64, &value, .big);
            }
            if (length > max_message_bytes) return error.DevToolsMessageTooLarge;
            var mask: ?[4]u8 = null;
            if ((second & 0x80) != 0) {
                mask = undefined;
                try client.reader.interface.readSliceAll(&mask.?);
            }
            const payload = try allocator.alloc(u8, @intCast(length));
            errdefer allocator.free(payload);
            try client.reader.interface.readSliceAll(payload);
            if (mask) |key| {
                for (payload, 0..) |*byte, index| byte.* ^= key[index % 4];
            }
            if (opcode == 0x8) return error.DevToolsConnectionClosed;
            if (opcode == 0x9) {
                try client.writeFrame(payload, 0xA);
                allocator.free(payload);
                continue;
            }
            if (opcode != 0x1 and opcode != 0x2) {
                allocator.free(payload);
                continue;
            }
            return payload;
        }
    }
};

fn responseString(allocator: std.mem.Allocator, document: []const u8, field: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidDevToolsResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidDevToolsResponse;
    const result = parsed.value.object.get("result") orelse return error.InvalidDevToolsResponse;
    if (result != .object) return error.InvalidDevToolsResponse;
    const value = result.object.get(field) orelse return error.InvalidDevToolsResponse;
    if (value != .string) return error.InvalidDevToolsResponse;
    return allocator.dupe(u8, value.string);
}

fn targetForMarker(allocator: std.mem.Allocator, document: []const u8, marker: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidDevToolsResponse;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidDevToolsResponse;
    const result = parsed.value.object.get("result") orelse return error.InvalidDevToolsResponse;
    if (result != .object) return error.InvalidDevToolsResponse;
    const infos = result.object.get("targetInfos") orelse return error.InvalidDevToolsResponse;
    if (infos != .array) return error.InvalidDevToolsResponse;
    for (infos.array.items) |info| {
        if (info != .object) continue;
        const url_value = info.object.get("url") orelse continue;
        const id_value = info.object.get("targetId") orelse continue;
        if (url_value != .string or id_value != .string) continue;
        if (std.mem.endsWith(u8, url_value.string, marker)) return allocator.dupe(u8, id_value.string);
    }
    return error.BrowserHostTargetMissing;
}
