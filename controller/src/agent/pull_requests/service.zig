const std = @import("std");
const config = @import("../../app/config.zig");
const sqlite = @import("../../storage/sqlite.zig");
const agent_projects = @import("../projects/service.zig");
const harness_nodes = @import("../harness/nodes.zig");
const node_transport = @import("../../topology/node_transport.zig");

const Io = std.Io;
const http = std.http;
const max_output_bytes = 4 * 1024 * 1024;
const view_fields = "number,title,url,state,isDraft,headRefName,baseRefName,additions,deletions,reviewRequests,reviews,comments,body,mergeable,statusCheckRollup";
const list_fields = "number,title,headRefName,updatedAt,isDraft";

const Command = struct {
    allocator: std.mem.Allocator,
    ok: bool,
    stdout: []u8,
    stderr: []u8,

    fn deinit(command: *Command) void {
        command.allocator.free(command.stdout);
        command.allocator.free(command.stderr);
        command.* = undefined;
    }
};

pub fn getPayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, configuration: *const config.Config, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8, cwd: []const u8) ![]u8 {
    if (mode == .standalone) return getLocal(allocator, io, configuration, cwd);
    const encoded = try encodeQuery(allocator, cwd);
    defer allocator.free(encoded);
    const path = try std.fmt.allocPrint(allocator, "/internal/node/v1/pr?cwd={s}", .{encoded});
    defer allocator.free(path);
    return remote(allocator, io, client, database, preferred_node, path, .GET, null);
}

pub fn mergePayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, configuration: *const config.Config, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8, document: []const u8) ![]u8 {
    if (mode == .standalone) return mergeLocal(allocator, io, configuration, document);
    return remote(allocator, io, client, database, preferred_node, "/internal/node/v1/pr/merge", .POST, document);
}

pub fn getLocal(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config, cwd: []const u8) ![]u8 {
    const resolved = try agent_projects.resolveAllowedPath(allocator, io, configuration.environment, cwd);
    defer allocator.free(resolved);
    var view = run(allocator, io, configuration.environment, resolved, &.{ "gh", "pr", "view", "--json", view_fields }) catch |failure| return friendlyPayload(allocator, @errorName(failure));
    defer view.deinit();
    if (view.ok) return normalizeView(allocator, view.stdout) catch friendlyPayload(allocator, "GitHub CLI returned invalid pull request data");
    if (containsIgnoreCase(view.stderr, "no pull request") or containsIgnoreCase(view.stderr, "no open pull request")) return listLocal(allocator, io, configuration.environment, resolved);
    return friendlyPayload(allocator, friendlyError(view.stderr));
}

pub fn mergeLocal(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config, document: []const u8) ![]u8 {
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidPrPayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidPrPayload;
    const cwd = stringField(parsed.value.object, "cwd") orelse return error.PrCwdRequired;
    const number = integerField(parsed.value.object, "number") orelse return error.InvalidPrNumber;
    if (number <= 0) return error.InvalidPrNumber;
    const method = stringField(parsed.value.object, "method") orelse "merge";
    if (!std.mem.eql(u8, method, "merge") and !std.mem.eql(u8, method, "squash") and !std.mem.eql(u8, method, "rebase")) return error.InvalidPrMethod;
    const resolved = try agent_projects.resolveAllowedPath(allocator, io, configuration.environment, cwd);
    defer allocator.free(resolved);
    var number_buffer: [32]u8 = undefined;
    const number_value = try std.fmt.bufPrint(&number_buffer, "{d}", .{number});
    var method_buffer: [16]u8 = undefined;
    const method_value = try std.fmt.bufPrint(&method_buffer, "--{s}", .{method});
    var result = run(allocator, io, configuration.environment, resolved, &.{ "gh", "pr", "merge", number_value, method_value }) catch |failure| return mergeResult(allocator, false, @errorName(failure));
    defer result.deinit();
    return mergeResult(allocator, result.ok, if (result.ok) null else friendlyError(result.stderr));
}

