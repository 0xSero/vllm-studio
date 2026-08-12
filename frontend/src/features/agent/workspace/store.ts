import { createStore } from "zustand/vanilla";
import { clampLayoutToLimits, collectLeaves, removeLeaf } from "@/features/agent/workspace/layout";
import { cleanSessionTitle, makeFreshTab } from "@/features/agent/messages/helpers";
import type { Session, SessionId } from "@/features/agent/runtime/types";
import type { ToolSelection } from "@/features/agent/tools/types";
import type { ComposerSkillRef } from "@/features/agent/composer-context";
import { isAgentThinkingLevel } from "@shared/agent/agent-turn";
import type {
  PaneId,
  PaneState,
  WorkspaceLayout,
  WorkspaceState,
} from "@/features/agent/workspace/types";

export const PANE_LAYOUT_KEY = "local-studio.agent.paneLayout";
export const PANE_STATE_KEY = "local-studio.agent.paneState";
export const SESSION_PREFS_KEY = "local-studio.agent.sessionPrefs";

export type WorkspaceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type PersistedPaneRecord = {
  tabs?: unknown[];
  activeTabId?: unknown;
  runtimeSessionId?: unknown;
  kind?: unknown;
};

type PersistedPaneState = {
  version: 1;
  layout: WorkspaceLayout;
  focusedPaneId: PaneId;
  panes: Record<string, PersistedPaneRecord>;
  sessions?: unknown[];
};

export type PersistedPaneEntry = { activeTabId: string; tabs: PersistedSessionMeta[] };

export function createInitialState(): WorkspaceState {
  const session = makeFreshTab();
  return {
    sessions: new Map([[session.id, session]]),
    models: [],
    selectedModel: "",
    modelsLoading: true,
    layout: { kind: "leaf", paneId: "p-init" },
    panesById: new Map([["p-init", { sessionId: session.id }]]),
    focusedPaneId: "p-init",
    setupWarning: "",
    error: "",
    hydrated: false,
    lastHandledNavKey: "",
    lastHandledNavIntent: "",
  };
}

export const workspaceStore = createStore<WorkspaceState>(() => createInitialState());
export const ephemeralWorkspaceStore = createStore<WorkspaceState>(() => createInitialState());

export function setupWarningFromPiCheck(
  piCheck: { ok: boolean; guidance?: string } | undefined,
  hasUsableModels: boolean,
): string {
  if (hasUsableModels || !piCheck || piCheck.ok) return "";
  return piCheck.guidance ?? "Pi is not installed.";
}

type PersistedTabShape = Partial<Session> & {
  skills?: ComposerSkillRef[];
  runtimeSessionId?: unknown;
  lastEventSeq?: unknown;
};

type PersistedToolSelectionFields = {
  skills?: ToolSelection["skills"];
  promptTemplates?: ToolSelection["promptTemplates"];
};

function toolSelectionFromPersistedTab(tab: unknown): ToolSelection | null {
  const fields = tab && typeof tab === "object" ? (tab as PersistedToolSelectionFields) : {};
  const skills = Array.isArray(fields.skills) ? fields.skills : [];
  const promptTemplates = Array.isArray(fields.promptTemplates) ? fields.promptTemplates : [];
  return skills.length || promptTemplates.length ? { skills, promptTemplates } : null;
}

function persistedTabFieldsFromSelection(selection: ToolSelection): PersistedToolSelectionFields {
  return {
    ...(selection.skills.length ? { skills: selection.skills } : {}),
    ...(selection.promptTemplates.length ? { promptTemplates: selection.promptTemplates } : {}),
  };
}

export type PersistedSessionMeta = Omit<
  Session,
  "messages" | "error" | "status" | "activeAssistantId"
> &
  PersistedToolSelectionFields;

export function normalizePersistedTab(value: unknown): Session | null {
  if (!value || typeof value !== "object") return null;
  const tab = value as PersistedTabShape;
  if (typeof tab.id !== "string") return null;
  const fallback = makeFreshTab();
  const { runtimeSessionId: _legacyRuntimeKey, lastEventSeq: _legacyEventSeq, ...persisted } = tab;
  return {
    ...fallback,
    ...persisted,
    id: tab.id,
    piSessionId: typeof tab.piSessionId === "string" ? tab.piSessionId : null,
    title: cleanSessionTitle(tab.title) || fallback.title,
    messages: [],
    status: "idle",
    error: "",
    startedAt: typeof tab.startedAt === "string" ? tab.startedAt : undefined,
    thinkingLevel: isAgentThinkingLevel(tab.thinkingLevel) ? tab.thinkingLevel : undefined,
    input: typeof tab.input === "string" ? tab.input : "",
    queue: Array.isArray(tab.queue) ? tab.queue : undefined,
    activeAssistantId: undefined,
    usedSkills: Array.isArray(tab.usedSkills) ? (tab.usedSkills as ComposerSkillRef[]) : undefined,
  };
}

