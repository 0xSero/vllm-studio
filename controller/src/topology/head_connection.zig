const std = @import("std");
const config = @import("../app/config.zig");
const repository = @import("head_connection_store.zig");
const harness_runtime = @import("../agent/harness/runtime.zig");

const Io = std.Io;
const http = std.http;
const max_response_bytes = 1024 * 1024;

pub fn payload(allocator: std.mem.Allocator, io: Io, data_dir: []const u8) ![]u8 {
    var connection = try repository.load(allocator, io, data_dir);
    defer if (connection) |*value| value.deinit();
    if (connection == null) return allocator.dupe(u8, "{\"connected\":false,\"name\":null,\"url\":null,\"hasApiKey\":false}");
    return response(allocator, &connection.?);
}

pub fn updatePayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, client: *http.Client, data_dir: []const u8, hostname: []const u8, os: []const u8, harness: *harness_runtime.Manager, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidHeadConnection;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidHeadConnection;
    const name = optionalString(parsed.value.object, "name") orelse "Studio Head";
    const raw_url = optionalString(parsed.value.object, "url") orelse return error.HeadUrlRequired;
    const api_key = optionalString(parsed.value.object, "apiKey") orelse "local-studio";
    const raw_node_address = optionalString(parsed.value.object, "nodeAddress");
    const node_api_key = optionalString(parsed.value.object, "nodeApiKey");
    if ((raw_node_address == null) != (node_api_key == null)) return error.IncompleteEnrollment;
    const url = try normalizeUrl(allocator, raw_url);
    defer allocator.free(url);
    var existing = try repository.load(allocator, io, data_dir);
    defer if (existing) |*value| value.deinit();
    if (raw_node_address == null) {
        const same_head = if (existing) |value| std.mem.eql(u8, value.url, url) else false;
        try repository.save(
            allocator,
            io,
            data_dir,
            name,
            url,
            api_key,
            if (same_head) existing.?.node_id else "",
            if (same_head) existing.?.node_address else "",
        );
        var connection = (try repository.load(allocator, io, data_dir)) orelse return error.HeadConnectionWriteFailed;
        defer connection.deinit();
        return response(allocator, &connection);
    }
    const node_address = try normalizeUrl(allocator, raw_node_address.?);
    defer allocator.free(node_address);
    var random: [16]u8 = undefined;
    io.random(&random);
    const generated = std.fmt.bytesToHex(random, .lower);
    const node_id = if (existing) |value| if (value.node_id.len > 0) value.node_id else generated[0..] else generated[0..];
    const enrollment = try enrollmentDocument(allocator, mode, node_id, hostname, os, node_address, node_api_key.?, harness);
    defer allocator.free(enrollment);
    try sendEnrollment(allocator, client, url, api_key, .POST, "/api/agent/enrollments", enrollment);
    try repository.save(allocator, io, data_dir, name, url, api_key, node_id, node_address);
    var connection = (try repository.load(allocator, io, data_dir)) orelse return error.HeadConnectionWriteFailed;
    defer connection.deinit();
    return response(allocator, &connection);
}

pub fn deletePayload(allocator: std.mem.Allocator, io: Io, client: *http.Client, data_dir: []const u8) ![]u8 {
    var connection = try repository.load(allocator, io, data_dir);
    defer if (connection) |*value| value.deinit();
    if (connection) |value| if (value.node_id.len > 0) {
        const path = try std.fmt.allocPrint(allocator, "/api/agent/enrollments/{s}", .{value.node_id});
        defer allocator.free(path);
        sendEnrollment(allocator, client, value.url, value.api_key, .DELETE, path, null) catch |failure| std.log.warn("Head enrollment cleanup failed: {t}", .{failure});
    };
    try repository.remove(allocator, io, data_dir);
    return allocator.dupe(u8, "{\"success\":true,\"connected\":false}");
}