fn listLocal(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, cwd: []const u8) ![]u8 {
    var result = run(allocator, io, environment, cwd, &.{ "gh", "pr", "list", "--json", list_fields, "--limit", "20" }) catch |failure| return friendlyPayload(allocator, @errorName(failure));
    defer result.deinit();
    if (!result.ok) return friendlyPayload(allocator, friendlyError(result.stderr));
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, result.stdout, .{}) catch return friendlyPayload(allocator, "GitHub CLI returned invalid pull request data");
    defer parsed.deinit();
    if (parsed.value != .array) return friendlyPayload(allocator, "GitHub CLI returned invalid pull request data");
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"prs\":");
    try std.json.Stringify.value(parsed.value, .{}, &output.writer);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn normalizeView(allocator: std.mem.Allocator, document: []const u8) ![]u8 {
    var parsed = try std.json.parseFromSlice(std.json.Value, allocator, document, .{});
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidPrResponse;
    const object = parsed.value.object;
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"pr\":{");
    try writeInteger(&output.writer, "number", valueInteger(object, "number"), true);
    try writeString(&output.writer, "title", valueString(object, "title") orelse "", false);
    try writeString(&output.writer, "url", valueString(object, "url") orelse "", false);
    try writeString(&output.writer, "state", valueString(object, "state") orelse "UNKNOWN", false);
    try output.writer.print(",\"isDraft\":{}", .{valueBool(object, "isDraft")});
    try writeString(&output.writer, "headRefName", valueString(object, "headRefName") orelse "", false);
    try writeString(&output.writer, "baseRefName", valueString(object, "baseRefName") orelse "", false);
    try writeInteger(&output.writer, "additions", valueInteger(object, "additions"), false);
    try writeInteger(&output.writer, "deletions", valueInteger(object, "deletions"), false);
    try output.writer.writeAll(",\"reviewers\":[");
    if (object.get("reviewRequests")) |requests| if (requests == .array) {
        var count: usize = 0;
        for (requests.array.items) |entry| {
            if (entry != .object) continue;
            const name = valueString(entry.object, "login") orelse valueString(entry.object, "name") orelse valueString(entry.object, "slug") orelse continue;
            if (count > 0) try output.writer.writeByte(',');
            try std.json.Stringify.value(name, .{}, &output.writer);
            count += 1;
        }
    };
    const comments_count: usize = if (object.get("comments")) |comments| if (comments == .array) comments.array.items.len else 0 else 0;
    try output.writer.print("],\"commentsCount\":{d}", .{comments_count});
    try writeString(&output.writer, "body", valueStringAllowEmpty(object, "body") orelse "", false);
    try writeString(&output.writer, "mergeable", valueString(object, "mergeable") orelse "UNKNOWN", false);
    try output.writer.writeAll(",\"checks\":[");
    var pending: usize = 0;
    var passing: usize = 0;
    var failing: usize = 0;
    var emitted: usize = 0;
    if (object.get("statusCheckRollup")) |rollup| if (rollup == .array) {
        for (rollup.array.items) |entry| {
            if (entry != .object) continue;
            const name = valueString(entry.object, "name") orelse valueString(entry.object, "context") orelse "check";
            const status = valueString(entry.object, "status") orelse valueString(entry.object, "state") orelse "UNKNOWN";
            const conclusion = valueString(entry.object, "conclusion");
            const bucket = classify(entry.object);
            if (std.mem.eql(u8, bucket, "pending")) pending += 1 else if (std.mem.eql(u8, bucket, "passing")) passing += 1 else failing += 1;
            if (emitted > 0) try output.writer.writeByte(',');
            try output.writer.writeAll("{\"name\":");
            try std.json.Stringify.value(name, .{}, &output.writer);
            try output.writer.writeAll(",\"status\":");
            try std.json.Stringify.value(status, .{}, &output.writer);
            try output.writer.writeAll(",\"conclusion\":");
            if (conclusion) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
            try output.writer.writeAll(",\"bucket\":");
            try std.json.Stringify.value(bucket, .{}, &output.writer);
            try output.writer.writeByte('}');
            emitted += 1;
        }
    };
    try output.writer.print("],\"checksSummary\":{{\"pending\":{d},\"passing\":{d},\"failing\":{d},\"total\":{d}", .{ pending, passing, failing, pending + passing + failing });
    try output.writer.writeAll("}}}");
    return output.toOwnedSlice();
}

fn run(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, cwd: []const u8, argv: []const []const u8) !Command {
    var clean_environment = try environment.clone(allocator);
    defer clean_environment.deinit();
    for ([_][]const u8{ "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX" }) |name| _ = clean_environment.swapRemove(name);
    const result = try std.process.run(allocator, io, .{
        .argv = argv,
        .cwd = .{ .path = cwd },
        .environ_map = &clean_environment,
        .stdout_limit = .limited(max_output_bytes),
        .stderr_limit = .limited(max_output_bytes),
        .timeout = .{ .duration = .{ .clock = .awake, .raw = .fromSeconds(15) } },
    });
    return .{ .allocator = allocator, .ok = switch (result.term) {
        .exited => |code| code == 0,
        else => false,
    }, .stdout = result.stdout, .stderr = result.stderr };
}

