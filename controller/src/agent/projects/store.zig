const std = @import("std");
const sqlite = @import("../../storage/sqlite.zig");

pub const Project = struct {
    allocator: std.mem.Allocator,
    id: []u8,
    name: []u8,
    path: []u8,
    account_id: ?[]u8,
    organization: ?[]u8,
    repository: ?[]u8,
    repository_url: ?[]u8,
    default_branch: []u8,
    added_at: []u8,

    pub fn deinit(project: *Project) void {
        project.allocator.free(project.id);
        project.allocator.free(project.name);
        project.allocator.free(project.path);
        if (project.account_id) |value| project.allocator.free(value);
        if (project.organization) |value| project.allocator.free(value);
        if (project.repository) |value| project.allocator.free(value);
        if (project.repository_url) |value| project.allocator.free(value);
        project.allocator.free(project.default_branch);
        project.allocator.free(project.added_at);
        project.* = undefined;
    }
};

pub const List = struct {
    allocator: std.mem.Allocator,
    projects: []Project,

    pub fn deinit(project_list: *List) void {
        for (project_list.projects) |*project| project.deinit();
        project_list.allocator.free(project_list.projects);
        project_list.* = undefined;
    }
};

pub fn initialize(database: *sqlite.Database) !void {
    try database.executeScript(
        \\CREATE TABLE IF NOT EXISTS agent_projects (
        \\  project_id TEXT PRIMARY KEY,
        \\  name TEXT NOT NULL,
        \\  path TEXT NOT NULL UNIQUE,
        \\  added_at TEXT NOT NULL,
        \\  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        \\);
        \\CREATE INDEX IF NOT EXISTS idx_agent_projects_added ON agent_projects(added_at DESC);
    );
    try ensureColumn(database, "account_id", "ALTER TABLE agent_projects ADD COLUMN account_id TEXT");
    try ensureColumn(database, "organization", "ALTER TABLE agent_projects ADD COLUMN organization TEXT");
    try ensureColumn(database, "repository", "ALTER TABLE agent_projects ADD COLUMN repository TEXT");
    try ensureColumn(database, "repository_url", "ALTER TABLE agent_projects ADD COLUMN repository_url TEXT");
    try ensureColumn(database, "default_branch", "ALTER TABLE agent_projects ADD COLUMN default_branch TEXT NOT NULL DEFAULT 'main'");
    try database.executeScript("CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_projects_repository ON agent_projects(account_id, repository) WHERE account_id IS NOT NULL AND repository IS NOT NULL;");
}

pub fn list(allocator: std.mem.Allocator, database: *sqlite.Database) !List {
    var projects: std.ArrayList(Project) = .empty;
    errdefer {
        for (projects.items) |*project| project.deinit();
        projects.deinit(allocator);
    }
    var statement = try database.prepare("SELECT project_id, name, path, account_id, organization, repository, repository_url, default_branch, added_at FROM agent_projects ORDER BY added_at DESC LIMIT 10000");
    defer statement.deinit();
    while (try statement.step() == .row) try projects.append(allocator, try readProject(allocator, &statement));
    return .{ .allocator = allocator, .projects = try projects.toOwnedSlice(allocator) };
}

pub fn getByPath(allocator: std.mem.Allocator, database: *sqlite.Database, path: []const u8) !?Project {
    var statement = try database.prepare("SELECT project_id, name, path, account_id, organization, repository, repository_url, default_branch, added_at FROM agent_projects WHERE path = ?");
    defer statement.deinit();
    try statement.bindText(1, path);
    if (try statement.step() != .row) return null;
    return try readProject(allocator, &statement);
}

pub fn getById(allocator: std.mem.Allocator, database: *sqlite.Database, id: []const u8) !?Project {
    var statement = try database.prepare("SELECT project_id, name, path, account_id, organization, repository, repository_url, default_branch, added_at FROM agent_projects WHERE project_id = ?");
    defer statement.deinit();
    try statement.bindText(1, id);
    if (try statement.step() != .row) return null;
    return try readProject(allocator, &statement);
}

pub fn getByRepository(allocator: std.mem.Allocator, database: *sqlite.Database, account_id: []const u8, name: []const u8) !?Project {
    var statement = try database.prepare("SELECT project_id, name, path, account_id, organization, repository, repository_url, default_branch, added_at FROM agent_projects WHERE account_id = ? AND repository = ?");
    defer statement.deinit();
    try statement.bindText(1, account_id);
    try statement.bindText(2, name);
    if (try statement.step() != .row) return null;
    return try readProject(allocator, &statement);
}

