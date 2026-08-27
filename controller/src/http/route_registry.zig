const std = @import("std");
const generated = @import("../generated/http_routes.zig");

pub const Ownership = generated.Ownership;
pub const Route = generated.Route;

const spike_routes = [_]Route{
    .{ .method = .GET, .path = "/__zig-spike/sse", .ownership = .shared, .streaming = .always },
    .{ .method = .GET, .path = "/__zig-spike/proxy", .ownership = .shared, .streaming = .always },
    .{ .method = .POST, .path = "/__zig-spike/proxy", .ownership = .shared, .streaming = .conditional },
};

pub fn find(method: std.http.Method, target: []const u8) ?Route {
    const query_start = std.mem.findScalar(u8, target, '?') orelse target.len;
    const path = target[0..query_start];
    for (generated.routes) |route| {
        if (route.method == method and pathMatches(route.path, path)) return route;
    }
    for (spike_routes) |route| {
        if (route.method == method and pathMatches(route.path, path)) return route;
    }
    return null;
}

fn pathMatches(pattern: []const u8, path: []const u8) bool {
    var pattern_segments = std.mem.splitScalar(u8, pattern, '/');
    var path_segments = std.mem.splitScalar(u8, path, '/');
    while (true) {
        const pattern_segment = pattern_segments.next();
        const path_segment = path_segments.next();
        if (pattern_segment == null or path_segment == null) return pattern_segment == null and path_segment == null;
        if (pattern_segment.?.len > 0 and pattern_segment.?[0] == ':') {
            if (path_segment.?.len == 0) return false;
        } else if (!std.mem.eql(u8, pattern_segment.?, path_segment.?)) {
            return false;
        }
    }
}
