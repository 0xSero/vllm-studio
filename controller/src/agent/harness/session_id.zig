const std = @import("std");

pub fn validRuntime(value: []const u8) bool {
    if (value.len == 0 or value.len > 128) return false;
    for (value) |byte| if (!std.ascii.isAlphanumeric(byte) and byte != '_' and byte != '-' and byte != '.' and byte != ':') return false;
    return true;
}

pub fn resolve(allocator: std.mem.Allocator, runtime_id: []const u8, requested: ?[]const u8) ![]u8 {
    if (requested) |value| if (validNative(value)) return allocator.dupe(u8, value);
    const output = try allocator.alloc(u8, runtime_id.len);
    errdefer allocator.free(output);
    for (runtime_id, output) |byte, *target| target.* = if (std.ascii.isAlphanumeric(byte) or byte == '_' or byte == '-' or byte == '.') byte else '-';
    if (!validNative(output)) return error.InvalidNativeSessionId;
    return output;
}

pub fn validNative(value: []const u8) bool {
    if (value.len == 0 or value.len > 128 or !std.ascii.isAlphanumeric(value[0]) or !std.ascii.isAlphanumeric(value[value.len - 1])) return false;
    for (value) |byte| if (!std.ascii.isAlphanumeric(byte) and byte != '_' and byte != '-' and byte != '.') return false;
    return true;
}
