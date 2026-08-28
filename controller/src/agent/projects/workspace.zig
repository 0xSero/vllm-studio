const std = @import("std");
const project_store = @import("store.zig");
const git_policy = @import("../git/policy.zig");

const Io = std.Io;
const max_output_bytes = 2 * 1024 * 1024;

const GitCommand = struct {
    allocator: std.mem.Allocator,
    ok: bool,
    stdout: []u8,
    stderr: []u8,

    fn deinit(command: *GitCommand) void {
        command.allocator.free(command.stdout);
        command.allocator.free(command.stderr);
        command.* = undefined;
    }
};

pub fn prepare(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, project: *const project_store.Project, session_id: []const u8, remote: []const u8, base_ref: []const u8, branch: ?[]const u8) ![]u8 {
    const repository = project.repository orelse return error.ProjectRepositoryRequired;
    try validateRef(base_ref);
    const root = try workspaceRoot(allocator, environment);
    defer allocator.free(root);
    const repositories_root = try std.fs.path.join(allocator, &.{ root, "Repositories" });
    defer allocator.free(repositories_root);
    const task_root = try std.fs.path.join(allocator, &.{ root, "Workspaces", repository });
    defer allocator.free(task_root);
    _ = try Io.Dir.cwd().createDirPathStatus(io, repositories_root, @enumFromInt(0o700));
    _ = try Io.Dir.cwd().createDirPathStatus(io, task_root, @enumFromInt(0o700));
    const workspace = try std.fs.path.join(allocator, &.{ task_root, session_id });
    errdefer allocator.free(workspace);
    if (!directoryExists(io, project.path)) {
        try gitRequired(allocator, io, environment, null, &.{ "init", "--bare", project.path }, error.ProjectRepositoryInitializeFailed);
    }
    try removeHooks(allocator, io, project.path);
    try gitRequired(allocator, io, environment, null, &.{ "--git-dir", project.path, "fetch", "--prune", remote, "+refs/heads/*:refs/remotes/code-storage/*" }, error.ProjectFetchFailed);
    const remote_ref = try std.fmt.allocPrint(allocator, "refs/remotes/code-storage/{s}", .{base_ref});
    defer allocator.free(remote_ref);
    if (!try refExists(allocator, io, environment, project.path, remote_ref)) return error.ProjectRefNotFound;
    if (directoryExists(io, workspace)) {
        if (!workspaceMetadataExists(allocator, io, workspace)) return error.ProjectWorkspaceInvalid;
        if (try workspaceMatches(allocator, io, environment, project.path, workspace, remote_ref, branch)) return workspace;
        if (!try workspaceClean(allocator, io, environment, workspace)) return error.ProjectWorkspaceDirty;
        try gitRequired(allocator, io, environment, null, &.{ "--git-dir", project.path, "worktree", "remove", "--force", workspace }, error.ProjectWorktreeRemoveFailed);
    }
    try addWorktree(allocator, io, environment, project.path, workspace, remote_ref, branch);
    return workspace;
}

fn addWorktree(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, git_dir: []const u8, workspace: []const u8, remote_ref: []const u8, branch: ?[]const u8) !void {
    if (branch) |name| {
        try validateRef(name);
        try gitRequired(allocator, io, environment, null, &.{ "--git-dir", git_dir, "worktree", "add", "-b", name, workspace, remote_ref }, error.ProjectWorktreeCreateFailed);
    } else {
        try gitRequired(allocator, io, environment, null, &.{ "--git-dir", git_dir, "worktree", "add", "--detach", workspace, remote_ref }, error.ProjectWorktreeCreateFailed);
    }
}

pub fn archive(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, project: *const project_store.Project, session_id: []const u8) !void {
    const repository = project.repository orelse return;
    const root = try workspaceRoot(allocator, environment);
    defer allocator.free(root);
    const workspace = try std.fs.path.join(allocator, &.{ root, "Workspaces", repository, session_id });
    defer allocator.free(workspace);
    if (!directoryExists(io, workspace)) return;
    try gitRequired(allocator, io, environment, null, &.{ "--git-dir", project.path, "worktree", "remove", "--force", workspace }, error.ProjectWorktreeRemoveFailed);
    try gitRequired(allocator, io, environment, null, &.{ "--git-dir", project.path, "worktree", "prune" }, error.ProjectWorktreePruneFailed);
}

