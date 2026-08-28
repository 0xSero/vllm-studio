const std = @import("std");
const config = @import("../../app/config.zig");
const sqlite = @import("../../storage/sqlite.zig");
const agent_projects = @import("../projects/service.zig");
const harness_nodes = @import("../harness/nodes.zig");
const node_transport = @import("../../topology/node_transport.zig");
const git_policy = @import("policy.zig");

const Io = std.Io;
const http = std.http;
const max_output_bytes = 12 * 1024 * 1024;

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

pub fn statePayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, configuration: *const config.Config, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8, cwd: []const u8) ![]u8 {
    if (mode == .standalone) return stateLocal(allocator, io, configuration, cwd);
    return remoteGet(allocator, io, client, database, preferred_node, "/internal/node/v1/git", cwd);
}

pub fn actionPayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, configuration: *const config.Config, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8, cwd: []const u8, document: []const u8) ![]u8 {
    if (mode == .standalone) return actionLocal(allocator, io, configuration, cwd, document);
    return remoteSend(allocator, io, client, database, preferred_node, "/internal/node/v1/git", cwd, document);
}

pub fn branchesPayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, configuration: *const config.Config, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8, cwd: []const u8) ![]u8 {
    if (mode == .standalone) return branchesLocal(allocator, io, configuration, cwd);
    return remoteGet(allocator, io, client, database, preferred_node, "/internal/node/v1/git/branches", cwd);
}

pub fn worktreesPayload(allocator: std.mem.Allocator, io: Io, mode: config.Mode, configuration: *const config.Config, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8, cwd: []const u8) ![]u8 {
    if (mode == .standalone) return worktreesLocal(allocator, io, configuration, cwd);
    return remoteGet(allocator, io, client, database, preferred_node, "/internal/node/v1/git/worktrees", cwd);
}

pub fn stateLocal(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config, cwd: []const u8) ![]u8 {
    const resolved = try agent_projects.resolveAllowedPath(allocator, io, configuration.environment, cwd);
    defer allocator.free(resolved);
    var inside = try git(allocator, io, configuration.environment, resolved, &.{ "rev-parse", "--is-inside-work-tree" });
    defer inside.deinit();
    if (!inside.ok or !std.mem.eql(u8, std.mem.trim(u8, inside.stdout, " \t\r\n"), "true")) return emptyState(allocator, false);
    var head = try git(allocator, io, configuration.environment, resolved, &.{ "rev-parse", "--verify", "HEAD" });
    defer head.deinit();
    const has_head = head.ok and std.mem.trim(u8, head.stdout, " \t\r\n").len > 0;
    var branch = try git(allocator, io, configuration.environment, resolved, &.{ "branch", "--show-current" });
    defer branch.deinit();
    var status = try git(allocator, io, configuration.environment, resolved, &.{ "status", "--short" });
    defer status.deinit();
    var diff = if (has_head)
        try git(allocator, io, configuration.environment, resolved, &.{ "diff", "--no-ext-diff", "HEAD", "--src-prefix=a/", "--dst-prefix=b/" })
    else
        try git(allocator, io, configuration.environment, resolved, &.{ "diff", "--no-ext-diff", "--cached", "--src-prefix=a/", "--dst-prefix=b/" });
    defer diff.deinit();
    var numstat = if (has_head)
        try git(allocator, io, configuration.environment, resolved, &.{ "diff", "--numstat", "HEAD", "--" })
    else
        try git(allocator, io, configuration.environment, resolved, &.{ "diff", "--numstat", "--cached", "--" });
    defer numstat.deinit();
    var refs = try git(allocator, io, configuration.environment, resolved, &.{ "for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes" });
    defer refs.deinit();
    var upstream = try git(allocator, io, configuration.environment, resolved, &.{ "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}" });
    defer upstream.deinit();
    var remote = try git(allocator, io, configuration.environment, resolved, &.{ "remote", "get-url", "origin" });
    defer remote.deinit();
    const current = std.mem.trim(u8, branch.stdout, " \t\r\n");
    const remote_url = std.mem.trim(u8, remote.stdout, " \t\r\n");
    const counts = countNumstat(numstat.stdout);
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"isRepo\":true,\"branch\":");
    if (current.len > 0) try std.json.Stringify.value(current, .{}, &output.writer) else try output.writer.writeAll("null");
    try output.writer.writeAll(",\"status\":[");
    try writeStatusLines(&output.writer, status.stdout, false);
    try output.writer.writeAll("],\"entries\":[");
    try writeStatusLines(&output.writer, status.stdout, true);
    try output.writer.writeAll("],\"diff\":");
    try std.json.Stringify.value(diff.stdout, .{}, &output.writer);
    try output.writer.print(",\"additions\":{d},\"deletions\":{d},\"refs\":[", .{ counts.additions, counts.deletions });
    try writeRefs(&output.writer, refs.stdout, current);
    try output.writer.print("],\"hasUpstream\":{},\"remoteUrl\":", .{upstream.ok and std.mem.trim(u8, upstream.stdout, " \t\r\n").len > 0});
    if (remote_url.len > 0) try std.json.Stringify.value(remote_url, .{}, &output.writer) else try output.writer.writeAll("null");
    try output.writer.writeAll(",\"prUrl\":");
    const pr_url = try pullRequestUrl(allocator, remote_url, current);
    defer if (pr_url) |value| allocator.free(value);
    if (pr_url) |value| try std.json.Stringify.value(value, .{}, &output.writer) else try output.writer.writeAll("null");
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

