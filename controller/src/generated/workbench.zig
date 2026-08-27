pub const contract_version: u32 = 1;

pub const ControllerLifecycleMode = enum { embedded, system };

pub const TaskConnectionState = enum { connected, disconnected, archived };

pub const WorkbenchResourceKind = enum { chat, terminal, file, browser, diff, explorer };

pub const WorkbenchCommandKind = enum { ensure_task, select_project, select_task, move_project, move_pinned, pin_project, pin_task, rename_task, archive_task, open_tab, select_tab, move_tab, close_tab, set_sidebar, set_lifecycle_mode, set_remote_cache_limit };

pub const WorkbenchPreferences = struct {
    lifecycleMode: ControllerLifecycleMode,
    remoteCacheLimitMb: u64,
    sidebarWidth: u64,
    sidebarPinnedOpen: bool,
    sidebarSectionOrder: []const []const u8,
};

pub const SidebarProject = struct {
    id: []const u8,
    name: []const u8,
    path: []const u8,
    accountId: ?[]const u8 = null,
    organization: ?[]const u8 = null,
    repository: ?[]const u8 = null,
    repositoryUrl: ?[]const u8 = null,
    defaultBranch: []const u8,
    pinned: bool,
    rank: i64,
};

pub const SidebarTask = struct {
    id: []const u8,
    projectId: ?[]const u8 = null,
    title: []const u8,
    ownerControllerId: []const u8,
    connection: TaskConnectionState,
    pinned: bool,
    rank: i64,
};

pub const WorkbenchTab = struct {
    id: []const u8,
    taskId: []const u8,
    kind: WorkbenchResourceKind,
    title: []const u8,
    resourceId: []const u8,
    rank: i64,
    closable: bool,
};

pub const TaskWorkbench = struct {
    taskId: []const u8,
    revision: u64,
    activeTabId: ?[]const u8 = null,
    tabs: []const WorkbenchTab,
};

pub const WorkbenchProjection = struct {
    revision: u64,
    profileId: []const u8,
    deviceId: []const u8,
    viewId: []const u8,
    selectedProjectId: ?[]const u8 = null,
    selectedTaskId: ?[]const u8 = null,
    preferences: WorkbenchPreferences,
    projects: []const SidebarProject,
    tasks: []const SidebarTask,
    workbench: ?TaskWorkbench = null,
};

pub const WorkbenchCommand = struct {
    commandId: []const u8,
    actorId: []const u8,
    kind: WorkbenchCommandKind,
    projectId: ?[]const u8 = null,
    taskId: ?[]const u8 = null,
    targetId: ?[]const u8 = null,
    tabId: ?[]const u8 = null,
    resourceKind: ?WorkbenchResourceKind = null,
    resourceId: ?[]const u8 = null,
    title: ?[]const u8 = null,
    closable: ?bool = null,
    pinned: ?bool = null,
    sidebarWidth: ?u64 = null,
    sidebarPinnedOpen: ?bool = null,
    sidebarSectionOrder: ?[]const []const u8 = null,
    lifecycleMode: ?ControllerLifecycleMode = null,
    remoteCacheLimitMb: ?u64 = null,
};

pub const WorkbenchEvent = struct {
    revision: u64,
    commandId: []const u8,
    projection: WorkbenchProjection,
};

