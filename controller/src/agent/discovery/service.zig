const std = @import("std");
const config = @import("../../app/config.zig");
const sqlite = @import("../../storage/sqlite.zig");
const harness_nodes = @import("../harness/nodes.zig");
const node_transport = @import("../../topology/node_transport.zig");

const Io = std.Io;
const http = std.http;
const max_instructions_bytes = 6000;
const max_metadata_bytes = 256 * 1024;
const max_rows = 2048;

const Root = struct {
    allocator: std.mem.Allocator,
    source: []u8,
    path: []u8,

    fn deinit(root: *Root) void {
        root.allocator.free(root.source);
        root.allocator.free(root.path);
        root.* = undefined;
    }
};

const Row = struct {
    allocator: std.mem.Allocator,
    id: []u8,
    name: []u8,
    source: []u8,
    path: []u8,
    description: ?[]u8 = null,
    argument_hint: ?[]u8 = null,

    fn deinit(row: *Row) void {
        row.allocator.free(row.id);
        row.allocator.free(row.name);
        row.allocator.free(row.source);
        row.allocator.free(row.path);
        if (row.description) |value| row.allocator.free(value);
        if (row.argument_hint) |value| row.allocator.free(value);
        row.* = undefined;
    }
};

pub fn skillsPayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, configuration: *const config.Config, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8) ![]u8 {
    if (mode == .standalone) return skillsLocal(allocator, io, configuration);
    return remote(allocator, io, client, database, preferred_node, "/internal/node/v1/skills");
}

pub fn skillPayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, configuration: *const config.Config, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8, path: []const u8) ![]u8 {
    if (mode == .standalone) return skillLocal(allocator, io, configuration, path);
    const encoded = try queryEncode(allocator, path);
    defer allocator.free(encoded);
    const target = try std.fmt.allocPrint(allocator, "/internal/node/v1/skills/load?path={s}", .{encoded});
    defer allocator.free(target);
    return remote(allocator, io, client, database, preferred_node, target);
}

pub fn templatesPayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, configuration: *const config.Config, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8) ![]u8 {
    if (mode == .standalone) return templatesLocal(allocator, io, configuration);
    return remote(allocator, io, client, database, preferred_node, "/internal/node/v1/prompt-templates");
}

pub fn templatePayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, configuration: *const config.Config, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8, path: []const u8) ![]u8 {
    if (mode == .standalone) return templateLocal(allocator, io, configuration, path);
    const encoded = try queryEncode(allocator, path);
    defer allocator.free(encoded);
    const target = try std.fmt.allocPrint(allocator, "/internal/node/v1/prompt-templates/load?path={s}", .{encoded});
    defer allocator.free(target);
    return remote(allocator, io, client, database, preferred_node, target);
}

pub fn skillsLocal(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config) ![]u8 {
    var roots = try skillRoots(allocator, configuration);
    defer deinitRoots(allocator, &roots);
    var rows: std.ArrayList(Row) = .empty;
    defer deinitRows(allocator, &rows);
    for (roots.items) |root| try visitSkills(allocator, io, &rows, root, root.path, 0);
    sortRows(rows.items);
    return rowsPayload(allocator, "skills", rows.items);
}

pub fn skillLocal(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config, path: []const u8) ![]u8 {
    var roots = try skillRoots(allocator, configuration);
    defer deinitRoots(allocator, &roots);
    const resolved = try allowedPath(allocator, io, path, roots.items);
    defer allocator.free(resolved.path);
    defer allocator.free(resolved.source);
    const file = try std.fs.path.join(allocator, &.{ resolved.path, "SKILL.md" });
    defer allocator.free(file);
    const instructions = Io.Dir.cwd().readFileAlloc(io, file, allocator, .limited(max_instructions_bytes)) catch return error.DiscoveryNotFound;
    defer allocator.free(instructions);
    const name = try displayName(allocator, resolved.path);
    defer allocator.free(name);
    var row = try makeRow(allocator, resolved.source, resolved.path, name, null, null);
    defer row.deinit();
    return loadedPayload(allocator, "skill", &row, instructions);
}

pub fn templatesLocal(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config) ![]u8 {
    var roots = try templateRoots(allocator, configuration);
    defer deinitRoots(allocator, &roots);
    var rows: std.ArrayList(Row) = .empty;
    defer deinitRows(allocator, &rows);
    for (roots.items) |root| try visitTemplates(allocator, io, &rows, root);
    sortRows(rows.items);
    return rowsPayload(allocator, "templates", rows.items);
}