pub fn actionLocal(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config, cwd: []const u8, document: []const u8) ![]u8 {
    const resolved = try agent_projects.resolveAllowedPath(allocator, io, configuration.environment, cwd);
    defer allocator.free(resolved);
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidGitPayload;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidGitPayload;
    const action = stringField(parsed.value.object, "action") orelse return error.GitActionRequired;
    if (std.mem.eql(u8, action, "init")) try runRequired(allocator, io, configuration.environment, resolved, &.{"init"});
    if (std.mem.eql(u8, action, "checkout")) {
        const ref = try safeRef(stringField(parsed.value.object, "ref") orelse return error.GitRefRequired);
        try runRequired(allocator, io, configuration.environment, resolved, &.{ "switch", "--", ref });
    }
    if (std.mem.eql(u8, action, "switch_branch")) {
        const branch = try safeRef(stringField(parsed.value.object, "branch") orelse return error.GitBranchRequired);
        try runRequired(allocator, io, configuration.environment, resolved, &.{ "switch", branch });
    }
    if (std.mem.eql(u8, action, "create_branch")) {
        const branch = try safeRef(stringField(parsed.value.object, "branch") orelse return error.GitBranchRequired);
        try runRequired(allocator, io, configuration.environment, resolved, &.{ "switch", "-c", branch });
    }
    if (std.mem.eql(u8, action, "add_worktree")) {
        const branch = try safeRef(stringField(parsed.value.object, "branch") orelse return error.GitBranchRequired);
        const path = try allowedFuturePath(allocator, io, configuration.environment, stringField(parsed.value.object, "path") orelse return error.GitWorktreePathRequired);
        defer allocator.free(path);
        const full_ref = try std.fmt.allocPrint(allocator, "refs/heads/{s}", .{branch});
        defer allocator.free(full_ref);
        var exists = try git(allocator, io, configuration.environment, resolved, &.{ "show-ref", "--verify", "--quiet", full_ref });
        defer exists.deinit();
        if (exists.ok) try runRequired(allocator, io, configuration.environment, resolved, &.{ "worktree", "add", path, branch }) else try runRequired(allocator, io, configuration.environment, resolved, &.{ "worktree", "add", "-b", branch, path });
    }
    if (std.mem.eql(u8, action, "remove_worktree")) {
        const path = try agent_projects.resolveAllowedPath(allocator, io, configuration.environment, stringField(parsed.value.object, "path") orelse return error.GitWorktreePathRequired);
        defer allocator.free(path);
        try runRequired(allocator, io, configuration.environment, resolved, &.{ "worktree", "remove", "--force", path });
    }
    if (std.mem.eql(u8, action, "commit")) {
        const message = stringField(parsed.value.object, "message") orelse return error.GitCommitMessageRequired;
        if (message.len > 16 * 1024) return error.GitCommitMessageTooLarge;
        var argv: std.ArrayList([]const u8) = .empty;
        defer argv.deinit(allocator);
        try argv.appendSlice(allocator, &.{ "add", "--" });
        const paths = parsed.value.object.get("paths");
        if (paths != null and paths.? == .array and paths.?.array.items.len > 0) {
            for (paths.?.array.items) |value| {
                if (value != .string or value.string.len == 0) return error.InvalidGitPayload;
                try argv.append(allocator, value.string);
            }
        } else try argv.append(allocator, ".");
        try runRequired(allocator, io, configuration.environment, resolved, argv.items);
        try runRequired(allocator, io, configuration.environment, resolved, &.{ "commit", "-m", message });
    }
    if (std.mem.eql(u8, action, "push")) {
        var upstream = try git(allocator, io, configuration.environment, resolved, &.{ "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}" });
        defer upstream.deinit();
        if (upstream.ok) try runRequired(allocator, io, configuration.environment, resolved, &.{"push"}) else {
            var branch = try git(allocator, io, configuration.environment, resolved, &.{ "branch", "--show-current" });
            defer branch.deinit();
            const name = std.mem.trim(u8, branch.stdout, " \t\r\n");
            if (name.len == 0) return error.GitBranchRequired;
            try runRequired(allocator, io, configuration.environment, resolved, &.{ "push", "-u", "origin", name });
        }
    }
    const known = std.mem.eql(u8, action, "init") or std.mem.eql(u8, action, "checkout") or std.mem.eql(u8, action, "switch_branch") or std.mem.eql(u8, action, "create_branch") or std.mem.eql(u8, action, "add_worktree") or std.mem.eql(u8, action, "remove_worktree") or std.mem.eql(u8, action, "commit") or std.mem.eql(u8, action, "push");
    if (!known) return error.InvalidGitAction;
    return stateLocal(allocator, io, configuration, resolved);
}

