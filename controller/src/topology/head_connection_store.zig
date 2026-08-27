const std = @import("std");

const max_document_bytes = 1024 * 1024;

pub const Connection = struct {
    allocator: std.mem.Allocator,
    name: []u8,
    url: []u8,
    api_key: []u8,
    node_id: []u8,
    node_address: []u8,

    pub fn deinit(connection: *Connection) void {
        connection.allocator.free(connection.name);
        connection.allocator.free(connection.url);
        connection.allocator.free(connection.api_key);
        connection.allocator.free(connection.node_id);
        connection.allocator.free(connection.node_address);
        connection.* = undefined;
    }
};

pub fn load(allocator: std.mem.Allocator, io: std.Io, data_dir: []const u8) !?Connection {
    const connection_path = try path(allocator, data_dir);
    defer allocator.free(connection_path);
    const document = std.Io.Dir.cwd().readFileAlloc(io, connection_path, allocator, .limited(max_document_bytes)) catch |failure| switch (failure) {
        error.FileNotFound => return null,
        else => return failure,
    };
    defer allocator.free(document);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return null;
    defer parsed.deinit();
    if (parsed.value != .object) return null;
    const name = stringField(parsed.value.object, "name") orelse "Studio Head";
    const url = stringField(parsed.value.object, "url") orelse return null;
    const api_key = stringField(parsed.value.object, "api_key") orelse "local-studio";
    const node_id = stringField(parsed.value.object, "node_id") orelse return null;
    const node_address = stringField(parsed.value.object, "node_address") orelse return null;
    const owned_name = try allocator.dupe(u8, name);
    errdefer allocator.free(owned_name);
    const owned_url = try allocator.dupe(u8, url);
    errdefer allocator.free(owned_url);
    const owned_key = try allocator.dupe(u8, api_key);
    errdefer allocator.free(owned_key);
    const owned_node_id = try allocator.dupe(u8, node_id);
    errdefer allocator.free(owned_node_id);
    return .{
        .allocator = allocator,
        .name = owned_name,
        .url = owned_url,
        .api_key = owned_key,
        .node_id = owned_node_id,
        .node_address = try allocator.dupe(u8, node_address),
    };
}

pub fn save(allocator: std.mem.Allocator, io: std.Io, data_dir: []const u8, name: []const u8, url: []const u8, api_key: []const u8, node_id: []const u8, node_address: []const u8) !void {
    const connection_path = try path(allocator, data_dir);
    defer allocator.free(connection_path);
    var output: std.Io.Writer.Allocating = .init(allocator);
    defer output.deinit();
    try output.writer.writeAll("{\"version\":1,\"name\":");
    try std.json.Stringify.value(name, .{}, &output.writer);
    try output.writer.writeAll(",\"url\":");
    try std.json.Stringify.value(url, .{}, &output.writer);
    try output.writer.writeAll(",\"api_key\":");
    try std.json.Stringify.value(api_key, .{}, &output.writer);
    try output.writer.writeAll(",\"node_id\":");
    try std.json.Stringify.value(node_id, .{}, &output.writer);
    try output.writer.writeAll(",\"node_address\":");
    try std.json.Stringify.value(node_address, .{}, &output.writer);
    try output.writer.writeByte('}');
    var atomic_file = try std.Io.Dir.cwd().createFileAtomic(io, connection_path, .{
        .permissions = @enumFromInt(0o600),
        .make_path = true,
        .replace = true,
    });
    defer atomic_file.deinit(io);
    try atomic_file.file.writeStreamingAll(io, output.writer.buffered());
    try atomic_file.file.sync(io);
    try atomic_file.replace(io);
}

pub fn remove(allocator: std.mem.Allocator, io: std.Io, data_dir: []const u8) !void {
    const connection_path = try path(allocator, data_dir);
    defer allocator.free(connection_path);
    std.Io.Dir.cwd().deleteFile(io, connection_path) catch |failure| switch (failure) {
        error.FileNotFound => {},
        else => return failure,
    };
}

fn path(allocator: std.mem.Allocator, data_dir: []const u8) ![]u8 {
    return std.fs.path.join(allocator, &.{ data_dir, "head-connection.json" });
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len > 0 and trimmed.len <= 256 * 1024) trimmed else null;
}
