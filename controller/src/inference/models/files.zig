const std = @import("std");

const max_copy_depth = 64;
const max_copy_entries = 1_000_000;

pub fn deletePayload(allocator: std.mem.Allocator, io: std.Io, models_dir: []const u8, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidPayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidPayload;
    const path_value = parsed.value.object.get("path") orelse return error.InvalidPayload;
    if (path_value != .string) return error.InvalidPayload;
    const input = std.mem.trim(u8, path_value.string, " \t\r\n");
    if (input.len == 0) return error.PathRequired;
    const target = try containedPath(allocator, io, models_dir, input, false, error.PathOutsideModelsDirectory);
    defer allocator.free(target);
    if (!pathExists(io, target)) return error.ModelPathNotFound;
    try std.Io.Dir.cwd().deleteTree(io, target);
    return allocator.dupe(u8, "{\"success\":true}");
}

pub fn movePayload(allocator: std.mem.Allocator, io: std.Io, models_dir: []const u8, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidPayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidPayload;
    const source_value = parsed.value.object.get("source_path") orelse return error.InvalidPayload;
    const target_root_value = parsed.value.object.get("target_root") orelse return error.InvalidPayload;
    if (source_value != .string or target_root_value != .string) return error.InvalidPayload;
    const source_input = std.mem.trim(u8, source_value.string, " \t\r\n");
    const target_root_input = std.mem.trim(u8, target_root_value.string, " \t\r\n");
    if (source_input.len == 0 or target_root_input.len == 0) return error.MovePathsRequired;
    const source = try containedPath(allocator, io, models_dir, source_input, false, error.SourceOutsideModelsDirectory);
    defer allocator.free(source);
    const target_root = try containedPath(allocator, io, models_dir, target_root_input, true, error.TargetOutsideModelsDirectory);
    defer allocator.free(target_root);
    if (!pathExists(io, source)) return error.SourcePathNotFound;
    _ = try std.Io.Dir.cwd().createDirPathStatus(io, target_root, @enumFromInt(0o755));
    const target = try std.fs.path.resolve(allocator, &.{ target_root, std.fs.path.basename(source) });
    defer allocator.free(target);
    if (pathExists(io, target)) return error.TargetPathExists;
    std.Io.Dir.cwd().rename(source, std.Io.Dir.cwd(), target, io) catch |failure| switch (failure) {
        error.CrossDevice => {
            var copied: usize = 0;
            try copyEntry(allocator, io, source, target, 0, &copied);
            try std.Io.Dir.cwd().deleteTree(io, source);
        },
        else => return failure,
    };
    var output: std.Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"success\":true,\"target\":");
    try std.json.Stringify.value(target, .{}, &output.writer);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn containedPath(allocator: std.mem.Allocator, io: std.Io, models_dir: []const u8, input: []const u8, allow_root: bool, outside_error: anyerror) ![]u8 {
    const cwd = try std.Io.Dir.cwd().realPathFileAlloc(io, ".", allocator);
    defer allocator.free(cwd);
    const root = try std.fs.path.resolve(allocator, &.{ cwd, models_dir });
    defer allocator.free(root);
    const target = try std.fs.path.resolve(allocator, &.{ cwd, input });
    errdefer allocator.free(target);
    if (allow_root and std.mem.eql(u8, target, root)) return target;
    if (target.len <= root.len or !std.mem.eql(u8, target[0..root.len], root) or target[root.len] != std.fs.path.sep) return outside_error;
    return target;
}

fn pathExists(io: std.Io, path: []const u8) bool {
    _ = std.Io.Dir.cwd().statFile(io, path, .{}) catch return false;
    return true;
}

fn copyEntry(allocator: std.mem.Allocator, io: std.Io, source: []const u8, target: []const u8, depth: usize, copied: *usize) !void {
    if (depth > max_copy_depth or copied.* >= max_copy_entries) return error.CopyLimitExceeded;
    copied.* += 1;
    const kind = entryKind(io, source) orelse return error.SourcePathNotFound;
    switch (kind) {
        .directory => {
            const stat = try std.Io.Dir.cwd().statFile(io, source, .{});
            _ = try std.Io.Dir.cwd().createDirPathStatus(io, target, stat.permissions);
            var source_directory = try std.Io.Dir.cwd().openDir(io, source, .{ .iterate = true });
            defer source_directory.close(io);
            var iterator = source_directory.iterateAssumeFirstIteration();
            while (try iterator.next(io)) |entry| {
                const child_source = try std.fs.path.join(allocator, &.{ source, entry.name });
                defer allocator.free(child_source);
                const child_target = try std.fs.path.join(allocator, &.{ target, entry.name });
                defer allocator.free(child_target);
                try copyEntry(allocator, io, child_source, child_target, depth + 1, copied);
            }
        },
        .file => try std.Io.Dir.copyFileAbsolute(source, target, io, .{ .replace = false }),
        .sym_link => {
            var buffer: [std.fs.max_path_bytes]u8 = undefined;
            const length = try std.Io.Dir.readLinkAbsolute(io, source, &buffer);
            try std.Io.Dir.cwd().symLink(io, buffer[0..length], target, .{});
        },
        else => return error.UnsupportedModelFileKind,
    }
}

fn entryKind(io: std.Io, path: []const u8) ?std.Io.File.Kind {
    const parent_path = std.fs.path.dirname(path) orelse ".";
    const name = std.fs.path.basename(path);
    var parent = std.Io.Dir.cwd().openDir(io, parent_path, .{ .iterate = true }) catch return null;
    defer parent.close(io);
    var iterator = parent.iterateAssumeFirstIteration();
    while (iterator.next(io) catch return null) |entry| {
        if (std.mem.eql(u8, entry.name, name)) return entry.kind;
    }
    return null;
}
