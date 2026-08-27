const std = @import("std");
const config = @import("../../app/config.zig");

const Io = std.Io;

pub const Installation = struct {
    allocator: std.mem.Allocator,
    source: []u8,
    executable: []u8,
    version: ?[]u8,
    rpc_supported: bool,

    pub fn deinit(installation: *Installation) void {
        installation.allocator.free(installation.source);
        installation.allocator.free(installation.executable);
        if (installation.version) |value| installation.allocator.free(value);
        installation.* = undefined;
    }

    pub fn available(installation: *const Installation) bool {
        return installation.version != null and installation.rpc_supported;
    }
};

pub fn discoverPi(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config) !Installation {
    if (configuration.environment.get("LOCAL_STUDIO_PI_BIN")) |configured| {
        const trimmed = std.mem.trim(u8, configured, " \t\r\n");
        if (trimmed.len > 0) return probePi(allocator, io, configuration.environment, "configured", trimmed);
    }
    if (try pathExecutable(allocator, io, configuration.environment, "pi")) |executable| {
        defer allocator.free(executable);
        return probePi(allocator, io, configuration.environment, "system", executable);
    }
    for (knownPiLocations()) |candidate| {
        if (!executableFile(io, candidate)) continue;
        return probePi(allocator, io, configuration.environment, "system", candidate);
    }
    return .{
        .allocator = allocator,
        .source = try allocator.dupe(u8, "missing"),
        .executable = try allocator.dupe(u8, "pi"),
        .version = null,
        .rpc_supported = false,
    };
}

pub fn discoverCodex(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config) !Installation {
    if (configuration.environment.get("LOCAL_STUDIO_CODEX_BIN")) |configured| {
        const trimmed = std.mem.trim(u8, configured, " \t\r\n");
        if (trimmed.len > 0) return probeCodex(allocator, io, configuration.environment, "configured", trimmed);
    }
    if (try pathExecutable(allocator, io, configuration.environment, "codex")) |executable| {
        defer allocator.free(executable);
        return probeCodex(allocator, io, configuration.environment, "system", executable);
    }
    for (knownCodexLocations()) |candidate| {
        if (!executableFile(io, candidate)) continue;
        return probeCodex(allocator, io, configuration.environment, "system", candidate);
    }
    return .{
        .allocator = allocator,
        .source = try allocator.dupe(u8, "missing"),
        .executable = try allocator.dupe(u8, "codex"),
        .version = null,
        .rpc_supported = false,
    };
}

pub fn discoverFx(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config) !Installation {
    if (configuration.environment.get("LOCAL_STUDIO_FX_BIN")) |configured| {
        const trimmed = std.mem.trim(u8, configured, " \t\r\n");
        if (trimmed.len > 0) return probeFx(allocator, io, configuration.environment, "configured", trimmed);
    }
    if (try pathExecutable(allocator, io, configuration.environment, "fx")) |executable| {
        defer allocator.free(executable);
        return probeFx(allocator, io, configuration.environment, "system", executable);
    }
    for (knownFxLocations()) |candidate| {
        if (!executableFile(io, candidate)) continue;
        return probeFx(allocator, io, configuration.environment, "system", candidate);
    }
    return .{
        .allocator = allocator,
        .source = try allocator.dupe(u8, "missing"),
        .executable = try allocator.dupe(u8, "fx"),
        .version = null,
        .rpc_supported = false,
    };
}

pub fn discoverOpenCode(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config) !Installation {
    if (configuration.environment.get("LOCAL_STUDIO_OPENCODE_BIN")) |configured| {
        const trimmed = std.mem.trim(u8, configured, " \t\r\n");
        if (trimmed.len > 0) return probeAcp(allocator, io, configuration.environment, "configured", trimmed);
    }
    if (try pathExecutable(allocator, io, configuration.environment, "opencode2")) |executable| {
        defer allocator.free(executable);
        return probeAcp(allocator, io, configuration.environment, "system", executable);
    }
    return missing(allocator, "opencode2");
}

pub fn discoverClaude(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config) !Installation {
    if (configuration.environment.get("LOCAL_STUDIO_CLAUDE_BIN")) |configured| {
        const trimmed = std.mem.trim(u8, configured, " \t\r\n");
        if (trimmed.len > 0) return probeClaude(allocator, io, configuration.environment, "configured", trimmed);
    }
    if (try pathExecutable(allocator, io, configuration.environment, "claude")) |executable| {
        defer allocator.free(executable);
        return probeClaude(allocator, io, configuration.environment, "system", executable);
    }
    return missing(allocator, "claude");
}

