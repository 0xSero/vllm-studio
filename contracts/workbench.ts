import { Schema } from "effect";

export const WORKBENCH_CONTRACT_VERSION = 1;

export const ControllerLifecycleModeSchema = Schema.Union([
  Schema.Literal("embedded"),
  Schema.Literal("system"),
]);
export type ControllerLifecycleMode = typeof ControllerLifecycleModeSchema.Type;

export const TaskConnectionStateSchema = Schema.Union([
  Schema.Literal("connected"),
  Schema.Literal("disconnected"),
  Schema.Literal("archived"),
]);
export type TaskConnectionState = typeof TaskConnectionStateSchema.Type;

export const WorkbenchResourceKindSchema = Schema.Union([
  Schema.Literal("chat"),
  Schema.Literal("terminal"),
  Schema.Literal("file"),
  Schema.Literal("browser"),
  Schema.Literal("diff"),
  Schema.Literal("explorer"),
]);
export type WorkbenchResourceKind = typeof WorkbenchResourceKindSchema.Type;

export const WorkbenchCommandKindSchema = Schema.Union([
  Schema.Literal("ensure_task"),
  Schema.Literal("select_project"),
  Schema.Literal("select_task"),
  Schema.Literal("move_project"),
  Schema.Literal("move_pinned"),
  Schema.Literal("pin_project"),
  Schema.Literal("pin_task"),
  Schema.Literal("rename_task"),
  Schema.Literal("archive_task"),
  Schema.Literal("open_tab"),
  Schema.Literal("select_tab"),
  Schema.Literal("move_tab"),
  Schema.Literal("close_tab"),
  Schema.Literal("set_sidebar"),
  Schema.Literal("set_lifecycle_mode"),
  Schema.Literal("set_remote_cache_limit"),
]);
export type WorkbenchCommandKind = typeof WorkbenchCommandKindSchema.Type;

export const WorkbenchPreferencesSchema = Schema.Struct({
  lifecycleMode: ControllerLifecycleModeSchema,
  remoteCacheLimitMb: Schema.Number,
  sidebarWidth: Schema.Number,
  sidebarPinnedOpen: Schema.Boolean,
  sidebarSectionOrder: Schema.Array(Schema.String),
});
export type WorkbenchPreferences = typeof WorkbenchPreferencesSchema.Type;

export const SidebarProjectSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  accountId: Schema.optional(Schema.String),
  organization: Schema.optional(Schema.String),
  repository: Schema.optional(Schema.String),
  repositoryUrl: Schema.optional(Schema.String),
  defaultBranch: Schema.String,
  pinned: Schema.Boolean,
  rank: Schema.Number,
});
export type SidebarProject = typeof SidebarProjectSchema.Type;

export const SidebarTaskSchema = Schema.Struct({
  id: Schema.String,
  projectId: Schema.optional(Schema.String),
  title: Schema.String,
  ownerControllerId: Schema.String,
  connection: TaskConnectionStateSchema,
  pinned: Schema.Boolean,
  rank: Schema.Number,
});
export type SidebarTask = typeof SidebarTaskSchema.Type;

export const WorkbenchTabSchema = Schema.Struct({
  id: Schema.String,
  taskId: Schema.String,
  kind: WorkbenchResourceKindSchema,
  title: Schema.String,
  resourceId: Schema.String,
  rank: Schema.Number,
  closable: Schema.Boolean,
});
export type WorkbenchTab = typeof WorkbenchTabSchema.Type;

export const TaskWorkbenchSchema = Schema.Struct({
  taskId: Schema.String,
  revision: Schema.Number,
  activeTabId: Schema.optional(Schema.String),
  tabs: Schema.Array(WorkbenchTabSchema),
});
export type TaskWorkbench = typeof TaskWorkbenchSchema.Type;

export const WorkbenchProjectionSchema = Schema.Struct({
  revision: Schema.Number,
  profileId: Schema.String,
  deviceId: Schema.String,
  viewId: Schema.String,
  selectedProjectId: Schema.optional(Schema.String),
  selectedTaskId: Schema.optional(Schema.String),
  preferences: WorkbenchPreferencesSchema,
  projects: Schema.Array(SidebarProjectSchema),
  tasks: Schema.Array(SidebarTaskSchema),
  workbench: Schema.optional(TaskWorkbenchSchema),
});
export type WorkbenchProjection = typeof WorkbenchProjectionSchema.Type;

export const WorkbenchCommandSchema = Schema.Struct({
  commandId: Schema.String,
  actorId: Schema.String,
  kind: WorkbenchCommandKindSchema,
  projectId: Schema.optional(Schema.String),
  taskId: Schema.optional(Schema.String),
  targetId: Schema.optional(Schema.String),
  tabId: Schema.optional(Schema.String),
  resourceKind: Schema.optional(WorkbenchResourceKindSchema),
  resourceId: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  closable: Schema.optional(Schema.Boolean),
  pinned: Schema.optional(Schema.Boolean),
  sidebarWidth: Schema.optional(Schema.Number),
  sidebarPinnedOpen: Schema.optional(Schema.Boolean),
  sidebarSectionOrder: Schema.optional(Schema.Array(Schema.String)),
  lifecycleMode: Schema.optional(ControllerLifecycleModeSchema),
  remoteCacheLimitMb: Schema.optional(Schema.Number),
});
export type WorkbenchCommand = typeof WorkbenchCommandSchema.Type;

export const WorkbenchEventSchema = Schema.Struct({
  revision: Schema.Number,
  commandId: Schema.String,
  projection: WorkbenchProjectionSchema,
});
export type WorkbenchEvent = typeof WorkbenchEventSchema.Type;