pub fn branchesLocal(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config, cwd: []const u8) ![]u8 {
    const resolved = try agent_projects.resolveAllowedPath(allocator, io, configuration.environment, cwd);
    defer allocator.free(resolved);
    var current_result = try git(allocator, io, configuration.environment, resolved, &.{ "branch", "--show-current" });
    defer current_result.deinit();
    var local = try git(allocator, io, configuration.environment, resolved, &.{ "for-each-ref", "--format=%(refname:short)", "refs/heads" });
    defer local.deinit();
    var remote = try git(allocator, io, configuration.environment, resolved, &.{ "for-each-ref", "--format=%(refname:short)", "refs/remotes" });
    defer remote.deinit();
    const current = std.mem.trim(u8, current_result.stdout, " \t\r\n");
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"branches\":[");
    var count: usize = 0;
    try writeBranches(&output.writer, local.stdout, current, false, &count);
    try writeBranches(&output.writer, remote.stdout, current, true, &count);
    try output.writer.writeAll("]}");
    return output.toOwnedSlice();
}

pub fn worktreesLocal(allocator: std.mem.Allocator, io: Io, configuration: *const config.Config, cwd: []const u8) ![]u8 {
    const resolved = try agent_projects.resolveAllowedPath(allocator, io, configuration.environment, cwd);
    defer allocator.free(resolved);
    var result = try git(allocator, io, configuration.environment, resolved, &.{ "worktree", "list", "--porcelain" });
    defer result.deinit();
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.writeAll("{\"worktrees\":[");
    var lines = std.mem.splitScalar(u8, result.stdout, '\n');
    var path: ?[]const u8 = null;
    var branch: ?[]const u8 = null;
    var count: usize = 0;
    while (lines.next()) |line| {
        if (std.mem.startsWith(u8, line, "worktree ")) {
            if (path) |value| {
                try writeWorktree(&output.writer, value, branch, std.mem.eql(u8, value, resolved), count > 0);
                count += 1;
            }
            path = std.mem.trim(u8, line["worktree ".len..], " \t\r");
            branch = null;
        } else if (std.mem.startsWith(u8, line, "branch ")) {
            const value = std.mem.trim(u8, line["branch ".len..], " \t\r");
            branch = if (std.mem.startsWith(u8, value, "refs/heads/")) value["refs/heads/".len..] else value;
        }
    }
    if (path) |value| try writeWorktree(&output.writer, value, branch, std.mem.eql(u8, value, resolved), count > 0);
    try output.writer.writeAll("]}");
    return output.toOwnedSlice();
}

