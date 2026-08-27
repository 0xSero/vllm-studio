const std = @import("std");
const config = @import("../app/config.zig");
const route_registry = @import("../http/route_registry.zig");

pub const Disposition = enum {
    local,
    proxy,
    reject,
};

pub fn routeDisposition(mode: config.Mode, route: route_registry.Route) Disposition {
    if (mode != .head and std.mem.eql(u8, route.path, "/v1/models")) return .local;
    if (mode != .head and std.mem.eql(u8, route.path, "/v1/chat/completions")) return .local;
    if (mode != .head and std.mem.eql(u8, route.path, "/v1/responses")) return .local;
    return disposition(mode, route.ownership);
}

pub fn disposition(mode: config.Mode, ownership: route_registry.Ownership) Disposition {
    return switch (mode) {
        .head => switch (ownership) {
            .shared, .head => .local,
            .proxied => .proxy,
            .worker => .reject,
        },
        .worker => switch (ownership) {
            .shared, .worker, .proxied => .local,
            .head => .reject,
        },
        .standalone => .local,
    };
}