pub fn writeCatalog(writer: *Io.Writer, pi: *const Installation, codex: *const Installation, fx: *const Installation, opencode: *const Installation, claude: *const Installation) !void {
    try writer.writeAll("{\"harnesses\":[");
    try writePi(writer, pi);
    try writer.writeAll(",");
    try writeInstallation(writer, "fx", "FX", "acp", fx);
    try writer.writeAll(",");
    try writeInstallation(writer, "opencode", "OpenCode", "acp", opencode);
    try writer.writeAll(",");
    try writeInstallation(writer, "codex", "Codex", "app-server", codex);
    try writer.writeAll(",");
    try writeInstallation(writer, "claude", "Claude Code", "stream-json", claude);
    try writer.writeAll("]}");
}

pub fn writeCapabilities(writer: *Io.Writer, harness: []const u8) !void {
    if (std.mem.eql(u8, harness, "pi")) return writer.writeAll("[\"persistent-session\",\"resume\",\"steer\",\"follow-up\",\"cancel\",\"images\",\"compact\",\"extension-ui\",\"extension-mcp\"]");
    if (std.mem.eql(u8, harness, "fx")) return writer.writeAll("[\"persistent-session\",\"cancel\",\"mcp\",\"filesystem-free\"]");
    if (std.mem.eql(u8, harness, "opencode")) return writer.writeAll("[\"persistent-session\",\"resume\",\"cancel\",\"mcp\",\"tools\"]");
    if (std.mem.eql(u8, harness, "codex")) return writer.writeAll("[\"persistent-session\",\"resume\",\"cancel\"]");
    if (std.mem.eql(u8, harness, "claude")) return writer.writeAll("[\"persistent-session\",\"resume\",\"cancel\",\"mcp\",\"tools\"]");
    try writer.writeAll("[]");
}

fn pathExecutable(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, name: []const u8) !?[]u8 {
    const path_value = environment.get("PATH") orelse return null;
    var directories = std.mem.splitScalar(u8, path_value, std.fs.path.delimiter);
    while (directories.next()) |directory| {
        if (directory.len == 0) continue;
        const candidate = try std.fs.path.join(allocator, &.{ directory, name });
        defer allocator.free(candidate);
        if (!executableFile(io, candidate)) continue;
        const resolved = if (std.fs.path.isAbsolute(candidate))
            Io.Dir.realPathFileAbsoluteAlloc(io, candidate, allocator) catch continue
        else
            Io.Dir.cwd().realPathFileAlloc(io, candidate, allocator) catch continue;
        defer allocator.free(resolved);
        return try allocator.dupe(u8, resolved);
    }
    return null;
}

fn probePi(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, source: []const u8, executable: []const u8) !Installation {
    const owned_source = try allocator.dupe(u8, source);
    errdefer allocator.free(owned_source);
    const owned_executable = try allocator.dupe(u8, executable);
    errdefer allocator.free(owned_executable);
    const version = commandOutput(allocator, io, environment, &.{ executable, "--version" });
    errdefer if (version) |value| allocator.free(value);
    const help = commandOutput(allocator, io, environment, &.{ executable, "--help" });
    defer if (help) |value| allocator.free(value);
    return .{
        .allocator = allocator,
        .source = owned_source,
        .executable = owned_executable,
        .version = version,
        .rpc_supported = if (help) |value| std.mem.indexOf(u8, value, "--mode") != null and std.mem.indexOf(u8, value, "rpc") != null else false,
    };
}

fn probeCodex(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, source: []const u8, executable: []const u8) !Installation {
    const owned_source = try allocator.dupe(u8, source);
    errdefer allocator.free(owned_source);
    const owned_executable = try allocator.dupe(u8, executable);
    errdefer allocator.free(owned_executable);
    const version = commandOutput(allocator, io, environment, &.{ executable, "--version" });
    errdefer if (version) |value| allocator.free(value);
    const help = commandOutput(allocator, io, environment, &.{ executable, "app-server", "--help" });
    defer if (help) |value| allocator.free(value);
    return .{
        .allocator = allocator,
        .source = owned_source,
        .executable = owned_executable,
        .version = version,
        .rpc_supported = if (help) |value| std.mem.indexOf(u8, value, "--listen") != null or std.mem.indexOf(u8, value, "stdio") != null else false,
    };
}

fn probeFx(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, source: []const u8, executable: []const u8) !Installation {
    const owned_source = try allocator.dupe(u8, source);
    errdefer allocator.free(owned_source);
    const owned_executable = try allocator.dupe(u8, executable);
    errdefer allocator.free(owned_executable);
    const version = commandOutput(allocator, io, environment, &.{ executable, "--version" });
    errdefer if (version) |value| allocator.free(value);
    const help = commandOutput(allocator, io, environment, &.{ executable, "acp", "--help" });
    defer if (help) |value| allocator.free(value);
    return .{
        .allocator = allocator,
        .source = owned_source,
        .executable = owned_executable,
        .version = version,
        .rpc_supported = help != null,
    };
}

