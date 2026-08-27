const std = @import("std");
const app_module = @import("app/app.zig");
const config = @import("app/config.zig");
const mcp_bridge = @import("agent/mcp/bridge.zig");
const mcp_code_storage = @import("agent/mcp/code_storage.zig");
const mcp_forward = @import("agent/mcp/forward.zig");

pub fn main(init: std.process.Init) !void {
    var arguments = try std.process.Args.Iterator.initAllocator(init.minimal.args, init.gpa);
    defer arguments.deinit();
    _ = arguments.skip();
    if (arguments.next()) |command| {
        if (std.mem.eql(u8, command, "mcp-bridge")) return mcp_bridge.run(init);
        if (std.mem.eql(u8, command, "mcp-code-storage")) return mcp_code_storage.run(init);
        if (std.mem.eql(u8, command, "mcp-forward")) return mcp_forward.run(init, arguments.next() orelse return error.McpForwardUrlRequired, arguments.next() orelse "auto", arguments.next(), arguments.next());
    }
    var settings = try config.Config.load(init);
    errdefer settings.deinit();
    var app = try app_module.App.init(init.gpa, init.io, settings);
    defer app.deinit();
    try app.run();
}
