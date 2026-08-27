const std = @import("std");
const sqlite = @import("../storage/sqlite.zig");

pub const default_profile_id = "default";
pub const default_device_id = "local";
pub const default_view_id = "primary";

pub fn initialize(database: *sqlite.Database) !void {
    try database.executeScript(
        \\CREATE TABLE IF NOT EXISTS workbench_profiles (
        \\  profile_id TEXT PRIMARY KEY,
        \\  revision INTEGER NOT NULL DEFAULT 0,
        \\  lifecycle_mode TEXT NOT NULL DEFAULT 'embedded' CHECK (lifecycle_mode IN ('embedded', 'system')),
        \\  remote_cache_limit_mb INTEGER NOT NULL DEFAULT 512 CHECK (remote_cache_limit_mb BETWEEN 64 AND 8192),
        \\  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        \\);
        \\CREATE TABLE IF NOT EXISTS workbench_devices (
        \\  device_id TEXT PRIMARY KEY,
        \\  profile_id TEXT NOT NULL REFERENCES workbench_profiles(profile_id) ON DELETE CASCADE,
        \\  sidebar_width INTEGER NOT NULL DEFAULT 280 CHECK (sidebar_width BETWEEN 220 AND 480),
        \\  sidebar_pinned_open INTEGER NOT NULL DEFAULT 1 CHECK (sidebar_pinned_open IN (0, 1)),
        \\  sidebar_section_order TEXT NOT NULL DEFAULT '["projects","chats"]',
        \\  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        \\);
        \\CREATE TABLE IF NOT EXISTS workbench_views (
        \\  view_id TEXT PRIMARY KEY,
        \\  device_id TEXT NOT NULL REFERENCES workbench_devices(device_id) ON DELETE CASCADE,
        \\  selected_project_id TEXT,
        \\  selected_task_id TEXT,
        \\  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        \\);
        \\CREATE TABLE IF NOT EXISTS workbench_project_ranks (
        \\  profile_id TEXT NOT NULL REFERENCES workbench_profiles(profile_id) ON DELETE CASCADE,
        \\  project_id TEXT NOT NULL,
        \\  rank INTEGER NOT NULL,
        \\  PRIMARY KEY(profile_id, project_id)
        \\);
        \\CREATE TABLE IF NOT EXISTS workbench_project_pins (
        \\  profile_id TEXT NOT NULL REFERENCES workbench_profiles(profile_id) ON DELETE CASCADE,
        \\  project_id TEXT NOT NULL,
        \\  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
        \\  PRIMARY KEY(profile_id, project_id)
        \\);
        \\CREATE TABLE IF NOT EXISTS workbench_tasks (
        \\  task_id TEXT PRIMARY KEY,
        \\  project_id TEXT,
        \\  title TEXT NOT NULL,
        \\  owner_controller_id TEXT NOT NULL,
        \\  connection_state TEXT NOT NULL DEFAULT 'connected' CHECK (connection_state IN ('connected', 'disconnected', 'archived')),
        \\  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
        \\  rank INTEGER NOT NULL,
        \\  revision INTEGER NOT NULL DEFAULT 0,
        \\  active_tab_id TEXT,
        \\  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        \\);
        \\CREATE TABLE IF NOT EXISTS workbench_view_tasks (
        \\  view_id TEXT NOT NULL REFERENCES workbench_views(view_id) ON DELETE CASCADE,
        \\  task_id TEXT NOT NULL REFERENCES workbench_tasks(task_id) ON DELETE CASCADE,
        \\  active_tab_id TEXT,
        \\  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \\  PRIMARY KEY(view_id, task_id)
        \\);
        \\CREATE TABLE IF NOT EXISTS workbench_tabs (
        \\  tab_id TEXT PRIMARY KEY,
        \\  task_id TEXT NOT NULL REFERENCES workbench_tasks(task_id) ON DELETE CASCADE,
        \\  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('chat', 'terminal', 'file', 'browser', 'diff', 'explorer')),
        \\  title TEXT NOT NULL,
        \\  resource_id TEXT NOT NULL,
        \\  rank INTEGER NOT NULL,
        \\  closable INTEGER NOT NULL DEFAULT 1 CHECK (closable IN (0, 1)),
        \\  UNIQUE(task_id, resource_kind, resource_id)
        \\);
        \\CREATE INDEX IF NOT EXISTS idx_workbench_tabs_task_rank ON workbench_tabs(task_id, rank);
        \\CREATE TABLE IF NOT EXISTS workbench_commands (
        \\  command_id TEXT PRIMARY KEY,
        \\  actor_id TEXT NOT NULL,
        \\  kind TEXT NOT NULL,
        \\  document TEXT NOT NULL,
        \\  revision INTEGER NOT NULL,
        \\  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        \\);
        \\CREATE TRIGGER IF NOT EXISTS workbench_task_owner_immutable
        \\BEFORE UPDATE OF owner_controller_id ON workbench_tasks
        \\WHEN OLD.owner_controller_id != NEW.owner_controller_id
        \\BEGIN
        \\  SELECT RAISE(ABORT, 'workbench task ownership is immutable');
        \\END;
        \\INSERT OR IGNORE INTO workbench_profiles (profile_id) VALUES ('default');
        \\INSERT OR IGNORE INTO workbench_devices (device_id, profile_id) VALUES ('local', 'default');
        \\INSERT OR IGNORE INTO workbench_views (view_id, device_id) VALUES ('primary', 'local');
        \\UPDATE workbench_views SET selected_project_id = 'chats' WHERE view_id = 'primary' AND selected_project_id IS NULL;
    );
    try ensureColumn(database, "workbench_tasks", "title", "ALTER TABLE workbench_tasks ADD COLUMN title TEXT NOT NULL DEFAULT ''");
    try ensureColumn(database, "workbench_tasks", "project_id", "ALTER TABLE workbench_tasks ADD COLUMN project_id TEXT");
    try ensureColumn(database, "workbench_devices", "sidebar_section_order", "ALTER TABLE workbench_devices ADD COLUMN sidebar_section_order TEXT NOT NULL DEFAULT '[\"projects\",\"chats\"]'");
    try database.execute("UPDATE workbench_tasks SET title = task_id WHERE title = ''");
    try database.executeScript(
        \\INSERT OR IGNORE INTO workbench_project_ranks (profile_id, project_id, rank)
        \\SELECT 'default', project_id, rowid * 1024 FROM agent_projects;
        \\INSERT OR IGNORE INTO workbench_tasks (task_id, project_id, title, owner_controller_id, connection_state, rank)
        \\SELECT session_id, project_id, session_id, node_id, CASE WHEN status = 'archived' THEN 'archived' ELSE 'connected' END, rowid * 1024
        \\FROM agent_sessions
        \\WHERE project_id IS NULL OR project_id != '__local_studio_thread_title__';
        \\UPDATE workbench_tasks
        \\SET project_id = 'chats'
        \\WHERE task_id IN (SELECT session_id FROM agent_sessions WHERE harness = 'chat')
        \\  AND (project_id IS NULL OR project_id = '');
        \\INSERT OR IGNORE INTO workbench_tabs (tab_id, task_id, resource_kind, title, resource_id, rank, closable)
        \\SELECT 'chat:' || session_id, session_id, 'chat', 'Chat', session_id, 0, 0
        \\FROM agent_sessions
        \\WHERE project_id IS NULL OR project_id != '__local_studio_thread_title__';
        \\UPDATE workbench_tasks
        \\SET project_id = 'chats'
        \\WHERE task_id IN (SELECT session_id FROM agent_sessions WHERE harness = 'chat')
        \\  AND (project_id IS NULL OR project_id = '');
        \\UPDATE workbench_tasks
        \\SET active_tab_id = 'chat:' || task_id
        \\WHERE active_tab_id IS NULL
        \\  AND EXISTS (SELECT 1 FROM workbench_tabs WHERE tab_id = 'chat:' || workbench_tasks.task_id);
        \\INSERT OR IGNORE INTO workbench_view_tasks (view_id, task_id, active_tab_id)
        \\SELECT 'primary', task_id, active_tab_id FROM workbench_tasks;
    );
}