pub fn save(database: *sqlite.Database, id: []const u8, name: []const u8, path: []const u8, added_at: []const u8) !void {
    var statement = try database.prepare("INSERT INTO agent_projects (project_id, name, path, added_at) VALUES (?, ?, ?, ?)");
    defer statement.deinit();
    try statement.bindText(1, id);
    try statement.bindText(2, name);
    try statement.bindText(3, path);
    try statement.bindText(4, added_at);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn saveRepository(database: *sqlite.Database, id: []const u8, name: []const u8, path: []const u8, account_id: []const u8, organization: []const u8, repository_name: []const u8, repository_url: []const u8, default_branch: []const u8, added_at: []const u8) !void {
    var statement = try database.prepare("INSERT INTO agent_projects (project_id, name, path, account_id, organization, repository, repository_url, default_branch, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    defer statement.deinit();
    try statement.bindText(1, id);
    try statement.bindText(2, name);
    try statement.bindText(3, path);
    try statement.bindText(4, account_id);
    try statement.bindText(5, organization);
    try statement.bindText(6, repository_name);
    try statement.bindText(7, repository_url);
    try statement.bindText(8, default_branch);
    try statement.bindText(9, added_at);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn linkRepository(database: *sqlite.Database, id: []const u8, account_id: []const u8, organization: []const u8, repository_name: []const u8, repository_url: []const u8, default_branch: []const u8) !void {
    var statement = try database.prepare("UPDATE agent_projects SET account_id = ?, organization = ?, repository = ?, repository_url = ?, default_branch = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ?");
    defer statement.deinit();
    try statement.bindText(1, account_id);
    try statement.bindText(2, organization);
    try statement.bindText(3, repository_name);
    try statement.bindText(4, repository_url);
    try statement.bindText(5, default_branch);
    try statement.bindText(6, id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn delete(database: *sqlite.Database, id: []const u8) !void {
    var statement = try database.prepare("DELETE FROM agent_projects WHERE project_id = ?");
    defer statement.deinit();
    try statement.bindText(1, id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn hasOpenTasks(database: *sqlite.Database, id: []const u8) !bool {
    var statement = try database.prepare(
        "SELECT 1 FROM agent_sessions WHERE project_id = ? AND status != 'archived' LIMIT 1",
    );
    defer statement.deinit();
    try statement.bindText(1, id);
    return try statement.step() == .row;
}

fn readProject(allocator: std.mem.Allocator, statement: *sqlite.Statement) !Project {
    const id = try allocator.dupe(u8, statement.columnText(0) orelse return error.InvalidProjectRecord);
    errdefer allocator.free(id);
    const name = try allocator.dupe(u8, statement.columnText(1) orelse return error.InvalidProjectRecord);
    errdefer allocator.free(name);
    const path = try allocator.dupe(u8, statement.columnText(2) orelse return error.InvalidProjectRecord);
    errdefer allocator.free(path);
    const account_id = if (statement.columnText(3)) |value| try allocator.dupe(u8, value) else null;
    errdefer if (account_id) |value| allocator.free(value);
    const organization = if (statement.columnText(4)) |value| try allocator.dupe(u8, value) else null;
    errdefer if (organization) |value| allocator.free(value);
    const repository_name = if (statement.columnText(5)) |value| try allocator.dupe(u8, value) else null;
    errdefer if (repository_name) |value| allocator.free(value);
    const repository_url = if (statement.columnText(6)) |value| try allocator.dupe(u8, value) else null;
    errdefer if (repository_url) |value| allocator.free(value);
    const default_branch = try allocator.dupe(u8, statement.columnText(7) orelse "main");
    errdefer allocator.free(default_branch);
    return .{
        .allocator = allocator,
        .id = id,
        .name = name,
        .path = path,
        .account_id = account_id,
        .organization = organization,
        .repository = repository_name,
        .repository_url = repository_url,
        .default_branch = default_branch,
        .added_at = try allocator.dupe(u8, statement.columnText(8) orelse return error.InvalidProjectRecord),
    };
}

fn ensureColumn(database: *sqlite.Database, column: []const u8, sql: []const u8) !void {
    var statement = try database.prepare("SELECT 1 FROM pragma_table_info('agent_projects') WHERE name = ? LIMIT 1");
    defer statement.deinit();
    try statement.bindText(1, column);
    if (try statement.step() != .row) try database.execute(sql);
}