fn git(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, cwd: []const u8, args: []const []const u8) !Command {
    var argv: std.ArrayList([]const u8) = .empty;
    defer argv.deinit(allocator);
    try argv.appendSlice(allocator, &.{ "git", "-c", git_policy.hooks_disabled });
    try argv.appendSlice(allocator, args);
    var clean_environment = try environment.clone(allocator);
    defer clean_environment.deinit();
    for ([_][]const u8{ "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX" }) |name| _ = clean_environment.swapRemove(name);
    const result = try std.process.run(allocator, io, .{
        .argv = argv.items,
        .cwd = .{ .path = cwd },
        .environ_map = &clean_environment,
        .stdout_limit = .limited(max_output_bytes),
        .stderr_limit = .limited(max_output_bytes),
        .timeout = .{ .duration = .{ .clock = .awake, .raw = .fromSeconds(60) } },
    });
    return .{ .allocator = allocator, .ok = switch (result.term) {
        .exited => |code| code == 0,
        else => false,
    }, .stdout = result.stdout, .stderr = result.stderr };
}

fn runRequired(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, cwd: []const u8, args: []const []const u8) !void {
    var result = try git(allocator, io, environment, cwd, args);
    defer result.deinit();
    if (!result.ok) return error.GitCommandFailed;
}

fn remoteGet(allocator: std.mem.Allocator, io: Io, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8, base: []const u8, cwd: []const u8) ![]u8 {
    var target = (try harness_nodes.selectCapability(allocator, io, database, "terminal", preferred_node)) orelse return error.GitNodeRequired;
    defer target.deinit();
    const encoded = try encodeQuery(allocator, cwd);
    defer allocator.free(encoded);
    const path = try std.fmt.allocPrint(allocator, "{s}?cwd={s}", .{ base, encoded });
    defer allocator.free(path);
    return node_transport.get(allocator, client, &target, path) catch error.GitNodeUnavailable;
}

fn remoteSend(allocator: std.mem.Allocator, io: Io, client: *http.Client, database: *sqlite.Database, preferred_node: ?[]const u8, base: []const u8, cwd: []const u8, document: []const u8) ![]u8 {
    var target = (try harness_nodes.selectCapability(allocator, io, database, "terminal", preferred_node)) orelse return error.GitNodeRequired;
    defer target.deinit();
    const encoded = try encodeQuery(allocator, cwd);
    defer allocator.free(encoded);
    const path = try std.fmt.allocPrint(allocator, "{s}?cwd={s}", .{ base, encoded });
    defer allocator.free(path);
    return node_transport.send(allocator, client, &target, path, .POST, document) catch error.GitNodeUnavailable;
}

fn writeStatusLines(writer: *Io.Writer, document: []const u8, entries: bool) !void {
    var lines = std.mem.splitScalar(u8, document, '\n');
    var count: usize = 0;
    while (lines.next()) |raw| {
        const line = std.mem.trimEnd(u8, raw, "\r");
        if (line.len == 0) continue;
        if (count > 0) try writer.writeByte(',');
        if (entries) {
            try writer.writeAll("{\"code\":");
            try std.json.Stringify.value(std.mem.trim(u8, line[0..@min(line.len, 2)], " "), .{}, writer);
            try writer.writeAll(",\"path\":");
            try std.json.Stringify.value(if (line.len > 3) line[3..] else "", .{}, writer);
            try writer.writeByte('}');
        } else try std.json.Stringify.value(line, .{}, writer);
        count += 1;
    }
}

fn writeRefs(writer: *Io.Writer, document: []const u8, current: []const u8) !void {
    var lines = std.mem.splitScalar(u8, document, '\n');
    var count: usize = 0;
    while (lines.next()) |raw| {
        const name = std.mem.trim(u8, raw, " \t\r");
        if (name.len == 0 or std.mem.endsWith(u8, name, "/HEAD")) continue;
        if (count > 0) try writer.writeByte(',');
        try writer.writeAll("{\"name\":");
        try std.json.Stringify.value(name, .{}, writer);
        try writer.print(",\"current\":{},\"remote\":{}}}", .{ std.mem.eql(u8, name, current), std.mem.indexOfScalar(u8, name, '/') != null });
        count += 1;
    }
}

fn writeBranches(writer: *Io.Writer, document: []const u8, current: []const u8, remote: bool, count: *usize) !void {
    var lines = std.mem.splitScalar(u8, document, '\n');
    while (lines.next()) |raw| {
        const name = std.mem.trim(u8, raw, " \t\r");
        if (name.len == 0 or std.mem.endsWith(u8, name, "/HEAD")) continue;
        if (count.* > 0) try writer.writeByte(',');
        try writer.writeAll("{\"name\":");
        try std.json.Stringify.value(name, .{}, writer);
        try writer.print(",\"current\":{},\"remote\":{}}}", .{ std.mem.eql(u8, name, current), remote });
        count.* += 1;
    }
}

