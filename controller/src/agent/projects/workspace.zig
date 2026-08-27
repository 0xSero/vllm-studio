const std = @import("std");
const project_store = @import("store.zig");

const Io = std.Io;
const max_output_bytes = 2 * 1024 * 1024;

pub fn prepare(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, project: *const project_store.Project, session_id: []const u8, remote: []const u8, base_ref: []const u8, branch: ?[]const u8) ![]u8 {
    const repository = project.repository orelse return error.ProjectRepositoryRequired;
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
    if (directoryExists(io, workspace)) return workspace;
    if (!directoryExists(io, project.path)) {
        try git(allocator, io, environment, null, &.{ "init", "--bare", project.path });
    }
    try git(allocator, io, environment, null, &.{ "--git-dir", project.path, "fetch", "--prune", remote, "+refs/heads/*:refs/remotes/code-storage/*" });
    const remote_ref = try std.fmt.allocPrint(allocator, "refs/remotes/code-storage/{s}", .{base_ref});
    defer allocator.free(remote_ref);
    addWorktree(allocator, io, environment, project.path, workspace, remote_ref, branch) catch |failure| {
        if (failure != error.ProjectGitFailed or !std.mem.eql(u8, base_ref, "main")) return failure;
        try initializeMain(allocator, io, environment, project.path, workspace, remote);
        if (branch == null) {
            try git(allocator, io, environment, null, &.{ "--git-dir", project.path, "worktree", "remove", "--force", workspace });
            try git(allocator, io, environment, null, &.{ "--git-dir", project.path, "fetch", remote, "+refs/heads/*:refs/remotes/code-storage/*" });
            try addWorktree(allocator, io, environment, project.path, workspace, remote_ref, null);
        } else if (!std.mem.eql(u8, branch.?, "main")) {
            try git(allocator, io, environment, null, &.{ "--git-dir", project.path, "worktree", "remove", "--force", workspace });
            try git(allocator, io, environment, null, &.{ "--git-dir", project.path, "fetch", remote, "+refs/heads/*:refs/remotes/code-storage/*" });
            try addWorktree(allocator, io, environment, project.path, workspace, remote_ref, branch);
        }
    };
    try installDetachedCommitGuard(allocator, io, project.path);
    return workspace;
}

fn addWorktree(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, git_dir: []const u8, workspace: []const u8, remote_ref: []const u8, branch: ?[]const u8) !void {
    if (branch) |name| {
        try validateRef(name);
        try git(allocator, io, environment, null, &.{ "--git-dir", git_dir, "worktree", "add", "-b", name, workspace, remote_ref });
    } else {
        try git(allocator, io, environment, null, &.{ "--git-dir", git_dir, "worktree", "add", "--detach", workspace, remote_ref });
    }
}

fn initializeMain(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, git_dir: []const u8, workspace: []const u8, remote: []const u8) !void {
    try git(allocator, io, environment, null, &.{ "--git-dir", git_dir, "worktree", "add", "--orphan", "-b", "main", workspace });
    try git(allocator, io, environment, workspace, &.{ "-c", "user.name=Local Studio", "-c", "user.email=local-studio@localhost", "commit", "--allow-empty", "-m", "Initial commit" });
    try git(allocator, io, environment, workspace, &.{ "push", remote, "main:refs/heads/main" });
}

pub fn archive(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, project: *const project_store.Project, session_id: []const u8) !void {
    const repository = project.repository orelse return;
    const root = try workspaceRoot(allocator, environment);
    defer allocator.free(root);
    const workspace = try std.fs.path.join(allocator, &.{ root, "Workspaces", repository, session_id });
    defer allocator.free(workspace);
    if (!directoryExists(io, workspace)) return;
    try git(allocator, io, environment, null, &.{ "--git-dir", project.path, "worktree", "remove", "--force", workspace });
    try git(allocator, io, environment, null, &.{ "--git-dir", project.path, "worktree", "prune" });
}

fn workspaceRoot(allocator: std.mem.Allocator, environment: *const std.process.Environ.Map) ![]u8 {
    if (environment.get("LOCAL_STUDIO_WORKSPACE_ROOT")) |root| return allocator.dupe(u8, root);
    const home = environment.get("HOME") orelse return error.HomeDirectoryUnavailable;
    return std.fs.path.join(allocator, &.{ home, "Local Studio" });
}

fn installDetachedCommitGuard(allocator: std.mem.Allocator, io: Io, git_dir: []const u8) !void {
    const hooks = try std.fs.path.join(allocator, &.{ git_dir, "hooks" });
    defer allocator.free(hooks);
    _ = try Io.Dir.cwd().createDirPathStatus(io, hooks, @enumFromInt(0o700));
    const hook = try std.fs.path.join(allocator, &.{ hooks, "pre-commit" });
    defer allocator.free(hook);
    var file = try Io.Dir.cwd().createFile(io, hook, .{ .permissions = @enumFromInt(0o700) });
    defer file.close(io);
    try file.writeStreamingAll(io, "#!/bin/sh\ngit symbolic-ref -q HEAD >/dev/null || { echo 'Create a branch before committing.' >&2; exit 1; }\n");
}

fn git(allocator: std.mem.Allocator, io: Io, environment: *const std.process.Environ.Map, cwd: ?[]const u8, args: []const []const u8) !void {
    var argv: std.ArrayList([]const u8) = .empty;
    defer argv.deinit(allocator);
    try argv.append(allocator, "git");
    try argv.appendSlice(allocator, args);
    const result = try std.process.run(allocator, io, .{
        .argv = argv.items,
        .cwd = if (cwd) |path| .{ .path = path } else .inherit,
        .environ_map = environment,
        .stdout_limit = .limited(max_output_bytes),
        .stderr_limit = .limited(max_output_bytes),
        .timeout = .{ .duration = .{ .clock = .awake, .raw = .fromSeconds(600) } },
    });
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);
    const ok = switch (result.term) {
        .exited => |code| code == 0,
        else => false,
    };
    if (!ok) return error.ProjectGitFailed;
}

fn directoryExists(io: Io, path: []const u8) bool {
    const stat = Io.Dir.cwd().statFile(io, path, .{}) catch return false;
    return stat.kind == .directory;
}

fn validateRef(value: []const u8) !void {
    if (value.len == 0 or value.len > 255 or std.mem.startsWith(u8, value, "-") or std.mem.indexOf(u8, value, "..") != null) return error.InvalidGitRef;
    for (value) |character| if (std.ascii.isWhitespace(character) or character == '~' or character == '^' or character == ':' or character == '?' or character == '*' or character == '[' or character == '\\') return error.InvalidGitRef;
}
