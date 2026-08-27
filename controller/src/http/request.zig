const std = @import("std");
const http = std.http;

pub fn header(request: *const http.Server.Request, expected_name: []const u8) ?[]const u8 {
    var iterator = request.iterateHeaders();
    while (iterator.next()) |candidate| {
        if (std.ascii.eqlIgnoreCase(candidate.name, expected_name)) return candidate.value;
    }
    return null;
}

pub fn pathParameter(allocator: std.mem.Allocator, target: []const u8, prefix: []const u8) ![]u8 {
    const query_start = std.mem.findScalar(u8, target, '?') orelse target.len;
    const path = target[0..query_start];
    if (!std.mem.startsWith(u8, path, prefix) or path.len <= prefix.len) return error.InvalidPathParameter;
    const encoded = path[prefix.len..];
    const storage = try allocator.dupe(u8, encoded);
    defer allocator.free(storage);
    return try allocator.dupe(u8, std.Uri.percentDecodeInPlace(storage));
}

pub fn pathParameterBetween(allocator: std.mem.Allocator, target: []const u8, prefix: []const u8, suffix: []const u8) ![]u8 {
    const query_start = std.mem.findScalar(u8, target, '?') orelse target.len;
    const path = target[0..query_start];
    if (!std.mem.startsWith(u8, path, prefix) or !std.mem.endsWith(u8, path, suffix) or path.len <= prefix.len + suffix.len) return error.InvalidPathParameter;
    const encoded = path[prefix.len .. path.len - suffix.len];
    const storage = try allocator.dupe(u8, encoded);
    defer allocator.free(storage);
    return try allocator.dupe(u8, std.Uri.percentDecodeInPlace(storage));
}

pub const RigNodeParameters = struct {
    rig_id: []u8,
    node_id: []u8,
};

pub fn rigNodeParameters(allocator: std.mem.Allocator, target: []const u8) !RigNodeParameters {
    const query_start = std.mem.findScalar(u8, target, '?') orelse target.len;
    const path = target[0..query_start];
    const prefix = "/studio/rigs/";
    if (!std.mem.startsWith(u8, path, prefix)) return error.InvalidPathParameter;
    const separator = std.mem.indexOf(u8, path[prefix.len..], "/nodes/") orelse return error.InvalidPathParameter;
    const rig_encoded = path[prefix.len .. prefix.len + separator];
    const node_encoded = path[prefix.len + separator + "/nodes/".len ..];
    if (rig_encoded.len == 0 or node_encoded.len == 0) return error.InvalidPathParameter;
    const rig_storage = try allocator.dupe(u8, rig_encoded);
    defer allocator.free(rig_storage);
    const rig_id = try allocator.dupe(u8, std.Uri.percentDecodeInPlace(rig_storage));
    errdefer allocator.free(rig_id);
    const node_storage = try allocator.dupe(u8, node_encoded);
    defer allocator.free(node_storage);
    return .{ .rig_id = rig_id, .node_id = try allocator.dupe(u8, std.Uri.percentDecodeInPlace(node_storage)) };
}

pub const ModelProviderJobParameters = struct {
    provider_id: []u8,
    job_id: []u8,

    pub fn deinit(parameters: ModelProviderJobParameters, allocator: std.mem.Allocator) void {
        allocator.free(parameters.provider_id);
        allocator.free(parameters.job_id);
    }
};

pub fn modelProviderJobParameters(allocator: std.mem.Allocator, target: []const u8, suffix: []const u8) !ModelProviderJobParameters {
    const query_start = std.mem.findScalar(u8, target, '?') orelse target.len;
    const path = target[0..query_start];
    const prefix = "/studio/model-providers/";
    if (!std.mem.startsWith(u8, path, prefix) or !std.mem.endsWith(u8, path, suffix)) return error.InvalidPathParameter;
    const end = path.len - suffix.len;
    const middle = path[prefix.len..end];
    const separator = std.mem.indexOf(u8, middle, "/login/") orelse return error.InvalidPathParameter;
    if (separator == 0 or separator + 7 >= middle.len) return error.InvalidPathParameter;
    const provider_storage = try allocator.dupe(u8, middle[0..separator]);
    defer allocator.free(provider_storage);
    const job_storage = try allocator.dupe(u8, middle[separator + 7 ..]);
    defer allocator.free(job_storage);
    const provider_id = try allocator.dupe(u8, std.Uri.percentDecodeInPlace(provider_storage));
    errdefer allocator.free(provider_id);
    return .{ .provider_id = provider_id, .job_id = try allocator.dupe(u8, std.Uri.percentDecodeInPlace(job_storage)) };
}

pub fn queryUnsigned(target: []const u8, expected_name: []const u8) ?u64 {
    const query_start = std.mem.findScalar(u8, target, '?') orelse return null;
    var parameters = std.mem.splitScalar(u8, target[query_start + 1 ..], '&');
    while (parameters.next()) |parameter| {
        const separator = std.mem.findScalar(u8, parameter, '=') orelse continue;
        if (!std.mem.eql(u8, parameter[0..separator], expected_name)) continue;
        return std.fmt.parseInt(u64, parameter[separator + 1 ..], 10) catch null;
    }
    return null;
}

pub fn queryFlag(target: []const u8, expected_name: []const u8) bool {
    const query_start = std.mem.findScalar(u8, target, '?') orelse return false;
    var parameters = std.mem.splitScalar(u8, target[query_start + 1 ..], '&');
    while (parameters.next()) |parameter| {
        const separator = std.mem.findScalar(u8, parameter, '=') orelse continue;
        if (!std.mem.eql(u8, parameter[0..separator], expected_name)) continue;
        const value = parameter[separator + 1 ..];
        return std.mem.eql(u8, value, "1") or std.ascii.eqlIgnoreCase(value, "true") or std.ascii.eqlIgnoreCase(value, "only");
    }
    return false;
}

pub fn boundedLimit(target: []const u8) ?usize {
    const value = queryUnsigned(target, "limit") orelse return null;
    if (value == 0) return null;
    return @intCast(@min(value, 10_000));
}

pub fn queryParameter(allocator: std.mem.Allocator, target: []const u8, expected_name: []const u8) !?[]u8 {
    const query_start = std.mem.findScalar(u8, target, '?') orelse return null;
    var parameters = std.mem.splitScalar(u8, target[query_start + 1 ..], '&');
    while (parameters.next()) |parameter| {
        const separator = std.mem.findScalar(u8, parameter, '=') orelse {
            if (std.mem.eql(u8, parameter, expected_name)) return @as(?[]u8, try allocator.dupe(u8, ""));
            continue;
        };
        if (!std.mem.eql(u8, parameter[0..separator], expected_name)) continue;
        const encoded = parameter[separator + 1 ..];
        const storage = try allocator.dupe(u8, encoded);
        defer allocator.free(storage);
        for (storage) |*character| if (character.* == '+') {
            character.* = ' ';
        };
        return @as(?[]u8, try allocator.dupe(u8, std.Uri.percentDecodeInPlace(storage)));
    }
    return null;
}

pub fn trimmedOptional(value: []const u8) ?[]const u8 {
    const trimmed = std.mem.trim(u8, value, " \t\r\n");
    return if (trimmed.len == 0) null else trimmed;
}