fn probeAcp(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, source: []const u8, executable: []const u8) !Installation {
    const owned_source = try allocator.dupe(u8, source);
    errdefer allocator.free(owned_source);
    const owned_executable = try allocator.dupe(u8, executable);
    errdefer allocator.free(owned_executable);
    const version = commandOutput(allocator, io, environment, &.{ executable, "--version" });
    errdefer if (version) |value| allocator.free(value);
    const help = commandOutput(allocator, io, environment, &.{ executable, "acp", "--help" });
    defer if (help) |value| allocator.free(value);
    return .{
        .allocator = allocator,
        .source = owned_source,
        .executable = owned_executable,
        .version = version,
        .rpc_supported = help != null,
    };
}

fn probeClaude(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, source: []const u8, executable: []const u8) !Installation {
    const owned_source = try allocator.dupe(u8, source);
    errdefer allocator.free(owned_source);
    const owned_executable = try allocator.dupe(u8, executable);
    errdefer allocator.free(owned_executable);
    const version = commandOutput(allocator, io, environment, &.{ executable, "--version" });
    errdefer if (version) |value| allocator.free(value);
    const help = commandOutput(allocator, io, environment, &.{ executable, "--help" });
    defer if (help) |value| allocator.free(value);
    return .{
        .allocator = allocator,
        .source = owned_source,
        .executable = owned_executable,
        .version = version,
        .rpc_supported = if (help) |value| std.mem.indexOf(u8, value, "--output-format") != null and std.mem.indexOf(u8, value, "stream-json") != null and std.mem.indexOf(u8, value, "--session-id") != null else false,
    };
}

fn missing(allocator: std.mem.Allocator, executable: []const u8) !Installation {
    return .{
        .allocator = allocator,
        .source = try allocator.dupe(u8, "missing"),
        .executable = try allocator.dupe(u8, executable),
        .version = null,
        .rpc_supported = false,
    };
}

fn commandOutput(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, argv: []const []const u8) ?[]u8 {
    const result = std.process.run(allocator, io, .{
        .argv = argv,
        .environ_map = environment,
        .stdout_limit = .limited(64 * 1024),
        .stderr_limit = .limited(64 * 1024),
        .timeout = .{ .duration = .{ .clock = .awake, .raw = .fromSeconds(3) } },
    }) catch return null;
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    const successful = switch (result.term) {
        .exited => |code| code == 0,
        else => false,
    };
    if (!successful) return null;
    const output = std.mem.trim(u8, if (result.stdout.len > 0) result.stdout else result.stderr, " \t\r\n");
    if (output.len == 0) return null;
    return allocator.dupe(u8, output) catch null;
}

fn executableFile(io: Io, path: []const u8) bool {
    const stat = Io.Dir.cwd().statFile(io, path, .{}) catch return false;
    return stat.kind == .file and stat.permissions.toMode() & 0o111 != 0;
}

fn writePi(writer: *Io.Writer, installation: *const Installation) !void {
    try writeInstallation(writer, "pi", "Pi", "jsonl-rpc", installation);
}

fn writeInstallation(writer: *Io.Writer, id: []const u8, name: []const u8, transport: []const u8, installation: *const Installation) !void {
    try writer.writeAll("{\"id\":");
    try std.json.Stringify.value(id, .{}, writer);
    try writer.writeAll(",\"name\":");
    try std.json.Stringify.value(name, .{}, writer);
    try writer.writeAll(",\"status\":");
    try std.json.Stringify.value(if (installation.available()) "available" else if (installation.version != null) "unsupported" else "missing", .{}, writer);
    try writer.writeAll(",\"selectable\":true");
    try writer.writeAll(",\"transport\":");
    try std.json.Stringify.value(transport, .{}, writer);
    try writer.writeAll(",\"installation\":{\"source\":");
    try std.json.Stringify.value(installation.source, .{}, writer);
    try writer.writeAll(",\"executable\":");
    try std.json.Stringify.value(installation.executable, .{}, writer);
    try writer.writeAll(",\"version\":");
    if (installation.version) |value| try std.json.Stringify.value(value, .{}, writer) else try writer.writeAll("null");
    try writer.writeAll("},\"capabilities\":");
    try writeCapabilities(writer, id);
    try writer.writeByte('}');
}

fn knownPiLocations() []const []const u8 {
    return &.{ "/opt/homebrew/bin/pi", "/usr/local/bin/pi", "/usr/bin/pi" };
}

fn knownCodexLocations() []const []const u8 {
    return &.{ "/opt/homebrew/bin/codex", "/usr/local/bin/codex", "/usr/bin/codex" };
}

fn knownFxLocations() []const []const u8 {
    return &.{ "/opt/homebrew/bin/fx", "/usr/local/bin/fx", "/usr/bin/fx" };
}