pub fn templateLocal(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config, path: []const u8) ![]u8 {
    var roots = try templateRoots(allocator, configuration);
    defer deinitRoots(allocator, &roots);
    const resolved = try allowedPath(allocator, io, path, roots.items);
    defer allocator.free(resolved.path);
    defer allocator.free(resolved.source);
    if (!std.mem.endsWith(u8, resolved.path, ".md")) return error.DiscoveryNotFound;
    const instructions = Io.Dir.cwd().readFileAlloc(io, resolved.path, allocator, .limited(max_instructions_bytes)) catch return error.DiscoveryNotFound;
    defer allocator.free(instructions);
    var row = try templateRow(allocator, io, resolved.source, resolved.path);
    defer row.deinit();
    return loadedPayload(allocator, "template", &row, instructions);
}

fn remote(allocator: std.mem.Allocator, io: Io, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8, path: []const u8) ![]u8 {
    var target = (try harness_nodes.selectCapability(allocator, io, database, "terminal", preferred_node)) orelse return error.DiscoveryNodeRequired;
    defer target.deinit();
    return node_transport.get(allocator, client, &target, path) catch error.DiscoveryNodeUnavailable;
}

fn skillRoots(allocator: std.mem.Allocator, configuration: *const config.Config) !std.ArrayList(Root) {
    var roots: std.ArrayList(Root) = .empty;
    errdefer deinitRoots(allocator, &roots);
    const home = configuration.environment.get("HOME") orelse return error.HomeDirectoryUnavailable;
    const entries = [_]struct { source: []const u8, parts: []const []const u8 }{
        .{ .source = "~/.claude", .parts = &.{ home, ".claude", "skills" } },
        .{ .source = "~/.claude", .parts = &.{ home, ".claude", "plugins", "cache" } },
        .{ .source = "~/.pi", .parts = &.{ home, ".pi", "skills" } },
        .{ .source = "~/.pi", .parts = &.{ home, ".pi", "agent", "skills" } },
        .{ .source = "~/.codex", .parts = &.{ home, ".codex", "skills" } },
        .{ .source = "~/.codex", .parts = &.{ home, ".codex", "plugins", "cache" } },
        .{ .source = "~/.codex", .parts = &.{ home, ".codex", "vendor_imports", "skills" } },
        .{ .source = "~/.factory", .parts = &.{ home, ".factory", "skills" } },
        .{ .source = "~/.factory", .parts = &.{ home, ".factory", "plugins", "cache" } },
        .{ .source = "~/.factory", .parts = &.{ home, ".factory", "plugins" } },
        .{ .source = "~/.opencode", .parts = &.{ home, ".opencode", "skills" } },
    };
    for (entries) |entry| try appendRoot(allocator, &roots, entry.source, entry.parts);
    for ([_][]const u8{ "openai-bundled", "openai-curated", "openai-primary-runtime" }) |source| {
        try appendRoot(allocator, &roots, source, &.{ "/Applications", "Codex.app", "Contents", "Resources", "plugins", source });
        try appendRoot(allocator, &roots, source, &.{ "/Applications", "Codex.app", "Contents", "Resources", "plugins", source, "plugins" });
    }
    return roots;
}

fn templateRoots(allocator: std.mem.Allocator, configuration: *const config.Config) !std.ArrayList(Root) {
    var roots: std.ArrayList(Root) = .empty;
    errdefer deinitRoots(allocator, &roots);
    const home = configuration.environment.get("HOME") orelse return error.HomeDirectoryUnavailable;
    try appendRoot(allocator, &roots, "local-studio", &.{ configuration.data_dir, "pi-agent", "prompt-templates" });
    try appendRoot(allocator, &roots, "local-studio", &.{ configuration.data_dir, "pi-agent", "prompts" });
    try appendRoot(allocator, &roots, "~/.pi", &.{ home, ".pi", "prompts" });
    try appendRoot(allocator, &roots, "~/.pi", &.{ home, ".pi", "agent", "prompts" });
    try appendRoot(allocator, &roots, "~/.claude", &.{ home, ".claude", "prompts" });
    try appendRoot(allocator, &roots, "~/.codex", &.{ home, ".codex", "prompts" });
    return roots;
}

fn appendRoot(allocator: std.mem.Allocator, roots: *std.ArrayList(Root), source: []const u8, parts: []const []const u8) !void {
    const path = try std.fs.path.join(allocator, parts);
    errdefer allocator.free(path);
    try roots.append(allocator, .{ .allocator = allocator, .source = try allocator.dupe(u8, source), .path = path });
}