export type RestoredPaneState = {
  layout: WorkspaceLayout;
  panesById: Map<PaneId, PaneState>;
  sessions: Map<SessionId, Session>;
  selections: Map<SessionId, ToolSelection>;
  focusedPaneId: PaneId;
};

function parsePersistedPaneState(raw: string): Partial<PersistedPaneState> | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedPaneState>;
    return parsed.layout && typeof parsed.layout === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function restoreTabsWithSelections(rawTabs: unknown[]): {
  tabs: Session[];
  selections: Map<SessionId, ToolSelection>;
} {
  const tabs: Session[] = [];
  const selections = new Map<SessionId, ToolSelection>();
  for (const raw of rawTabs) {
    const session = normalizePersistedTab(raw);
    if (!session) continue;
    tabs.push(session);
    const selection = toolSelectionFromPersistedTab(raw);
    if (selection) selections.set(session.id, selection);
  }
  return { tabs, selections };
}

function activePersistedTabId(
  pane: PersistedPaneState["panes"][string],
  tabs: Session[],
): SessionId {
  const activeTabId = pane.activeTabId;
  if (typeof activeTabId === "string" && tabs.some((tab) => tab.id === activeTabId)) {
    return activeTabId;
  }
  return tabs[0].id;
}

function focusedPersistedPaneId(focusedPaneId: unknown, leaves: PaneId[]): PaneId {
  return typeof focusedPaneId === "string" && leaves.includes(focusedPaneId)
    ? focusedPaneId
    : leaves[0];
}

function removeLegacyTerminalPanes(
  layout: WorkspaceLayout,
  panes: Record<string, PersistedPaneRecord>,
): WorkspaceLayout | null {
  let next: WorkspaceLayout | null = layout;
  for (const paneId of collectLeaves(layout)) {
    if (panes[paneId]?.kind !== "terminal" || !next) continue;
    next = removeLeaf(next, paneId);
  }
  return next;
}

export function restorePersistedPaneState(raw: string): RestoredPaneState | null {
  const parsed = parsePersistedPaneState(raw);
  if (!parsed) return null;

  const persistedPanes = parsed.panes && typeof parsed.panes === "object" ? parsed.panes : {};
  const chatLayout = removeLegacyTerminalPanes(parsed.layout as WorkspaceLayout, persistedPanes);
  if (!chatLayout) return null;
  const layout = clampLayoutToLimits(chatLayout, () => false);
  const leaves = collectLeaves(layout);
  if (leaves.length === 0) return null;

  const stored = restoreTabsWithSelections(Array.isArray(parsed.sessions) ? parsed.sessions : []);
  const panesById = new Map<PaneId, PaneState>();
  const sessions = new Map<SessionId, Session>(stored.tabs.map((session) => [session.id, session]));
  const selections = new Map<SessionId, ToolSelection>(stored.selections);

  for (const paneId of leaves) {
    const pane = persistedPanes[paneId] ?? {};
    const rawTabs = Array.isArray(pane.tabs) ? pane.tabs : [];
    const restored = restoreTabsWithSelections(rawTabs);
    const tabs = restored.tabs.length > 0 ? restored.tabs : [makeFreshTab()];
    const activeSessionId = activePersistedTabId(pane, tabs);
    const session = tabs.find((tab) => tab.id === activeSessionId) ?? tabs[0];
    for (const tab of tabs) sessions.set(tab.id, tab);
    for (const entry of restored.selections) selections.set(...entry);
    panesById.set(paneId, { sessionId: session.id });
  }

  return {
    layout,
    panesById,
    sessions,
    selections,
    focusedPaneId: focusedPersistedPaneId(parsed.focusedPaneId, leaves),
  };
}

export function sessionMetaForPersistence(
  tab: Session,
  selection?: ToolSelection,
): PersistedSessionMeta {
  const base: PersistedSessionMeta = {
    id: tab.id,
    piSessionId: tab.piSessionId,
    projectId: tab.projectId,
    cwd: tab.cwd,
    modelId: tab.modelId,
    thinkingLevel: tab.thinkingLevel,
    title: cleanSessionTitle(tab.title) || "New session",
    input: tab.input,
    startedAt: tab.startedAt,
    tokenStats: tab.tokenStats,
    usedSkills: tab.usedSkills,
    queue: tab.queue,
  };
  if (selection) {
    return { ...base, ...persistedTabFieldsFromSelection(selection) };
  }
  return base;
}
