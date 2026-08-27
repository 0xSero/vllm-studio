const std = @import("std");

pub const Launch = struct {
    argv: []const []const u8,
    cwd: ?[]const u8,
    kind: Kind,
};

pub const Kind = enum {
    direct,
    node,
    python,
};

pub fn resolve(allocator: std.mem.Allocator, io: std.Io, environment: *const std.process.Environ.Map, connector: std.json.ObjectMap) !Launch {
    const cwd = stringField(connector, "cwd");
    if (cwd) |value| if (!std.fs.path.isAbsolute(value)) return error.ConnectorCwdMustBeAbsolute;
    const runtime_value = connector.get("runtime") orelse return direct(allocator, connector, cwd);
    if (runtime_value != .object) return error.InvalidConnectorRuntime;
    const runtime = runtime_value.object;
    const kind = stringField(runtime, "kind") orelse return error.ConnectorRuntimeKindRequired;
    const package = stringField(runtime, "package") orelse return error.ConnectorRuntimePackageRequired;
    const version = stringField(runtime, "version") orelse return error.ConnectorRuntimeVersionRequired;
    const executable = stringField(runtime, "executable") orelse return error.ConnectorRuntimeExecutableRequired;
    if (!validPackage(package) or !exactVersion(version) or !validExecutable(executable)) return error.InvalidConnectorRuntime;
    if (std.mem.eql(u8, kind, "node")) {
        const npx = try findExecutable(allocator, io, environment, "LOCAL_STUDIO_NPX_BIN", "npx") orelse return error.NodeRuntimeUnavailable;
        const package_version = try std.fmt.allocPrint(allocator, "{s}@{s}", .{ package, version });
        return .{
            .argv = try appendConnectorArgs(allocator, connector, &.{ npx, "--yes", "--package", package_version, executable }),
            .cwd = cwd,
            .kind = .node,
        };
    }
    if (std.mem.eql(u8, kind, "python")) {
        const uvx = try findExecutable(allocator, io, environment, "LOCAL_STUDIO_UVX_BIN", "uvx") orelse return error.PythonRuntimeUnavailable;
        const package_version = try std.fmt.allocPrint(allocator, "{s}=={s}", .{ package, version });
        var prefix: std.ArrayList([]const u8) = .empty;
        defer prefix.deinit(allocator);
        try prefix.append(allocator, uvx);
        if (runtime.get("with")) |requirements| {
            if (requirements != .array or requirements.array.items.len > 16) return error.InvalidConnectorRuntime;
            for (requirements.array.items) |requirement| {
                if (requirement != .string or !validRequirement(requirement.string)) return error.InvalidConnectorRuntime;
                try prefix.appendSlice(allocator, &.{ "--with", requirement.string });
            }
        }
        try prefix.appendSlice(allocator, &.{ "--from", package_version, executable });
        return .{
            .argv = try appendConnectorArgs(allocator, connector, prefix.items),
            .cwd = cwd,
            .kind = .python,
        };
    }
    return error.InvalidConnectorRuntime;
}

pub fn addEnvironment(allocator: std.mem.Allocator, io: std.Io, result: *std.process.Environ.Map, data_dir: []const u8, connector: std.json.ObjectMap, kind: Kind) !void {
    const root = try std.fs.path.join(allocator, &.{ data_dir, "mcp", "runtimes" });
    defer allocator.free(root);
    switch (kind) {
        .direct => {},
        .node => {
            const cache = try std.fs.path.join(allocator, &.{ root, "node", "cache" });
            defer allocator.free(cache);
            try result.put("npm_config_cache", cache);
            try result.put("npm_config_update_notifier", "false");
            try result.put("npm_config_fund", "false");
            try result.put("npm_config_audit", "false");
            if (connector.get("runtime")) |runtime_value| if (runtime_value == .object) if (stringField(runtime_value.object, "package")) |package| if (std.mem.eql(u8, package, "mcp-remote")) {
                const auth_dir = try std.fs.path.join(allocator, &.{ data_dir, "accounts", "remote-mcp" });
                defer allocator.free(auth_dir);
                _ = try std.Io.Dir.cwd().createDirPathStatus(io, auth_dir, @enumFromInt(0o700));
                try result.put("MCP_REMOTE_CONFIG_DIR", auth_dir);
            };
        },
        .python => {
            const cache = try std.fs.path.join(allocator, &.{ root, "python", "cache" });
            defer allocator.free(cache);
            const tools = try std.fs.path.join(allocator, &.{ root, "python", "tools" });
            defer allocator.free(tools);
            const installs = try std.fs.path.join(allocator, &.{ root, "python", "installs" });
            defer allocator.free(installs);
            try result.put("UV_CACHE_DIR", cache);
            try result.put("UV_TOOL_DIR", tools);
            try result.put("UV_PYTHON_INSTALL_DIR", installs);
        },
    }
    if (stringField(connector, "id")) |id| if (std.mem.eql(u8, id, "mcp-memory")) {
        const state_dir = try std.fs.path.join(allocator, &.{ data_dir, "mcp", "state", id });
        defer allocator.free(state_dir);
        _ = try std.Io.Dir.cwd().createDirPathStatus(io, state_dir, @enumFromInt(0o700));
        const memory_file = try std.fs.path.join(allocator, &.{ state_dir, "memory.jsonl" });
        defer allocator.free(memory_file);
        try result.put("MEMORY_FILE_PATH", memory_file);
    };
}