fn response(allocator: std.mem.Allocator, connection: *const repository.Connection) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"connected\":true,\"name\":");
    try std.json.Stringify.value(connection.name, .{}, &output.writer);
    try output.writer.writeAll(",\"url\":");
    try std.json.Stringify.value(connection.url, .{}, &output.writer);
    try output.writer.print(",\"hasApiKey\":{},\"nodeId\":", .{connection.api_key.len > 0});
    try std.json.Stringify.value(connection.node_id, .{}, &output.writer);
    try output.writer.writeAll(",\"nodeAddress\":");
    try std.json.Stringify.value(connection.node_address, .{}, &output.writer);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn enrollmentDocument(allocator: std.mem.Allocator, mode: config.Mode, node_id: []const u8, hostname: []const u8, os: []const u8, address: []const u8, api_key: []const u8, harness: *harness_runtime.Manager) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"nodeId\":");
    try std.json.Stringify.value(node_id, .{}, &output.writer);
    try output.writer.writeAll(",\"name\":");
    try std.json.Stringify.value(hostname, .{}, &output.writer);
    try output.writer.writeAll(",\"hostname\":");
    try std.json.Stringify.value(hostname, .{}, &output.writer);
    try output.writer.writeAll(",\"os\":");
    try std.json.Stringify.value(os, .{}, &output.writer);
    try output.writer.writeAll(",\"address\":");
    try std.json.Stringify.value(address, .{}, &output.writer);
    try output.writer.writeAll(",\"apiKey\":");
    try std.json.Stringify.value(api_key, .{}, &output.writer);
    try output.writer.writeAll(",\"role\":");
    try std.json.Stringify.value(if (mode == .worker) "worker" else "standalone", .{}, &output.writer);
    try output.writer.writeAll(",\"capabilities\":{\"compute\":true,\"harnesses\":[");
    var first_harness = true;
    if (harness.piIsAvailable()) try writeHarnessId(&output.writer, "pi", &first_harness);
    if (harness.fxIsAvailable()) try writeHarnessId(&output.writer, "fx", &first_harness);
    if (harness.opencodeIsAvailable()) try writeHarnessId(&output.writer, "opencode", &first_harness);
    if (harness.codexIsAvailable()) try writeHarnessId(&output.writer, "codex", &first_harness);
    if (harness.claudeIsAvailable()) try writeHarnessId(&output.writer, "claude", &first_harness);
    try output.writer.writeAll("],\"mcp\":true,\"terminal\":true,\"browser\":true,\"harnessDetails\":[");
    var first_detail = true;
    if (harness.piIsAvailable()) try writeHarnessDetail(&output.writer, "pi", harness.piVersion(), harness.piSource(), "[\"persistent-session\",\"resume\",\"steer\",\"follow-up\",\"cancel\",\"images\",\"compact\",\"extension-ui\",\"extension-mcp\"]", &first_detail);
    if (harness.fxIsAvailable()) try writeHarnessDetail(&output.writer, "fx", harness.fxVersion(), harness.fxSource(), "[\"persistent-session\",\"cancel\",\"mcp\",\"filesystem-free\"]", &first_detail);
    if (harness.opencodeIsAvailable()) try writeHarnessDetail(&output.writer, "opencode", harness.opencodeVersion(), harness.opencodeSource(), "[\"persistent-session\",\"resume\",\"cancel\",\"mcp\",\"tools\"]", &first_detail);
    if (harness.codexIsAvailable()) try writeHarnessDetail(&output.writer, "codex", harness.codexVersion(), harness.codexSource(), "[\"persistent-session\",\"resume\",\"cancel\"]", &first_detail);
    if (harness.claudeIsAvailable()) try writeHarnessDetail(&output.writer, "claude", harness.claudeVersion(), harness.claudeSource(), "[\"persistent-session\",\"resume\",\"cancel\",\"mcp\",\"tools\"]", &first_detail);
    try output.writer.writeAll("]}}");
    return output.toOwnedSlice();
}

fn writeHarnessId(writer: *Io.Writer, id: []const u8, first: *bool) !void {
    if (!first.*) try writer.writeByte(',');
    first.* = false;
    try std.json.Stringify.value(id, .{}, writer);
}

fn writeHarnessDetail(writer: *Io.Writer, id: []const u8, version: ?[]const u8, source: []const u8, capabilities: []const u8, first: *bool) !void {
    if (!first.*) try writer.writeByte(',');
    first.* = false;
    try writer.writeAll("{\"id\":");
    try std.json.Stringify.value(id, .{}, writer);
    try writer.writeAll(",\"version\":");
    if (version) |value| try std.json.Stringify.value(value, .{}, writer) else try writer.writeAll("null");
    try writer.writeAll(",\"source\":");
    try std.json.Stringify.value(source, .{}, writer);
    try writer.writeAll(",\"capabilities\":");
    try writer.writeAll(capabilities);
    try writer.writeByte('}');
}

fn sendEnrollment(allocator: std.mem.Allocator, client: *http.Client, head_url: []const u8, api_key: []const u8, method: http.Method, path: []const u8, payload_value: ?[]const u8) !void {
    const url = try std.fmt.allocPrint(allocator, "{s}{s}", .{ head_url, path });
    defer allocator.free(url);
    const authorization = try std.fmt.allocPrint(allocator, "Bearer {s}", .{api_key});
    defer allocator.free(authorization);
    const storage = try allocator.alloc(u8, max_response_bytes);
    defer allocator.free(storage);
    var output: Io.Writer = .fixed(storage);
    const response_value = try client.fetch(.{
        .location = .{ .url = url },
        .method = method,
        .payload = payload_value,
        .redirect_behavior = .unhandled,
        .keep_alive = false,
        .headers = .{ .accept_encoding = .omit },
        .extra_headers = &.{
            .{ .name = "Authorization", .value = authorization },
            .{ .name = "Content-Type", .value = "application/json" },
        },
        .response_writer = &output,
    });
    if (response_value.status.class() != .success) return error.HeadEnrollmentRejected;
}

fn normalizeUrl(allocator: std.mem.Allocator, value: []const u8) ![]u8 {
    const trimmed = std.mem.trimEnd(u8, std.mem.trim(u8, value, " \t\r\n"), "/");
    if (trimmed.len == 0) return error.InvalidHeadUrl;
    const uri = std.Uri.parse(trimmed) catch return error.InvalidHeadUrl;
    if ((!std.ascii.eqlIgnoreCase(uri.scheme, "http") and !std.ascii.eqlIgnoreCase(uri.scheme, "https")) or uri.host == null) return error.InvalidHeadUrl;
    return allocator.dupe(u8, trimmed);
}

fn optionalString(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len > 0) trimmed else null;
}