fn visitSkills(allocator: std.mem.Allocator, io: Io, rows: *std.ArrayList(Row), root: Root, path: []const u8, depth: u8) !void {
    if (depth > 9 or rows.items.len >= max_rows) return;
    var directory = Io.Dir.cwd().openDir(io, path, .{ .iterate = true }) catch return;
    defer directory.close(io);
    var entries: std.ArrayList([]u8) = .empty;
    defer {
        for (entries.items) |entry| allocator.free(entry);
        entries.deinit(allocator);
    }
    var iterator = directory.iterateAssumeFirstIteration();
    var found = false;
    while (try iterator.next(io)) |entry| {
        if (std.mem.eql(u8, entry.name, "SKILL.md")) found = true;
        if (entry.kind == .directory and !(depth > 0 and std.mem.startsWith(u8, entry.name, "."))) try entries.append(allocator, try allocator.dupe(u8, entry.name));
    }
    if (found) {
        const name = try displayName(allocator, path);
        defer allocator.free(name);
        if (!containsName(rows.items, name)) try rows.append(allocator, try makeRow(allocator, root.source, path, name, null, null));
        return;
    }
    for (entries.items) |entry| {
        const child = try std.fs.path.join(allocator, &.{ path, entry });
        defer allocator.free(child);
        try visitSkills(allocator, io, rows, root, child, depth + 1);
    }
}

fn visitTemplates(allocator: std.mem.Allocator, io: Io, rows: *std.ArrayList(Row), root: Root) !void {
    if (rows.items.len >= max_rows) return;
    var directory = Io.Dir.cwd().openDir(io, root.path, .{ .iterate = true }) catch return;
    defer directory.close(io);
    var iterator = directory.iterateAssumeFirstIteration();
    while (try iterator.next(io)) |entry| {
        if (rows.items.len >= max_rows or entry.kind != .file or !std.mem.endsWith(u8, entry.name, ".md")) continue;
        const path = try std.fs.path.join(allocator, &.{ root.path, entry.name });
        defer allocator.free(path);
        var row = templateRow(allocator, io, root.source, path) catch continue;
        if (containsId(rows.items, row.id)) row.deinit() else try rows.append(allocator, row);
    }
}

fn templateRow(allocator: std.mem.Allocator, io: Io, source: []const u8, path: []const u8) !Row {
    const document = try Io.Dir.cwd().readFileAlloc(io, path, allocator, .limited(max_metadata_bytes));
    defer allocator.free(document);
    const metadata = frontMatter(document);
    const basename = std.fs.path.basename(path);
    const fallback = basename[0 .. basename.len - ".md".len];
    const name = if (metadata.name) |value| value else fallback;
    return makeRow(allocator, source, path, name, metadata.description, metadata.argument_hint);
}

const Metadata = struct { name: ?[]const u8 = null, description: ?[]const u8 = null, argument_hint: ?[]const u8 = null };

fn frontMatter(document: []const u8) Metadata {
    var result: Metadata = .{};
    if (!std.mem.startsWith(u8, document, "---")) return result;
    const first_newline = std.mem.indexOfScalar(u8, document, '\n') orelse return result;
    const end = std.mem.indexOfPos(u8, document, first_newline + 1, "\n---") orelse return result;
    var lines = std.mem.splitScalar(u8, document[first_newline + 1 .. end], '\n');
    while (lines.next()) |raw_line| {
        const line = std.mem.trim(u8, raw_line, " \t\r");
        const separator = std.mem.indexOfScalar(u8, line, ':') orelse continue;
        const key = std.mem.trim(u8, line[0..separator], " \t");
        var value = std.mem.trim(u8, line[separator + 1 ..], " \t\r");
        if (value.len >= 2 and value[0] == '"' and value[value.len - 1] == '"') value = value[1 .. value.len - 1];
        if (std.ascii.eqlIgnoreCase(key, "name")) result.name = value else if (std.ascii.eqlIgnoreCase(key, "description")) result.description = value else if (std.ascii.eqlIgnoreCase(key, "argument-hint") or std.ascii.eqlIgnoreCase(key, "argumenthint")) result.argument_hint = value;
    }
    return result;
}

fn makeRow(allocator: std.mem.Allocator, source: []const u8, path: []const u8, name: []const u8, description: ?[]const u8, argument_hint: ?[]const u8) !Row {
    const lower = try allocator.dupe(u8, name);
    defer allocator.free(lower);
    for (lower) |*character| character.* = std.ascii.toLower(character.*);
    return .{
        .allocator = allocator,
        .id = try std.fmt.allocPrint(allocator, "{s}:{s}", .{ source, lower }),
        .name = try allocator.dupe(u8, name),
        .source = try allocator.dupe(u8, source),
        .path = try allocator.dupe(u8, path),
        .description = if (description) |value| try allocator.dupe(u8, value) else null,
        .argument_hint = if (argument_hint) |value| try allocator.dupe(u8, value) else null,
    };
}

