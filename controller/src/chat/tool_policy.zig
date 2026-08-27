const std = @import("std");
const filesystem = @import("filesystem.zig");

pub fn allows(name: []const u8, browser_enabled: bool) bool {
    if (std.mem.startsWith(u8, name, "browser_")) return browser_enabled;
    for ([_][]const u8{ "mcp-filesystem__", "filesystem__", "file__" }) |prefix| {
        if (std.mem.startsWith(u8, name, prefix)) return filesystem.enabled;
    }
    for ([_][]const u8{ "computer__", "mcp-git__", "git__", "shell__", "terminal__", "ssh__" }) |prefix| {
        if (std.mem.startsWith(u8, name, prefix)) return false;
    }
    return true;
}