fn workspaceRoot(allocator: std.mem.Allocator, environment: *const std.process.Environ.Map) ![]u8 {
    if (environment.get("LOCAL_STUDIO_WORKSPACE_ROOT")) |root| return allocator.dupe(u8, root);
    const home = environment.get("HOME") orelse return error.HomeDirectoryUnavailable;
    return std.fs.path.join(allocator, &.{ home, "Local Studio" });
}

fn removeHooks(allocator: std.mem.Allocator, io: Io, git_dir: []const u8) !void {
    const hooks = try std.fs.path.join(allocator, &.{ git_dir, "hooks" });
    defer allocator.free(hooks);
    try Io.Dir.cwd().deleteTree(io, hooks);
}

fn git(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, cwd: ?[]const u8, args: []const []const u8) !GitCommand {
    var argv: std.ArrayList([]const u8) = .empty;
    defer argv.deinit(allocator);
    try argv.appendSlice(allocator, &.{ "git", "-c", git_policy.hooks_disabled });
    try argv.appendSlice(allocator, args);
    const result = try std.process.run(allocator, io, .{
        .argv = argv.items,
        .cwd = if (cwd) |path| .{ .path = path } else .inherit,
        .environ_map = environment,
        .stdout_limit = .limited(max_output_bytes),
        .stderr_limit = .limited(max_output_bytes),
        .timeout = .{ .duration = .{ .clock = .awake, .raw = .fromSeconds(600) } },
    });
    const ok = switch (result.term) {
        .exited => |code| code == 0,
        else => false,
    };
    return .{ .allocator = allocator, .ok = ok, .stdout = result.stdout, .stderr = result.stderr };
}

fn gitRequired(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, cwd: ?[]const u8, args: []const []const u8, failure: anyerror) !void {
    var command = try git(allocator, io, environment, cwd, args);
    defer command.deinit();
    if (!command.ok) return failure;
}

fn refExists(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, git_dir: []const u8, ref: []const u8) !bool {
    var command = try git(allocator, io, environment, null, &.{ "--git-dir", git_dir, "show-ref", "--verify", "--quiet", ref });
    defer command.deinit();
    return command.ok;
}

fn workspaceMatches(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, git_dir: []const u8, workspace: []const u8, remote_ref: []const u8, branch: ?[]const u8) !bool {
    var expected = try git(allocator, io, environment, null, &.{ "--git-dir", git_dir, "rev-parse", "--verify", remote_ref });
    defer expected.deinit();
    if (!expected.ok) return error.ProjectWorkspaceInspectFailed;
    var actual = try git(allocator, io, environment, workspace, &.{ "rev-parse", "--verify", "HEAD" });
    defer actual.deinit();
    if (!actual.ok) return error.ProjectWorkspaceInspectFailed;
    if (!std.mem.eql(u8, std.mem.trim(u8, expected.stdout, " \t\r\n"), std.mem.trim(u8, actual.stdout, " \t\r\n"))) return false;
    var current_branch = try git(allocator, io, environment, workspace, &.{ "symbolic-ref", "--quiet", "--short", "HEAD" });
    defer current_branch.deinit();
    if (branch) |name| return current_branch.ok and std.mem.eql(u8, std.mem.trim(u8, current_branch.stdout, " \t\r\n"), name);
    return !current_branch.ok;
}

fn workspaceClean(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, workspace: []const u8) !bool {
    var command = try git(allocator, io, environment, workspace, &.{ "status", "--porcelain" });
    defer command.deinit();
    if (!command.ok) return error.ProjectWorkspaceInspectFailed;
    return std.mem.trim(u8, command.stdout, " \t\r\n").len == 0;
}

fn directoryExists(io: Io, path: []const u8) bool {
    const stat = Io.Dir.cwd().statFile(io, path, .{}) catch return false;
    return stat.kind == .directory;
}

fn workspaceMetadataExists(allocator: std.mem.Allocator, io: Io, workspace: []const u8) bool {
    const metadata = std.fs.path.join(allocator, &.{ workspace, ".git" }) catch return false;
    defer allocator.free(metadata);
    _ = Io.Dir.cwd().statFile(io, metadata, .{}) catch return false;
    return true;
}

fn validateRef(value: []const u8) !void {
    if (value.len == 0 or value.len > 255 or std.mem.startsWith(u8, value, "-") or std.mem.indexOf(u8, value, "..") != null) return error.InvalidGitRef;
    for (value) |character| if (std.ascii.isWhitespace(character) or character == '~' or character == '^' or character == ':' or character == '?' or character == '*' or character == '[' or character == '\\') return error.InvalidGitRef;
}
