const std = @import("std");
const limits = @import("../../agent/runtime/limits.zig");
const window = @import("../../agent/runtime/window.zig");
const protocol = @import("../protocol.zig");

pub const Entry = struct {
    allocator: std.mem.Allocator,
    role: protocol.Role,
    content: []u8,

    pub fn deinit(entry: *Entry) void {
        entry.allocator.free(entry.content);
        entry.* = undefined;
    }
};

const Entries = window.Window(Entry);

pub const Store = struct {
    allocator: std.mem.Allocator,
    io: std.Io,
    path: []u8,
    entries: Entries = .{ .maximum = limits.chat.history_entries },

    pub fn open(allocator: std.mem.Allocator, io: std.Io, home: []const u8, session_id: []const u8) !Store {
        const directory = try std.fs.path.join(allocator, &.{ home, "sessions" });
        defer allocator.free(directory);
        _ = try std.Io.Dir.cwd().createDirPathStatus(io, directory, @enumFromInt(0o700));
        const filename = try std.fmt.allocPrint(allocator, "{s}.json", .{session_id});
        defer allocator.free(filename);
        var store = Store{
            .allocator = allocator,
            .io = io,
            .path = try std.fs.path.join(allocator, &.{ directory, filename }),
        };
        errdefer store.deinit();
        try store.load();
        return store;
    }

    pub fn deinit(store: *Store) void {
        store.entries.deinit(store.allocator, deinitEntry);
        store.allocator.free(store.path);
        store.* = undefined;
    }

    pub fn values(store: *const Store) []const Entry {
        return store.entries.values();
    }

    pub fn append(store: *Store, role: protocol.Role, content: []const u8) !void {
        const owned = try store.allocator.dupe(u8, content);
        errdefer store.allocator.free(owned);
        try store.entries.append(store.allocator, .{ .allocator = store.allocator, .role = role, .content = owned }, deinitEntry);
    }

    pub fn pop(store: *Store) ?Entry {
        return store.entries.pop();
    }

    pub fn save(store: *Store) !void {
        var document: std.Io.Writer.Allocating = .init(store.allocator);
        defer document.deinit();
        try document.writer.writeByte('[');
        for (store.values(), 0..) |entry, index| {
            if (index > 0) try document.writer.writeByte(',');
            try document.writer.writeAll("{\"role\":");
            try std.json.Stringify.value(@tagName(entry.role), .{}, &document.writer);
            try document.writer.writeAll(",\"content\":");
            try std.json.Stringify.value(entry.content, .{}, &document.writer);
            try document.writer.writeByte('}');
        }
        try document.writer.writeByte(']');
        var atomic_file = try std.Io.Dir.cwd().createFileAtomic(store.io, store.path, .{
            .permissions = @enumFromInt(0o600),
            .make_path = true,
            .replace = true,
        });
        defer atomic_file.deinit(store.io);
        try atomic_file.file.writeStreamingAll(store.io, document.writer.buffered());
        try atomic_file.file.sync(store.io);
        try atomic_file.replace(store.io);
    }

    fn load(store: *Store) !void {
        var file = std.Io.Dir.cwd().openFile(store.io, store.path, .{}) catch return;
        defer file.close(store.io);
        const length: usize = @intCast(try file.length(store.io));
        if (length == 0 or length > limits.chat.history_bytes) return;
        const storage = try store.allocator.alloc(u8, length);
        defer store.allocator.free(storage);
        const read = try file.readPositionalAll(store.io, storage, 0);
        var parsed = std.json.parseFromSlice(std.json.Value, store.allocator, storage[0..read], .{}) catch return;
        defer parsed.deinit();
        if (parsed.value != .array) return;
        for (parsed.value.array.items) |value| {
            if (value != .object) continue;
            const role_text = stringField(value.object, "role") orelse continue;
            const content = stringField(value.object, "content") orelse continue;
            const role: protocol.Role = if (std.mem.eql(u8, role_text, "user")) .user else if (std.mem.eql(u8, role_text, "assistant")) .assistant else continue;
            try store.append(role, content);
        }
    }
};

fn deinitEntry(entry: *Entry) void {
    entry.deinit();
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    return if (value == .string) value.string else null;
}
