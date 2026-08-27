const std = @import("std");
const contract = @import("../generated/workbench.zig");
const sqlite = @import("../storage/sqlite.zig");
const change = @import("change.zig");
const store = @import("store.zig");

const Io = std.Io;

pub fn projectionPayload(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, view_id: []const u8) ![]u8 {
    if (!validViewId(view_id)) return error.InvalidWorkbenchViewId;
    try database.lock(io);
    defer database.unlock(io);
    try store.ensureView(database, view_id);
    try store.reconcile(database);
    return projectionLocked(allocator, database, view_id);
}

pub fn commandPayload(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, view_id: []const u8, document: []const u8) ![]u8 {
    if (!validViewId(view_id)) return error.InvalidWorkbenchViewId;
    var parsed = std.json.parseFromSlice(std.json.Value, allocator, document, .{}) catch return error.InvalidWorkbenchCommand;
    defer parsed.deinit();
    if (parsed.value != .object) return error.InvalidWorkbenchCommand;
    const object = parsed.value.object;
    const command_id = requiredString(object, "commandId") orelse return error.WorkbenchCommandIdRequired;
    const actor_id = requiredString(object, "actorId") orelse return error.WorkbenchActorIdRequired;
    const kind = requiredString(object, "kind") orelse return error.WorkbenchCommandKindRequired;
    try database.lock(io);
    defer database.unlock(io);
    try store.ensureView(database, view_id);
    try store.reconcile(database);
    if (!try store.commandExists(database, command_id)) {
        var transaction = try database.begin();
        defer transaction.deinit();
        try applyCommand(database, view_id, kind, object);
        const next_revision = try store.bumpRevision(database);
        try store.recordCommand(database, command_id, actor_id, kind, document, next_revision);
        try transaction.commit();
        change.notify();
    }
    return projectionLocked(allocator, database, view_id);
}

pub fn generation() u64 {
    return change.current();
}