fn writeWorktree(writer: *Io.Writer, path: []const u8, branch: ?[]const u8, current: bool, comma: bool) !void {
    if (comma) try writer.writeByte(',');
    try writer.writeAll("{\"path\":");
    try std.json.Stringify.value(path, .{}, writer);
    try writer.writeAll(",\"branch\":");
    if (branch) |value| try std.json.Stringify.value(value, .{}, writer) else try writer.writeAll("null");
    try writer.print(",\"current\":{}}}", .{current});
}

fn emptyState(allocator: std.mem.Allocator, is_repo: bool) ![]u8 {
    return std.fmt.allocPrint(allocator, "{{\"isRepo\":{},\"branch\":null,\"status\":[],\"entries\":[],\"diff\":\"\",\"additions\":0,\"deletions\":0,\"refs\":[],\"hasUpstream\":false,\"remoteUrl\":null,\"prUrl\":null}}", .{is_repo});
}

const Counts = struct { additions: usize = 0, deletions: usize = 0 };

fn countNumstat(document: []const u8) Counts {
    var result: Counts = .{};
    var lines = std.mem.splitScalar(u8, document, '\n');
    while (lines.next()) |line| {
        var fields = std.mem.splitScalar(u8, line, '\t');
        result.additions += std.fmt.parseUnsigned(usize, fields.next() orelse "", 10) catch 0;
        result.deletions += std.fmt.parseUnsigned(usize, fields.next() orelse "", 10) catch 0;
    }
    return result;
}

fn pullRequestUrl(allocator: std.mem.Allocator, remote: []const u8, branch: []const u8) !?[]u8 {
    if (remote.len == 0 or branch.len == 0) return null;
    var repository: []const u8 = remote;
    if (std.mem.startsWith(u8, repository, "git@github.com:")) repository = repository["git@github.com:".len..] else if (std.mem.startsWith(u8, repository, "https://github.com/")) repository = repository["https://github.com/".len..] else return null;
    if (std.mem.endsWith(u8, repository, ".git")) repository = repository[0 .. repository.len - 4];
    const encoded = try encodeQuery(allocator, branch);
    defer allocator.free(encoded);
    return try std.fmt.allocPrint(allocator, "https://github.com/{s}/compare/{s}?expand=1", .{ repository, encoded });
}

fn allowedFuturePath(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, raw: []const u8) ![]u8 {
    const trimmed = std.mem.trim(u8, raw, " \t\r\n");
    if (trimmed.len == 0 or !std.fs.path.isAbsolute(trimmed)) return error.GitWorktreePathInvalid;
    const candidate = try std.fs.path.resolve(allocator, &.{trimmed});
    errdefer allocator.free(candidate);
    const configured = environment.get("WORKSPACE_ROOTS") orelse environment.get("HOME") orelse return error.HomeDirectoryUnavailable;
    var roots = std.mem.splitScalar(u8, configured, std.fs.path.delimiter);
    while (roots.next()) |raw_root| {
        const root = std.mem.trim(u8, raw_root, " \t\r\n");
        if (!std.fs.path.isAbsolute(root)) continue;
        const canonical_z = Io.Dir.realPathFileAbsoluteAlloc(io, root, allocator) catch continue;
        defer allocator.free(canonical_z);
        if (within(canonical_z, candidate)) return candidate;
    }
    return error.GitWorktreePathInvalid;
}

fn within(root: []const u8, candidate: []const u8) bool {
    return std.mem.eql(u8, root, candidate) or candidate.len > root.len and std.mem.startsWith(u8, candidate, root) and std.fs.path.isSep(candidate[root.len]);
}

fn safeRef(value: []const u8) ![]const u8 {
    if (value.len == 0 or value.len > 512 or value[0] == '-') return error.InvalidGitRef;
    return value;
}

fn stringField(object: std.json.ObjectMap, name: []const u8) ?[]const u8 {
    const value = object.get(name) orelse return null;
    if (value != .string) return null;
    const trimmed = std.mem.trim(u8, value.string, " \t\r\n");
    return if (trimmed.len == 0) null else trimmed;
}

fn encodeQuery(allocator: std.mem.Allocator, value: []const u8) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    for (value) |character| if (std.ascii.isAlphanumeric(character) or character == '-' or character == '_' or character == '.' or character == '~') try output.writer.writeByte(character) else try output.writer.print("%{X:0>2}", .{character});
    return output.toOwnedSlice();
}