fn displayName(allocator: std.mem.Allocator, path: []const u8) ![]u8 {
    const base = std.fs.path.basename(path);
    const name = try allocator.dupe(u8, base);
    for (name) |*character| if (character.* == '-' or character.* == '_') {
        character.* = ' ';
    };
    return name;
}

const Resolved = struct { source: []u8, path: []u8 };

fn allowedPath(allocator: std.mem.Allocator, io: Io, input: []const u8, roots: []const Root) !Resolved {
    if (!std.fs.path.isAbsolute(input)) return error.DiscoveryNotFound;
    const canonical_z = Io.Dir.realPathFileAbsoluteAlloc(io, input, allocator) catch return error.DiscoveryNotFound;
    defer allocator.free(canonical_z);
    const canonical = canonical_z[0..canonical_z.len];
    for (roots) |root| {
        if (!std.fs.path.isAbsolute(root.path)) continue;
        const root_path = Io.Dir.realPathFileAbsoluteAlloc(io, root.path, allocator) catch continue;
        defer allocator.free(root_path);
        if (!within(root_path, canonical)) continue;
        return .{ .source = try allocator.dupe(u8, root.source), .path = try allocator.dupe(u8, canonical) };
    }
    return error.DiscoveryNotFound;
}

fn within(root: []const u8, path: []const u8) bool {
    if (std.mem.eql(u8, root, path)) return true;
    return path.len > root.len and std.mem.startsWith(u8, path, root) and std.fs.path.isSep(path[root.len]);
}

fn rowsPayload(allocator: std.mem.Allocator, key: []const u8, rows: []const Row) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.print("{{\"{s}\":[", .{key});
    for (rows, 0..) |row, index| {
        if (index > 0) try output.writer.writeByte(',');
        try writeRow(&output.writer, &row, true);
    }
    try output.writer.writeAll("]}");
    return output.toOwnedSlice();
}

fn loadedPayload(allocator: std.mem.Allocator, key: []const u8, row: *const Row, instructions: []const u8) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.print("{{\"{s}\":", .{key});
    try writeRow(&output.writer, row, false);
    try output.writer.writeAll(",\"instructions\":");
    try std.json.Stringify.value(instructions, .{}, &output.writer);
    try output.writer.writeAll("}}");
    return output.toOwnedSlice();
}

fn writeRow(writer: *Io.Writer, row: *const Row, close: bool) !void {
    try writer.writeAll("{\"id\":");
    try std.json.Stringify.value(row.id, .{}, writer);
    try writer.writeAll(",\"name\":");
    try std.json.Stringify.value(row.name, .{}, writer);
    try writer.writeAll(",\"source\":");
    try std.json.Stringify.value(row.source, .{}, writer);
    try writer.writeAll(",\"path\":");
    try std.json.Stringify.value(row.path, .{}, writer);
    if (row.description) |value| {
        try writer.writeAll(",\"description\":");
        try std.json.Stringify.value(value, .{}, writer);
    }
    if (row.argument_hint) |value| {
        try writer.writeAll(",\"argumentHint\":");
        try std.json.Stringify.value(value, .{}, writer);
    }
    if (close) try writer.writeByte('}');
}

fn containsName(rows: []const Row, name: []const u8) bool {
    for (rows) |row| if (std.ascii.eqlIgnoreCase(row.name, name)) return true;
    return false;
}

fn containsId(rows: []const Row, id: []const u8) bool {
    for (rows) |row| if (std.mem.eql(u8, row.id, id)) return true;
    return false;
}

fn sortRows(rows: []Row) void {
    std.mem.sort(Row, rows, {}, struct {
        fn less(_: void, left: Row, right: Row) bool {
            const order = std.ascii.orderIgnoreCase(left.name, right.name);
            return order == .lt or order == .eq and std.mem.order(u8, left.source, right.source) == .lt;
        }
    }.less);
}

fn deinitRows(allocator: std.mem.Allocator, rows: *std.ArrayList(Row)) void {
    for (rows.items) |*row| row.deinit();
    rows.deinit(allocator);
}

fn deinitRoots(allocator: std.mem.Allocator, roots: *std.ArrayList(Root)) void {
    for (roots.items) |*root| root.deinit();
    roots.deinit(allocator);
}

fn queryEncode(allocator: std.mem.Allocator, value: []const u8) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    for (value) |character| {
        if (std.ascii.isAlphanumeric(character) or character == '-' or character == '_' or character == '.' or character == '~') try output.writer.writeByte(character) else try output.writer.print("%{X:0>2}", .{character});
    }
    return output.toOwnedSlice();
}