pub fn eventPayload(allocator: std.mem.Allocator, io: Io, database: *sqlite.Database, view_id: []const u8) ![]u8 {
    if (!validViewId(view_id)) return error.InvalidWorkbenchViewId;
    try database.lock(io);
    defer database.unlock(io);
    try store.ensureView(database, view_id);
    try store.reconcile(database);
    const projection = try projectionLocked(allocator, database, view_id);
    defer allocator.free(projection);
    var command = try database.prepare("SELECT command_id FROM workbench_commands ORDER BY revision DESC LIMIT 1");
    defer command.deinit();
    const command_id = if (try command.step() == .row) command.columnText(0) orelse "" else "";
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    try output.writer.print("{{\"revision\":{d},\"commandId\":", .{try store.revision(database)});
    try std.json.Stringify.value(command_id, .{}, &output.writer);
    try output.writer.writeAll(",\"projection\":");
    try output.writer.writeAll(projection);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn projectionLocked(allocator: std.mem.Allocator, database: *sqlite.Database, view_id: []const u8) ![]u8 {
    var output: Io.Writer.Allocating = .init(allocator);
    errdefer output.deinit();
    var profile = try database.prepare(
        \\SELECT profile.revision, profile.lifecycle_mode, profile.remote_cache_limit_mb,
        \\       device.sidebar_width, device.sidebar_pinned_open, device.sidebar_section_order,
        \\       view.selected_project_id, view.selected_task_id
        \\FROM workbench_profiles AS profile
        \\JOIN workbench_devices AS device ON device.profile_id = profile.profile_id AND device.device_id = 'local'
        \\JOIN workbench_views AS view ON view.device_id = device.device_id
        \\WHERE profile.profile_id = 'default'
        \\  AND view.view_id = ?
    );
    defer profile.deinit();
    try profile.bindText(1, view_id);
    if (try profile.step() != .row) return error.WorkbenchProfileNotFound;
    const selected_project_id = profile.columnText(6);
    const selected_task_id = profile.columnText(7);
    try output.writer.print("{{\"revision\":{d},\"profileId\":\"default\",\"deviceId\":\"local\",\"viewId\":", .{@as(u64, @intCast(@max(profile.columnInt(0), 0)))});
    try std.json.Stringify.value(view_id, .{}, &output.writer);
    if (selected_project_id) |value| {
        try output.writer.writeAll(",\"selectedProjectId\":");
        try std.json.Stringify.value(value, .{}, &output.writer);
    }
    if (selected_task_id) |value| {
        try output.writer.writeAll(",\"selectedTaskId\":");
        try std.json.Stringify.value(value, .{}, &output.writer);
    }
    try output.writer.writeAll(",\"preferences\":{\"lifecycleMode\":");
    try std.json.Stringify.value(profile.columnText(1) orelse "embedded", .{}, &output.writer);
    try output.writer.print(",\"remoteCacheLimitMb\":{d},\"sidebarWidth\":{d},\"sidebarPinnedOpen\":{},\"sidebarSectionOrder\":", .{ profile.columnInt(2), profile.columnInt(3), profile.columnInt(4) != 0 });
    try output.writer.writeAll(profile.columnText(5) orelse "[\"projects\",\"chats\"]");
    try output.writer.writeByte('}');
    try writeProjects(&output.writer, database);
    try writeTasks(&output.writer, database);
    if (selected_task_id) |task_id| try writeTaskWorkbench(&output.writer, database, view_id, task_id);
    try output.writer.writeByte('}');
    return output.toOwnedSlice();
}

fn writeProjects(writer: *Io.Writer, database: *sqlite.Database) !void {
    try writer.writeAll(",\"projects\":[{\"id\":\"chats\",\"name\":\"Chats\",\"path\":\"\",\"defaultBranch\":\"main\",\"pinned\":false,\"rank\":0}");
    var statement = try database.prepare(
        \\SELECT project.project_id, project.name, project.path, project.account_id, project.organization,
        \\       project.repository, project.repository_url, project.default_branch,
        \\       COALESCE(pin.pinned, 0), COALESCE(rank.rank, project.rowid * 1024)
        \\FROM agent_projects AS project
        \\LEFT JOIN workbench_project_ranks AS rank ON rank.profile_id = 'default' AND rank.project_id = project.project_id
        \\LEFT JOIN workbench_project_pins AS pin ON pin.profile_id = 'default' AND pin.project_id = project.project_id
        \\ORDER BY COALESCE(rank.rank, project.rowid * 1024), project.project_id
    );
    defer statement.deinit();
    while (try statement.step() == .row) {
        try writer.writeByte(',');
        try writer.writeAll("{\"id\":");
        try std.json.Stringify.value(statement.columnText(0) orelse return error.InvalidWorkbenchProject, .{}, writer);
        try writer.writeAll(",\"name\":");
        try std.json.Stringify.value(statement.columnText(1) orelse return error.InvalidWorkbenchProject, .{}, writer);
        try writer.writeAll(",\"path\":");
        try std.json.Stringify.value(statement.columnText(2) orelse return error.InvalidWorkbenchProject, .{}, writer);
        if (statement.columnText(3)) |value| {
            try writer.writeAll(",\"accountId\":");
            try std.json.Stringify.value(value, .{}, writer);
        }
        if (statement.columnText(4)) |value| {
            try writer.writeAll(",\"organization\":");
            try std.json.Stringify.value(value, .{}, writer);
        }
        if (statement.columnText(5)) |value| {
            try writer.writeAll(",\"repository\":");
            try std.json.Stringify.value(value, .{}, writer);
        }
        if (statement.columnText(6)) |value| {
            try writer.writeAll(",\"repositoryUrl\":");
            try std.json.Stringify.value(value, .{}, writer);
        }
        try writer.writeAll(",\"defaultBranch\":");
        try std.json.Stringify.value(statement.columnText(7) orelse "main", .{}, writer);
        try writer.print(",\"pinned\":{},\"rank\":{d}}}", .{ statement.columnInt(8) != 0, statement.columnInt(9) });
    }
    try writer.writeByte(']');
}

fn writeTasks(writer: *Io.Writer, database: *sqlite.Database) !void {
    try writer.writeAll(",\"tasks\":[");
    var statement = try database.prepare(
        \\SELECT task.task_id, COALESCE(task.project_id, session.project_id), task.title, task.owner_controller_id,
        \\       task.connection_state, task.pinned, task.rank
        \\FROM workbench_tasks AS task
        \\LEFT JOIN agent_sessions AS session ON session.session_id = task.task_id
        \\ORDER BY task.pinned DESC, task.rank DESC, task.task_id
    );
    defer statement.deinit();
    var index: usize = 0;
    while (try statement.step() == .row) : (index += 1) {
        if (index > 0) try writer.writeByte(',');
        try writer.writeAll("{\"id\":");
        try std.json.Stringify.value(statement.columnText(0) orelse return error.InvalidWorkbenchTask, .{}, writer);
        if (statement.columnText(1)) |project_id| {
            try writer.writeAll(",\"projectId\":");
            try std.json.Stringify.value(project_id, .{}, writer);
        }
        try writer.writeAll(",\"title\":");
        try std.json.Stringify.value(statement.columnText(2) orelse "Task", .{}, writer);
        try writer.writeAll(",\"ownerControllerId\":");
        try std.json.Stringify.value(statement.columnText(3) orelse return error.InvalidWorkbenchTask, .{}, writer);
        try writer.writeAll(",\"connection\":");
        try std.json.Stringify.value(statement.columnText(4) orelse return error.InvalidWorkbenchTask, .{}, writer);
        try writer.print(",\"pinned\":{},\"rank\":{d}}}", .{ statement.columnInt(5) != 0, statement.columnInt(6) });
    }
    try writer.writeByte(']');
}

fn writeTaskWorkbench(writer: *Io.Writer, database: *sqlite.Database, view_id: []const u8, task_id: []const u8) !void {
    var task = try database.prepare(
        \\SELECT task.revision, COALESCE(cursor.active_tab_id, task.active_tab_id)
        \\FROM workbench_tasks AS task
        \\LEFT JOIN workbench_view_tasks AS cursor ON cursor.task_id = task.task_id AND cursor.view_id = ?
        \\WHERE task.task_id = ?
    );
    defer task.deinit();
    try task.bindText(1, view_id);
    try task.bindText(2, task_id);
    if (try task.step() != .row) return;
    try writer.writeAll(",\"workbench\":{\"taskId\":");
    try std.json.Stringify.value(task_id, .{}, writer);
    try writer.print(",\"revision\":{d}", .{task.columnInt(0)});
    if (task.columnText(1)) |active_tab_id| {
        try writer.writeAll(",\"activeTabId\":");
        try std.json.Stringify.value(active_tab_id, .{}, writer);
    }
    try writer.writeAll(",\"tabs\":[");
    var tabs = try database.prepare("SELECT tab_id, resource_kind, title, resource_id, rank, closable FROM workbench_tabs WHERE task_id = ? ORDER BY rank, tab_id");
    defer tabs.deinit();
    try tabs.bindText(1, task_id);
    var index: usize = 0;
    while (try tabs.step() == .row) : (index += 1) {
        if (index > 0) try writer.writeByte(',');
        try writer.writeAll("{\"id\":");
        try std.json.Stringify.value(tabs.columnText(0) orelse return error.InvalidWorkbenchTab, .{}, writer);
        try writer.writeAll(",\"taskId\":");
        try std.json.Stringify.value(task_id, .{}, writer);
        try writer.writeAll(",\"kind\":");
        try std.json.Stringify.value(tabs.columnText(1) orelse return error.InvalidWorkbenchTab, .{}, writer);
        try writer.writeAll(",\"title\":");
        try std.json.Stringify.value(tabs.columnText(2) orelse return error.InvalidWorkbenchTab, .{}, writer);
        try writer.writeAll(",\"resourceId\":");
        try std.json.Stringify.value(tabs.columnText(3) orelse return error.InvalidWorkbenchTab, .{}, writer);
        try writer.print(",\"rank\":{d},\"closable\":{}}}", .{ tabs.columnInt(4), tabs.columnInt(5) != 0 });
    }
    try writer.writeAll("]}");
}

fn applyCommand(database: *sqlite.Database, view_id: []const u8, kind: []const u8, object: std.json.ObjectMap) !void {
    if (std.mem.eql(u8, kind, "ensure_task")) return ensureTask(database, view_id, object);
    if (std.mem.eql(u8, kind, "select_project")) return selectProject(database, view_id, optionalString(object, "projectId"));
    if (std.mem.eql(u8, kind, "select_task")) return selectTask(database, view_id, requiredString(object, "taskId") orelse return error.WorkbenchTaskIdRequired);
    if (std.mem.eql(u8, kind, "move_project")) return moveProject(database, requiredString(object, "projectId") orelse return error.WorkbenchProjectIdRequired, optionalString(object, "targetId"));
    if (std.mem.eql(u8, kind, "move_pinned")) return movePinned(database, requiredString(object, "projectId") orelse return error.WorkbenchProjectIdRequired, requiredString(object, "targetId") orelse return error.WorkbenchTargetIdRequired);
    if (std.mem.eql(u8, kind, "pin_project")) return pinProject(database, requiredString(object, "projectId") orelse return error.WorkbenchProjectIdRequired, optionalBool(object, "pinned") orelse return error.WorkbenchPinnedRequired);
    if (std.mem.eql(u8, kind, "pin_task")) return pinTask(database, requiredString(object, "taskId") orelse return error.WorkbenchTaskIdRequired, optionalBool(object, "pinned") orelse return error.WorkbenchPinnedRequired);
    if (std.mem.eql(u8, kind, "rename_task")) return renameTask(database, requiredString(object, "taskId") orelse return error.WorkbenchTaskIdRequired, requiredString(object, "title") orelse return error.WorkbenchTabTitleRequired);
    if (std.mem.eql(u8, kind, "archive_task")) return archiveTask(database, requiredString(object, "taskId") orelse return error.WorkbenchTaskIdRequired);
    if (std.mem.eql(u8, kind, "open_tab")) return openTab(database, view_id, object);
    if (std.mem.eql(u8, kind, "select_tab")) return selectTab(database, view_id, requiredString(object, "taskId") orelse return error.WorkbenchTaskIdRequired, requiredString(object, "tabId") orelse return error.WorkbenchTabIdRequired);
    if (std.mem.eql(u8, kind, "move_tab")) return moveTab(database, requiredString(object, "taskId") orelse return error.WorkbenchTaskIdRequired, requiredString(object, "tabId") orelse return error.WorkbenchTabIdRequired, optionalString(object, "targetId"));
    if (std.mem.eql(u8, kind, "close_tab")) return closeTab(database, requiredString(object, "taskId") orelse return error.WorkbenchTaskIdRequired, requiredString(object, "tabId") orelse return error.WorkbenchTabIdRequired);
    if (std.mem.eql(u8, kind, "set_sidebar")) return setSidebar(database, object);
    if (std.mem.eql(u8, kind, "set_lifecycle_mode")) return setLifecycleMode(database, requiredString(object, "lifecycleMode") orelse return error.WorkbenchLifecycleModeRequired);
    if (std.mem.eql(u8, kind, "set_remote_cache_limit")) return setRemoteCacheLimit(database, optionalUnsigned(object, "remoteCacheLimitMb") orelse return error.WorkbenchCacheLimitRequired);
    return error.UnknownWorkbenchCommand;
}

fn ensureTask(database: *sqlite.Database, view_id: []const u8, object: std.json.ObjectMap) !void {
    const task_id = requiredString(object, "taskId") orelse return error.WorkbenchTaskIdRequired;
    const title = requiredString(object, "title") orelse return error.WorkbenchTabTitleRequired;
    const project_id = optionalString(object, "projectId");
    var task = try database.prepare(
        \\INSERT INTO workbench_tasks (task_id, project_id, title, owner_controller_id, connection_state, rank)
        \\VALUES (?, ?, ?, 'local', 'connected', COALESCE((SELECT MAX(rank) + 1024 FROM workbench_tasks), 0))
        \\ON CONFLICT(task_id) DO UPDATE SET
        \\  project_id = COALESCE(excluded.project_id, workbench_tasks.project_id),
        \\  title = CASE WHEN workbench_tasks.title = workbench_tasks.task_id THEN excluded.title ELSE workbench_tasks.title END
    );
    defer task.deinit();
    try task.bindText(1, task_id);
    if (project_id) |value| try task.bindText(2, value) else try task.bindNull(2);
    try task.bindText(3, title);
    if (try task.step() != .done) return error.DatabaseUnexpectedRow;
    var tab = try database.prepare("INSERT OR IGNORE INTO workbench_tabs (tab_id, task_id, resource_kind, title, resource_id, rank, closable) VALUES ('chat:' || ?, ?, 'chat', 'Chat', ?, 0, 0)");
    defer tab.deinit();
    try tab.bindText(1, task_id);
    try tab.bindText(2, task_id);
    try tab.bindText(3, task_id);
    if (try tab.step() != .done) return error.DatabaseUnexpectedRow;
    var selection = try database.prepare("UPDATE workbench_tasks SET active_tab_id = COALESCE(active_tab_id, 'chat:' || task_id), revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE task_id = ?");
    defer selection.deinit();
    try selection.bindText(1, task_id);
    if (try selection.step() != .done) return error.DatabaseUnexpectedRow;
    try selectTask(database, view_id, task_id);
}

fn selectProject(database: *sqlite.Database, view_id: []const u8, project_id: ?[]const u8) !void {
    var statement = try database.prepare("UPDATE workbench_views SET selected_project_id = ?, selected_task_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE view_id = ?");
    defer statement.deinit();
    if (project_id) |value| try statement.bindText(1, value) else try statement.bindNull(1);
    try statement.bindText(2, view_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

fn selectTask(database: *sqlite.Database, view_id: []const u8, task_id: []const u8) !void {
    var available = try database.prepare("SELECT connection_state FROM workbench_tasks WHERE task_id = ?");
    defer available.deinit();
    try available.bindText(1, task_id);
    if (try available.step() != .row) return error.WorkbenchTaskNotFound;
    if (!std.mem.eql(u8, available.columnText(0) orelse return error.InvalidWorkbenchTask, "connected")) return error.WorkbenchTaskUnavailable;
    var cursor = try database.prepare(
        \\INSERT OR IGNORE INTO workbench_view_tasks (view_id, task_id, active_tab_id)
        \\SELECT ?, task_id, active_tab_id FROM workbench_tasks WHERE task_id = ?
    );
    defer cursor.deinit();
    try cursor.bindText(1, view_id);
    try cursor.bindText(2, task_id);
    if (try cursor.step() != .done) return error.DatabaseUnexpectedRow;
    var statement = try database.prepare(
        \\UPDATE workbench_views
        \\SET selected_task_id = ?,
        \\    selected_project_id = (SELECT COALESCE(project_id, (SELECT project_id FROM agent_sessions WHERE session_id = ?)) FROM workbench_tasks WHERE task_id = ?),
        \\    updated_at = CURRENT_TIMESTAMP
        \\WHERE view_id = ?
    );
    defer statement.deinit();
    try statement.bindText(1, task_id);
    try statement.bindText(2, task_id);
    try statement.bindText(3, task_id);
    try statement.bindText(4, view_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

fn moveProject(database: *sqlite.Database, project_id: []const u8, target_id: ?[]const u8) !void {
    var target = try database.prepare(if (target_id == null) "SELECT COALESCE(MAX(rank), 0) + 1024 FROM workbench_project_ranks WHERE profile_id = 'default'" else "SELECT rank - 1 FROM workbench_project_ranks WHERE profile_id = 'default' AND project_id = ?");
    defer target.deinit();
    if (target_id) |value| try target.bindText(1, value);
    if (try target.step() != .row) return error.WorkbenchProjectNotFound;
    var statement = try database.prepare("UPDATE workbench_project_ranks SET rank = ? WHERE profile_id = 'default' AND project_id = ?");
    defer statement.deinit();
    try statement.bindInt(1, target.columnInt(0));
    try statement.bindText(2, project_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

fn movePinned(database: *sqlite.Database, entry_id: []const u8, target_id: []const u8) !void {
    const project_prefix = "project:";
    const target_project = std.mem.startsWith(u8, target_id, project_prefix);
    const target_key = if (target_project) target_id[project_prefix.len..] else target_id;
    var target = try database.prepare(if (target_project) "SELECT rank - 1 FROM workbench_project_ranks WHERE profile_id = 'default' AND project_id = ?" else "SELECT rank - 1 FROM workbench_tasks WHERE task_id = ?");
    defer target.deinit();
    try target.bindText(1, target_key);
    if (try target.step() != .row) return error.WorkbenchTargetIdRequired;
    const entry_project = std.mem.startsWith(u8, entry_id, project_prefix);
    const entry_key = if (entry_project) entry_id[project_prefix.len..] else entry_id;
    var statement = try database.prepare(if (entry_project) "UPDATE workbench_project_ranks SET rank = ? WHERE profile_id = 'default' AND project_id = ?" else "UPDATE workbench_tasks SET rank = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE task_id = ?");
    defer statement.deinit();
    try statement.bindInt(1, target.columnInt(0));
    try statement.bindText(2, entry_key);
    if (try statement.step() != .done or database.changes() == 0) return error.WorkbenchProjectNotFound;
}

fn pinTask(database: *sqlite.Database, task_id: []const u8, pinned: bool) !void {
    var statement = try database.prepare("UPDATE workbench_tasks SET pinned = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE task_id = ?");
    defer statement.deinit();
    try statement.bindInt(1, if (pinned) 1 else 0);
    try statement.bindText(2, task_id);
    if (try statement.step() != .done or database.changes() == 0) return error.WorkbenchTaskNotFound;
}

fn pinProject(database: *sqlite.Database, project_id: []const u8, pinned: bool) !void {
    var statement = try database.prepare("INSERT INTO workbench_project_pins (profile_id, project_id, pinned) VALUES ('default', ?, ?) ON CONFLICT(profile_id, project_id) DO UPDATE SET pinned = excluded.pinned");
    defer statement.deinit();
    try statement.bindText(1, project_id);
    try statement.bindInt(2, if (pinned) 1 else 0);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

fn renameTask(database: *sqlite.Database, task_id: []const u8, title: []const u8) !void {
    var statement = try database.prepare("UPDATE workbench_tasks SET title = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE task_id = ?");
    defer statement.deinit();
    try statement.bindText(1, title);
    try statement.bindText(2, task_id);
    if (try statement.step() != .done or database.changes() == 0) return error.WorkbenchTaskNotFound;
}

fn archiveTask(database: *sqlite.Database, task_id: []const u8) !void {
    var task = try database.prepare("UPDATE workbench_tasks SET connection_state = 'archived', revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE task_id = ?");
    defer task.deinit();
    try task.bindText(1, task_id);
    if (try task.step() != .done or database.changes() == 0) return error.WorkbenchTaskNotFound;
    var session = try database.prepare("UPDATE agent_sessions SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE session_id = ?");
    defer session.deinit();
    try session.bindText(1, task_id);
    if (try session.step() != .done) return error.DatabaseUnexpectedRow;
}

fn openTab(database: *sqlite.Database, view_id: []const u8, object: std.json.ObjectMap) !void {
    const task_id = requiredString(object, "taskId") orelse return error.WorkbenchTaskIdRequired;
    const tab_id = requiredString(object, "tabId") orelse return error.WorkbenchTabIdRequired;
    const resource_kind = requiredString(object, "resourceKind") orelse return error.WorkbenchResourceKindRequired;
    const resource_id = requiredString(object, "resourceId") orelse return error.WorkbenchResourceIdRequired;
    const title = requiredString(object, "title") orelse return error.WorkbenchTabTitleRequired;
    if (!validResourceKind(resource_kind)) return error.InvalidWorkbenchResourceKind;
    var statement = try database.prepare(
        \\INSERT INTO workbench_tabs (tab_id, task_id, resource_kind, title, resource_id, rank, closable)
        \\VALUES (?, ?, ?, ?, ?, COALESCE((SELECT MAX(rank) + 1024 FROM workbench_tabs WHERE task_id = ?), 0), ?)
        \\ON CONFLICT(task_id, resource_kind, resource_id) DO UPDATE SET title = excluded.title
    );
    defer statement.deinit();
    try statement.bindText(1, tab_id);
    try statement.bindText(2, task_id);
    try statement.bindText(3, resource_kind);
    try statement.bindText(4, title);
    try statement.bindText(5, resource_id);
    try statement.bindText(6, task_id);
    try statement.bindInt(7, if (optionalBool(object, "closable") orelse true) 1 else 0);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
    try selectTab(database, view_id, task_id, tab_id);
}

fn selectTab(database: *sqlite.Database, view_id: []const u8, task_id: []const u8, tab_id: []const u8) !void {
    var statement = try database.prepare(
        \\INSERT INTO workbench_view_tasks (view_id, task_id, active_tab_id, updated_at)
        \\SELECT ?, ?, ?, CURRENT_TIMESTAMP
        \\WHERE EXISTS (SELECT 1 FROM workbench_tabs WHERE tab_id = ? AND task_id = ?)
        \\ON CONFLICT(view_id, task_id) DO UPDATE SET active_tab_id = excluded.active_tab_id, updated_at = CURRENT_TIMESTAMP
    );
    defer statement.deinit();
    try statement.bindText(1, view_id);
    try statement.bindText(2, task_id);
    try statement.bindText(3, tab_id);
    try statement.bindText(4, tab_id);
    try statement.bindText(5, task_id);
    if (try statement.step() != .done or database.changes() == 0) return error.WorkbenchTabNotFound;
    try bumpTask(database, task_id);
}

fn moveTab(database: *sqlite.Database, task_id: []const u8, tab_id: []const u8, target_id: ?[]const u8) !void {
    var target = try database.prepare(if (target_id == null) "SELECT COALESCE(MAX(rank), 0) + 1024 FROM workbench_tabs WHERE task_id = ?" else "SELECT rank - 1 FROM workbench_tabs WHERE task_id = ? AND tab_id = ?");
    defer target.deinit();
    try target.bindText(1, task_id);
    if (target_id) |value| try target.bindText(2, value);
    if (try target.step() != .row) return error.WorkbenchTabNotFound;
    var statement = try database.prepare("UPDATE workbench_tabs SET rank = ? WHERE task_id = ? AND tab_id = ?");
    defer statement.deinit();
    try statement.bindInt(1, target.columnInt(0));
    try statement.bindText(2, task_id);
    try statement.bindText(3, tab_id);
    if (try statement.step() != .done or database.changes() == 0) return error.WorkbenchTabNotFound;
    var normalize = try database.prepare(
        \\WITH ordered AS (
        \\  SELECT tab_id, (ROW_NUMBER() OVER (ORDER BY rank, tab_id) - 1) * 1024 AS next_rank
        \\  FROM workbench_tabs
        \\  WHERE task_id = ?
        \\)
        \\UPDATE workbench_tabs
        \\SET rank = (SELECT next_rank FROM ordered WHERE ordered.tab_id = workbench_tabs.tab_id)
        \\WHERE task_id = ?
    );
    defer normalize.deinit();
    try normalize.bindText(1, task_id);
    try normalize.bindText(2, task_id);
    if (try normalize.step() != .done) return error.DatabaseUnexpectedRow;
    try bumpTask(database, task_id);
}

fn closeTab(database: *sqlite.Database, task_id: []const u8, tab_id: []const u8) !void {
    var neighbor = try database.prepare(
        \\SELECT candidate.tab_id
        \\FROM workbench_tabs AS candidate
        \\JOIN workbench_tabs AS closing ON closing.task_id = candidate.task_id
        \\WHERE closing.task_id = ? AND closing.tab_id = ? AND candidate.tab_id != closing.tab_id
        \\ORDER BY
        \\  CASE WHEN candidate.rank > closing.rank THEN 0 ELSE 1 END,
        \\  CASE WHEN candidate.rank > closing.rank THEN candidate.rank ELSE -candidate.rank END,
        \\  candidate.tab_id
        \\LIMIT 1
    );
    defer neighbor.deinit();
    try neighbor.bindText(1, task_id);
    try neighbor.bindText(2, tab_id);
    const next_tab_id = if (try neighbor.step() == .row) neighbor.columnText(0) else null;
    var statement = try database.prepare("DELETE FROM workbench_tabs WHERE task_id = ? AND tab_id = ? AND closable = 1");
    defer statement.deinit();
    try statement.bindText(1, task_id);
    try statement.bindText(2, tab_id);
    if (try statement.step() != .done or database.changes() == 0) return error.WorkbenchTabNotClosable;
    var cursors = try database.prepare("UPDATE workbench_view_tasks SET active_tab_id = ?, updated_at = CURRENT_TIMESTAMP WHERE task_id = ? AND active_tab_id = ?");
    defer cursors.deinit();
    if (next_tab_id) |value| try cursors.bindText(1, value) else try cursors.bindNull(1);
    try cursors.bindText(2, task_id);
    try cursors.bindText(3, tab_id);
    if (try cursors.step() != .done) return error.DatabaseUnexpectedRow;
    var legacy = try database.prepare("UPDATE workbench_tasks SET active_tab_id = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE task_id = ?");
    defer legacy.deinit();
    if (next_tab_id) |value| try legacy.bindText(1, value) else try legacy.bindNull(1);
    try legacy.bindText(2, task_id);
    if (try legacy.step() != .done) return error.DatabaseUnexpectedRow;
}

fn setSidebar(database: *sqlite.Database, object: std.json.ObjectMap) !void {
    const width = optionalUnsigned(object, "sidebarWidth");
    const pinned_open = optionalBool(object, "sidebarPinnedOpen");
    const order_value = object.get("sidebarSectionOrder");
    if (width == null and pinned_open == null and order_value == null) return error.WorkbenchSidebarValueRequired;
    if (width) |value| if (value < 220 or value > 480) return error.InvalidWorkbenchSidebarWidth;
    const order = if (order_value) |value| try sidebarOrder(value) else null;
    var statement = try database.prepare("UPDATE workbench_devices SET sidebar_width = COALESCE(?, sidebar_width), sidebar_pinned_open = COALESCE(?, sidebar_pinned_open), sidebar_section_order = COALESCE(?, sidebar_section_order), updated_at = CURRENT_TIMESTAMP WHERE device_id = 'local'");
    defer statement.deinit();
    if (width) |value| try statement.bindInt(1, @intCast(value)) else try statement.bindNull(1);
    if (pinned_open) |value| try statement.bindInt(2, if (value) 1 else 0) else try statement.bindNull(2);
    if (order) |value| try statement.bindText(3, value) else try statement.bindNull(3);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

fn sidebarOrder(value: std.json.Value) !?[]const u8 {
    if (value == .null) return null;
    if (value != .array or value.array.items.len != 2) return error.InvalidWorkbenchSidebarOrder;
    const first = value.array.items[0];
    const second = value.array.items[1];
    if (first != .string or second != .string) return error.InvalidWorkbenchSidebarOrder;
    if (std.mem.eql(u8, first.string, "projects") and std.mem.eql(u8, second.string, "chats")) return "[\"projects\",\"chats\"]";
    if (std.mem.eql(u8, first.string, "chats") and std.mem.eql(u8, second.string, "projects")) return "[\"chats\",\"projects\"]";
    return error.InvalidWorkbenchSidebarOrder;
}

fn setLifecycleMode(database: *sqlite.Database, mode: []const u8) !void {
    if (!std.mem.eql(u8, mode, "embedded") and !std.mem.eql(u8, mode, "system")) return error.InvalidWorkbenchLifecycleMode;
    var statement = try database.prepare("UPDATE workbench_profiles SET lifecycle_mode = ?, updated_at = CURRENT_TIMESTAMP WHERE profile_id = 'default'");
    defer statement.deinit();
    try statement.bindText(1, mode);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

fn setRemoteCacheLimit(database: *sqlite.Database, limit: u64) !void {
    if (limit < 64 or limit > 8192) return error.InvalidWorkbenchCacheLimit;
    var statement = try database.prepare("UPDATE workbench_profiles SET remote_cache_limit_mb = ?, updated_at = CURRENT_TIMESTAMP WHERE profile_id = 'default'");
    defer statement.deinit();
    try statement.bindInt(1, @intCast(limit));
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

fn bumpTask(database: *sqlite.Database, task_id: []const u8) !void {
    var statement = try database.prepare("UPDATE workbench_tasks SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE task_id = ?");
    defer statement.deinit();
    try statement.bindText(1, task_id);
    if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
}

fn validResourceKind(value: []const u8) bool {
    _ = contract.contract_version;
    return std.mem.eql(u8, value, "chat") or std.mem.eql(u8, value, "terminal") or std.mem.eql(u8, value, "file") or std.mem.eql(u8, value, "browser") or std.mem.eql(u8, value, "diff") or std.mem.eql(u8, value, "explorer");
}

fn validViewId(value: []const u8) bool {
    if (value.len == 0 or value.len > 128) return false;
    for (value) |byte| if (!std.ascii.isAlphanumeric(byte) and byte != '_' and byte != '-' and byte != '.' and byte != ':') return false;
    return true;
}

fn requiredString(object: std.json.ObjectMap, key: []const u8) ?[]const u8 {
    const value = object.get(key) orelse return null;
    if (value != .string or std.mem.trim(u8, value.string, " \t\r\n").len == 0) return null;
    return value.string;
}

fn optionalString(object: std.json.ObjectMap, key: []const u8) ?[]const u8 {
    const value = object.get(key) orelse return null;
    if (value == .null) return null;
    if (value != .string) return null;
    return value.string;
}

fn optionalBool(object: std.json.ObjectMap, key: []const u8) ?bool {
    const value = object.get(key) orelse return null;
    if (value != .bool) return null;
    return value.bool;
}

fn optionalUnsigned(object: std.json.ObjectMap, key: []const u8) ?u64 {
    const value = object.get(key) orelse return null;
    if (value != .integer or value.integer < 0) return null;
    return @intCast(value.integer);
}
