const std = @import("std");

const c = @cImport({
    @cInclude("sys/statvfs.h");
});

const max_models = 200;
const max_depth = 2;
const max_directories = 10_000;
const max_entries_per_directory = 20_000;

const QueueEntry = struct {
    path: []u8,
    depth: u8,
};

pub const Disk = struct {
    path: []const u8,
    total_bytes: ?u64,
    free_bytes: ?u64,
    available_bytes: ?u64,
};

pub fn payload(allocator: std.mem.Allocator, io: std.Io, models_dir: []const u8) ![]u8 {
    var directories = try discover(allocator, io, &.{models_dir}, max_depth, max_models);
    defer {
        for (directories.items) |directory| allocator.free(directory);
        directories.deinit(allocator);
    }
    var model_bytes: u64 = 0;
    for (directories.items) |directory| model_bytes +|= weightBytes(io, directory);
    const disk = inspectDisk(allocator, models_dir);
    const Payload = struct {
        models_dir: []const u8,
        model_count: usize,
        model_bytes: u64,
        disk: Disk,
    };
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try std.json.Stringify.value(Payload{
        .models_dir = models_dir,
        .model_count = directories.items.len,
        .model_bytes = model_bytes,
        .disk = disk,
    }, .{}, &output.writer);
    return output.toOwnedSlice();
}

pub fn discover(allocator: std.mem.Allocator, io: std.Io, roots: []const []const u8, depth_limit: usize, model_limit: usize) !std.ArrayList([]u8) {
    var queue: std.ArrayList(QueueEntry) = .empty;
    defer {
        for (queue.items) |entry| allocator.free(entry.path);
        queue.deinit(allocator);
    }
    for (roots) |root| if (root.len > 0) try queue.append(allocator, .{ .path = try allocator.dupe(u8, root), .depth = 0 });
    var seen: std.StringHashMapUnmanaged(void) = .empty;
    defer seen.deinit(allocator);
    var discovered: std.ArrayList([]u8) = .empty;
    errdefer {
        for (discovered.items) |directory| allocator.free(directory);
        discovered.deinit(allocator);
    }
    var index: usize = 0;
    while (index < queue.items.len and discovered.items.len < model_limit and index < max_directories) : (index += 1) {
        const entry = queue.items[index];
        const seen_entry = try seen.getOrPut(allocator, entry.path);
        if (seen_entry.found_existing) continue;
        if (looksLikeModelDirectory(io, entry.path)) {
            try discovered.append(allocator, try allocator.dupe(u8, entry.path));
            continue;
        }
        if (entry.depth >= depth_limit or queue.items.len >= max_directories) continue;
        var directory = std.Io.Dir.cwd().openDir(io, entry.path, .{ .iterate = true }) catch continue;
        defer directory.close(io);
        var iterator = directory.iterateAssumeFirstIteration();
        var count: usize = 0;
        while (count < max_entries_per_directory) : (count += 1) {
            const child = iterator.next(io) catch break;
            const value = child orelse break;
            if (value.kind != .directory or std.mem.startsWith(u8, value.name, ".")) continue;
            if (queue.items.len >= max_directories) break;
            const child_path = try std.fs.path.join(allocator, &.{ entry.path, value.name });
            errdefer allocator.free(child_path);
            try queue.append(allocator, .{
                .path = child_path,
                .depth = entry.depth + 1,
            });
        }
    }
    return discovered;
}

fn looksLikeModelDirectory(io: std.Io, path: []const u8) bool {
    var directory = std.Io.Dir.cwd().openDir(io, path, .{ .iterate = true }) catch return false;
    defer directory.close(io);
    var iterator = directory.iterateAssumeFirstIteration();
    var count: usize = 0;
    while (count < max_entries_per_directory) : (count += 1) {
        const entry = iterator.next(io) catch return false;
        const value = entry orelse return false;
        if (value.kind != .file) continue;
        if (std.mem.eql(u8, value.name, "config.json") or isWeightFile(value.name)) return true;
    }
    return false;
}

pub fn weightBytes(io: std.Io, path: []const u8) u64 {
    var directory = std.Io.Dir.cwd().openDir(io, path, .{ .iterate = true }) catch return 0;
    defer directory.close(io);
    var iterator = directory.iterateAssumeFirstIteration();
    var total: u64 = 0;
    var count: usize = 0;
    while (count < max_entries_per_directory) : (count += 1) {
        const entry = iterator.next(io) catch return total;
        const value = entry orelse return total;
        if (value.kind != .file or !isWeightFile(value.name)) continue;
        const stat = directory.statFile(io, value.name, .{}) catch continue;
        total +|= stat.size;
    }
    return total;
}

fn isWeightFile(name: []const u8) bool {
    return endsWithIgnoreCase(name, ".safetensors") or endsWithIgnoreCase(name, ".bin") or endsWithIgnoreCase(name, ".gguf");
}

fn endsWithIgnoreCase(value: []const u8, suffix: []const u8) bool {
    if (value.len < suffix.len) return false;
    return std.ascii.eqlIgnoreCase(value[value.len - suffix.len ..], suffix);
}

pub fn inspectDisk(allocator: std.mem.Allocator, path: []const u8) Disk {
    const path_z = allocator.dupeZ(u8, path) catch return unavailableDisk(path);
    defer allocator.free(path_z);
    var result: c.struct_statvfs = undefined;
    if (c.statvfs(path_z.ptr, &result) != 0) return unavailableDisk(path);
    const block_size: u64 = @intCast(if (result.f_frsize > 0) result.f_frsize else result.f_bsize);
    return .{
        .path = path,
        .total_bytes = multiplySaturating(result.f_blocks, block_size),
        .free_bytes = multiplySaturating(result.f_bfree, block_size),
        .available_bytes = multiplySaturating(result.f_bavail, block_size),
    };
}

fn unavailableDisk(path: []const u8) Disk {
    return .{ .path = path, .total_bytes = null, .free_bytes = null, .available_bytes = null };
}

fn multiplySaturating(left: anytype, right: u64) u64 {
    return @as(u64, @intCast(left)) *| right;
}
