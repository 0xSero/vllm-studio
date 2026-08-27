const std = @import("std");
const builtin = @import("builtin");

const Io = std.Io;

pub fn resolve(allocator: std.mem.Allocator, io: Io, models_dir: []const u8, model_id: []const u8, destination: ?[]const u8) ![]u8 {
    const relative = try sanitizedRelative(allocator, destination orelse model_id);
    defer allocator.free(relative);
    const target = try std.fs.path.resolve(allocator, &.{ models_dir, relative });
    errdefer allocator.free(target);
    if (!contains(models_dir, target) or std.mem.eql(u8, models_dir, target)) return error.InvalidDestinationPath;
    const physical_root = try physicalKey(allocator, io, models_dir);
    defer allocator.free(physical_root);
    const physical_target = try physicalKey(allocator, io, target);
    defer allocator.free(physical_target);
    if (!contains(physical_root, physical_target) or std.mem.eql(u8, physical_root, physical_target)) return error.InvalidDestinationPath;
    return target;
}

pub fn sanitizedRelative(allocator: std.mem.Allocator, value: []const u8) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    var segments = std.mem.splitAny(u8, value, "/\\");
    var wrote = false;
    while (segments.next()) |raw| {
        const segment = std.mem.trim(u8, raw, " \t\r\n");
        if (segment.len == 0 or std.mem.eql(u8, segment, ".") or std.mem.eql(u8, segment, "..")) continue;
        if (wrote) try output.writer.writeByte(std.fs.path.sep);
        try output.writer.writeAll(segment);
        wrote = true;
    }
    if (!wrote) return error.InvalidDestinationPath;
    return output.toOwnedSlice();
}

pub fn physicalKey(allocator: std.mem.Allocator, io: Io, target: []const u8) ![]u8 {
    var ancestor = target;
    while (true) {
        const physical = Io.Dir.realPathFileAbsoluteAlloc(io, ancestor, allocator) catch |failure| switch (failure) {
            error.FileNotFound, error.NotDir => null,
            else => return failure,
        };
        if (physical) |resolved| {
            defer allocator.free(resolved);
            const suffix = std.mem.trimStart(u8, target[ancestor.len..], "/\\");
            const combined = if (suffix.len > 0) try std.fs.path.resolve(allocator, &.{ resolved, suffix }) else try allocator.dupe(u8, resolved);
            if (builtin.os.tag == .macos or builtin.os.tag == .windows) {
                for (combined) |*character| character.* = std.ascii.toLower(character.*);
            }
            return combined;
        }
        const parent = std.fs.path.dirname(ancestor) orelse return allocator.dupe(u8, target);
        if (parent.len == ancestor.len) return allocator.dupe(u8, target);
        ancestor = parent;
    }
}

pub fn contains(parent: []const u8, candidate: []const u8) bool {
    const normalized_parent = if (parent.len > 1) std.mem.trimEnd(u8, parent, "/\\") else parent;
    if (std.mem.eql(u8, normalized_parent, candidate)) return true;
    if (normalized_parent.len == 1 and std.fs.path.isSep(normalized_parent[0])) return candidate.len > 0 and std.fs.path.isSep(candidate[0]);
    if (!std.mem.startsWith(u8, candidate, normalized_parent) or candidate.len <= normalized_parent.len) return false;
    return std.fs.path.isSep(candidate[normalized_parent.len]);
}