fn remote(allocator: std.mem.Allocator, io: Io, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8, path: []const u8, method: http.Method, document: ?[]const u8) ![]u8 {
    var target = (try harness_nodes.selectCapability(allocator, io, database, "terminal", preferred_node)) orelse return error.PrNodeRequired;
    defer target.deinit();
    return if (method == .GET) node_transport.get(allocator, client, &target, path) catch error.PrNodeUnavailable else node_transport.send(allocator, client, &target, path, method, document) catch error.PrNodeUnavailable;
}

fn classify(object: std.json.ObjectMap) []const u8 {
    if (valueString(object, "state")) |state| {
        if (std.ascii.eqlIgnoreCase(state, "SUCCESS")) return "passing";
        if (std.ascii.eqlIgnoreCase(state, "PENDING") or std.ascii.eqlIgnoreCase(state, "EXPECTED")) return "pending";
        return "failing";
    }
    if (valueString(object, "status")) |status| if (!std.ascii.eqlIgnoreCase(status, "COMPLETED")) return "pending";
    const conclusion = valueString(object, "conclusion") orelse return "pending";
    if (std.ascii.eqlIgnoreCase(conclusion, "SUCCESS") or std.ascii.eqlIgnoreCase(conclusion, "NEUTRAL") or std.ascii.eqlIgnoreCase(conclusion, "SKIPPED")) return "passing";
    return "failing";
}

fn friendlyPayload(allocator: std.mem.Allocator, detail: []const u8) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"error\":");
    try std.json.Stringify.value(detail, .{}, &output.writer);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn mergeResult(allocator: std.mem.Allocator, ok: bool, detail: ?[]const u8) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.print("{{\"ok\":{}", .{ok});
    if (detail) |value| {
        try output.writer.writeAll(",\"error\":");
        try std.json.Stringify.value(value, .{}, &output.writer);
    }
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn friendlyError(stderr: []const u8) []const u8 {
    const trimmed = std.mem.trim(u8, stderr, " \t\r\n");
    if (containsIgnoreCase(trimmed, "gh auth login") or containsIgnoreCase(trimmed, "not logged into")) return "GitHub CLI is not authenticated. Run `gh auth login` in a terminal.";
    return if (trimmed.len == 0) "GitHub CLI command failed" else std.mem.sliceTo(trimmed, '\n');
}

fn containsIgnoreCase(haystack: []const u8, needle: []const u8) bool {
    if (needle.len == 0 or haystack.len < needle.len) return false;
    var index: usize = 0;
    while (index + needle.len <= haystack.len) : (index += 1) if (std.ascii.eqlIgnoreCase(haystack[index .. index + needle.len], needle)) return true;
    return false;
}

fn writeString(writer: *Io.Writer, name: []const u8, value: []const u8, first: bool) !void {
    if (!first) try writer.writeByte(',');
    try std.json.Stringify.value(name, .{}, writer);
    try writer.writeByte(':');
    try std.json.Stringify.value(value, .{}, writer);
}

fn writeInteger(writer: *Io.Writer, name: []const u8, value: i64, first: bool) !void {
    if (!first) try writer.writeByte(',');
    try std.json.Stringify.value(name, .{}, writer);
    try writer.print(":{d}", .{value});
}

fn valueString(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len == 0) null else trimmed;
}

fn valueStringAllowEmpty(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    return if (value == .string) value.string else null;
}

fn valueInteger(object: std.json.ObjectMap, name: []const u8) i64 {
    const value = object.get(name) orelse return 0;
    return if (value == .integer) value.integer else 0;
}

fn valueBool(object: std.json.ObjectMap, name: []const u8) bool {
    const value = object.get(name) orelse return false;
    return value == .bool and value.bool;
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    return valueString(object, name);
}

fn integerField(object: std.json.ObjectMap, name: []const u8) ?i64 {
    const value = object.get(name) orelse return null;
    return if (value == .integer) value.integer else null;
}

fn encodeQuery(allocator: std.mem.Allocator, value: []const u8) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    for (value) |character| if (std.ascii.isAlphanumeric(character) or character == '-' or character == '_' or character == '.' or character == '~') try output.writer.writeByte(character) else try output.writer.print("%{X:0>2}", .{character});
    return output.toOwnedSlice();
}