pub fn ensureView(database: *sqlite.Database, view_id: []const u8) !void {
    var statement = try database.prepare("INSERT OR IGNORE INTO workbench_views (view_id, device_id, selected_project_id) VALUES (?, 'local', 'chats')");
    defer statement.deinit();
    try statement.bindText(1, view_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn reconcile(database: *sqlite.Database) !void {
    try database.executeScript(
        \\INSERT OR IGNORE INTO workbench_project_ranks (profile_id, project_id, rank)
        \\SELECT 'default', project_id, rowid * 1024 FROM agent_projects;
        \\INSERT OR IGNORE INTO workbench_tasks (task_id, project_id, title, owner_controller_id, connection_state, rank)
        \\SELECT session_id, project_id, session_id, node_id, CASE WHEN status = 'archived' THEN 'archived' ELSE 'connected' END, rowid * 1024
        \\FROM agent_sessions
        \\WHERE project_id IS NULL OR project_id != '__local_studio_thread_title__';
        \\INSERT OR IGNORE INTO workbench_tabs (tab_id, task_id, resource_kind, title, resource_id, rank, closable)
        \\SELECT 'chat:' || session_id, session_id, 'chat', 'Chat', session_id, 0, 0
        \\FROM agent_sessions
        \\WHERE project_id IS NULL OR project_id != '__local_studio_thread_title__';
        \\UPDATE workbench_tasks
        \\SET active_tab_id = 'chat:' || task_id
        \\WHERE active_tab_id IS NULL
        \\  AND EXISTS (SELECT 1 FROM workbench_tabs WHERE tab_id = 'chat:' || workbench_tasks.task_id);
        \\UPDATE workbench_tasks
        \\SET connection_state = 'archived'
        \\WHERE task_id IN (SELECT session_id FROM agent_sessions WHERE status = 'archived');
        \\UPDATE workbench_views
        \\SET selected_project_id = 'chats', selected_task_id = NULL
        \\WHERE selected_project_id IS NOT NULL
        \\  AND selected_project_id != 'chats'
        \\  AND NOT EXISTS (SELECT 1 FROM agent_projects WHERE project_id = selected_project_id);
        \\UPDATE workbench_views
        \\SET selected_task_id = NULL
        \\WHERE selected_task_id IS NOT NULL
        \\  AND NOT EXISTS (SELECT 1 FROM workbench_tasks WHERE task_id = selected_task_id AND connection_state = 'connected');
        \\DELETE FROM workbench_view_tasks
        \\WHERE active_tab_id IS NOT NULL
        \\  AND NOT EXISTS (SELECT 1 FROM workbench_tabs WHERE tab_id = active_tab_id AND task_id = workbench_view_tasks.task_id);
    );
}

pub fn revision(database: *sqlite.Database) !u64 {
    var statement = try database.prepare("SELECT revision FROM workbench_profiles WHERE profile_id = 'default'");
    defer statement.deinit();
    if (try statement.step() != .row) return error.WorkbenchProfileNotFound;
    return @intCast(@max(statement.columnInt(0), 0));
}

pub fn commandExists(database: *sqlite.Database, command_id: []const u8) !bool {
    var statement = try database.prepare("SELECT 1 FROM workbench_commands WHERE command_id = ?");
    defer statement.deinit();
    try statement.bindText(1, command_id);
    return try statement.step() == .row;
}

pub fn recordCommand(database: *sqlite.Database, command_id: []const u8, actor_id: []const u8, kind: []const u8, document: []const u8, next_revision: u64) !void {
    var statement = try database.prepare("INSERT INTO workbench_commands (command_id, actor_id, kind, document, revision) VALUES (?, ?, ?, ?, ?)");
    defer statement.deinit();
    try statement.bindText(1, command_id);
    try statement.bindText(2, actor_id);
    try statement.bindText(3, kind);
    try statement.bindText(4, document);
    try statement.bindInt(5, @intCast(next_revision));
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

pub fn bumpRevision(database: *sqlite.Database) !u64 {
    try database.execute("UPDATE workbench_profiles SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE profile_id = 'default'");
    return revision(database);
}

fn ensureColumn(database: *sqlite.Database, table: []const u8, name: []const u8, migration: []const u8) !void {
    var buffer: [128]u8 = undefined;
    const query = try std.fmt.bufPrint(&buffer, "PRAGMA table_info({s})", .{table});
    var statement = try database.prepare(query);
    defer statement.deinit();
    while (try statement.step() == .row) {
        if (statement.columnText(1)) |column| if (std.mem.eql(u8, column, name)) return;
    }
    try database.execute(migration);
}