pub fn validate(runtime_value: std.json.Value) !void {
    if (runtime_value != .object) return error.InvalidConnectorRuntime;
    const runtime = runtime_value.object;
    const kind = stringField(runtime, "kind") orelse return error.ConnectorRuntimeKindRequired;
    if (!std.mem.eql(u8, kind, "node") and !std.mem.eql(u8, kind, "python")) return error.InvalidConnectorRuntime;
    const package = stringField(runtime, "package") orelse return error.ConnectorRuntimePackageRequired;
    const version = stringField(runtime, "version") orelse return error.ConnectorRuntimeVersionRequired;
    const executable = stringField(runtime, "executable") orelse return error.ConnectorRuntimeExecutableRequired;
    if (!validPackage(package) or !exactVersion(version) or !validExecutable(executable)) return error.InvalidConnectorRuntime;
    if (runtime.get("with")) |requirements| {
        if (!std.mem.eql(u8, kind, "python") or requirements != .array or requirements.array.items.len > 16) return error.InvalidConnectorRuntime;
        for (requirements.array.items) |requirement| if (requirement != .string or !validRequirement(requirement.string)) return error.InvalidConnectorRuntime;
    }
}

pub fn findExecutable(allocator: std.mem.Allocator, io: std.Io, environment: *const std.process.Environ.Map, override_name: []const u8, name: []const u8) !?[]const u8 {
    if (environment.get(override_name)) |configured| {
        const value = std.mem.trim(u8, configured, " \t\r\n");
        if (value.len > 0 and std.fs.path.isAbsolute(value)) return @as(?[]const u8, try allocator.dupe(u8, value));
    }
    const path = environment.get("PATH") orelse return null;
    var directories = std.mem.splitScalar(u8, path, std.fs.path.delimiter);
    while (directories.next()) |directory| {
        if (directory.len == 0) continue;
        const candidate = try std.fs.path.join(allocator, &.{ directory, name });
        const stat = std.Io.Dir.cwd().statFile(io, candidate, .{}) catch {
            allocator.free(candidate);
            continue;
        };
        if (stat.kind == .file and stat.permissions.toMode() & 0o111 != 0) return @as(?[]const u8, candidate);
        allocator.free(candidate);
    }
    return null;
}

fn direct(allocator: std.mem.Allocator, connector: std.json.ObjectMap, cwd: ?[]const u8) !Launch {
    const command = stringField(connector, "command") orelse return error.ConnectorCommandRequired;
    if (command.len == 0) return error.ConnectorCommandRequired;
    return .{ .argv = try appendConnectorArgs(allocator, connector, &.{command}), .cwd = cwd, .kind = .direct };
}

fn appendConnectorArgs(allocator: std.mem.Allocator, connector: std.json.ObjectMap, prefix: []const []const u8) ![]const []const u8 {
    const configured = connector.get("args");
    const count = if (configured) |args| blk: {
        if (args != .array) return error.InvalidConnectorRecord;
        break :blk args.array.items.len;
    } else 0;
    const argv = try allocator.alloc([]const u8, prefix.len + count);
    @memcpy(argv[0..prefix.len], prefix);
    if (configured) |args| for (args.array.items, prefix.len..) |argument, index| {
        if (argument != .string) return error.InvalidConnectorRecord;
        argv[index] = argument.string;
    };
    return argv;
}

fn validPackage(value: []const u8) bool {
    if (value.len == 0 or value.len > 214) return false;
    for (value) |character| if (!(std.ascii.isAlphanumeric(character) or character == '@' or character == '/' or character == '-' or character == '_' or character == '.')) return false;
    return true;
}

fn exactVersion(value: []const u8) bool {
    if (value.len == 0 or value.len > 64 or std.mem.eql(u8, value, "latest")) return false;
    for (value) |character| if (!(std.ascii.isAlphanumeric(character) or character == '.' or character == '-' or character == '+')) return false;
    return std.ascii.isDigit(value[0]);
}

fn validExecutable(value: []const u8) bool {
    if (value.len == 0 or value.len > 128) return false;
    for (value) |character| if (!(std.ascii.isAlphanumeric(character) or character == '-' or character == '_' or character == '.')) return false;
    return true;
}

fn validRequirement(value: []const u8) bool {
    if (value.len == 0 or value.len > 128) return false;
    for (value) |character| if (!(std.ascii.isAlphanumeric(character) or character == '@' or character == '/' or character == '-' or character == '_' or character == '.' or character == '<' or character == '>' or character == '=' or character == '!' or character == '~')) return false;
    return true;
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    return if (value == .string) value.string else null;
}
