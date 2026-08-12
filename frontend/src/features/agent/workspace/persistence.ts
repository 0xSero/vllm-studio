import { Schema } from "effect";
import { cleanSessionTitle, makeFreshTab } from "@/features/agent/messages/helpers";
import type { ComposerSkillRef } from "@/features/agent/composer-context";
import type { Session, SessionId, SessionsMap } from "@/features/agent/runtime/types";
import type { ToolSelection } from "@/features/agent/tools/types";
import { clampLayoutToLimits, collectLeaves, removeLeaf } from "@/features/agent/workspace/layout";
import type {
  PaneId,
  PaneState,
  WorkspaceLayout,
  WorkspaceState,
} from "@/features/agent/workspace/types";
import { isAgentThinkingLevel } from "@shared/agent/agent-turn";
import { readStored, removeStored, writeStored } from "@/lib/storage";

const PANE_LAYOUT_KEY = "local-studio.agent.paneLayout";
const PANE_STATE_KEY = "local-studio.agent.paneState";
const LEGACY_DRAFTS_KEY = "local-studio.agent.sessionDrafts.v1";
const CLEANED_KEY = "local-studio.agent.sessionsCollapsedCleaned";
const LegacyDraftsSchema = Schema.Struct({
  version: Schema.Literal(1),
  drafts: Schema.Record(Schema.String, Schema.String),
});
const decodeLegacyDrafts = Schema.decodeUnknownOption(LegacyDraftsSchema);

export type WorkspaceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type PersistedPane = { tabs?: unknown[]; activeTabId?: unknown; kind?: unknown };
type PersistedPaneState = {
  layout?: unknown;
  focusedPaneId?: unknown;
  panes?: Record<string, PersistedPane>;
  sessions?: unknown[];
};
type PersistedTab = Partial<Session> & {
  skills?: ToolSelection["skills"];
  promptTemplates?: ToolSelection["promptTemplates"];
  runtimeSessionId?: unknown;
  lastEventSeq?: unknown;
};
type PersistedSessionMeta = Omit<Session, "messages" | "error" | "status" | "activeAssistantId"> & {
  skills?: ToolSelection["skills"];
  promptTemplates?: ToolSelection["promptTemplates"];
};

export type LoadedFromStorage = {
  workspace: Partial<WorkspaceState>;
  selections: Map<SessionId, ToolSelection>;
};

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
    runtimeActivity: new Map(),
  };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function persistedPaneState(raw: string): PersistedPaneState | null {
  const value = parseJson(raw);
  if (!value || typeof value !== "object") return null;
  const state = value as PersistedPaneState;
  return state.layout && typeof state.layout === "object" ? state : null;
}

function normalizeSession(value: unknown): Session | null {
  if (!value || typeof value !== "object") return null;
  const tab = value as PersistedTab;
  if (typeof tab.id !== "string") return null;
  const fallback = makeFreshTab();
  const { runtimeSessionId: _runtime, lastEventSeq: _seq, ...persisted } = tab;
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

function restoreSessions(values: unknown[]): {
  sessions: Session[];
  selections: Map<SessionId, ToolSelection>;
} {
  const sessions: Session[] = [];
  const selections = new Map<SessionId, ToolSelection>();
  for (const value of values) {
    const session = normalizeSession(value);
    if (!session) continue;
    sessions.push(session);
    const tab = value as PersistedTab;
    const skills = Array.isArray(tab.skills) ? tab.skills : [];
    const promptTemplates = Array.isArray(tab.promptTemplates) ? tab.promptTemplates : [];
    if (skills.length || promptTemplates.length) {
      selections.set(session.id, { skills, promptTemplates });
    }
  }
  return { sessions, selections };
}

function chatLayout(state: PersistedPaneState): WorkspaceLayout | null {
  let layout: WorkspaceLayout | null = state.layout as WorkspaceLayout;
  for (const paneId of collectLeaves(layout)) {
    if (state.panes?.[paneId]?.kind === "terminal" && layout) layout = removeLeaf(layout, paneId);
  }
  return layout ? clampLayoutToLimits(layout, () => false) : null;
}

function restorePaneState(raw: string): LoadedFromStorage | null {
  const state = persistedPaneState(raw);
  if (!state) return null;
  const layout = chatLayout(state);
  if (!layout) return null;
  const leaves = collectLeaves(layout);
  if (!leaves.length) return null;
  const stored = restoreSessions(Array.isArray(state.sessions) ? state.sessions : []);
  const sessions = new Map(stored.sessions.map((session) => [session.id, session]));
  const selections = new Map(stored.selections);
  const panesById = new Map<PaneId, PaneState>();

  for (const paneId of leaves) {
    const pane = state.panes?.[paneId] ?? {};
    const restored = restoreSessions(Array.isArray(pane.tabs) ? pane.tabs : []);
    const paneSessions = restored.sessions.length ? restored.sessions : [makeFreshTab()];
    const activeId =
      typeof pane.activeTabId === "string" &&
      paneSessions.some((session) => session.id === pane.activeTabId)
        ? pane.activeTabId
        : paneSessions[0].id;
    paneSessions.forEach((session) => sessions.set(session.id, session));
    restored.selections.forEach((selection, id) => selections.set(id, selection));
    panesById.set(paneId, { sessionId: activeId });
  }

  return {
    workspace: {
      layout,
      panesById,
      sessions,
      focusedPaneId:
        typeof state.focusedPaneId === "string" && leaves.includes(state.focusedPaneId)
          ? state.focusedPaneId
          : leaves[0],
    },
    selections,
  };
}

function restoreLegacyLayout(raw: string): LoadedFromStorage | null {
  const layout = parseJson(raw) as WorkspaceLayout | null;
  if (!layout || typeof layout !== "object") return null;
  const leaves = collectLeaves(layout);
  if (!leaves.length) return null;
  const sessions = new Map<SessionId, Session>();
  const panesById = new Map<PaneId, PaneState>();
  for (const paneId of leaves) {
    const session = makeFreshTab();
    sessions.set(session.id, session);
    panesById.set(paneId, { sessionId: session.id });
  }
  return {
    workspace: { layout, panesById, sessions, focusedPaneId: leaves[0] },
    selections: new Map(),
  };
}

function restoreDrafts(storage: WorkspaceStorage, sessions: SessionsMap): Map<SessionId, Session> {
  let drafts: Record<string, string> = {};
  const value = parseJson(readStored(LEGACY_DRAFTS_KEY, storage) ?? "null");
  const decoded = decodeLegacyDrafts(value);
  if (decoded._tag === "Some") drafts = decoded.value.drafts;
  const next = new Map(sessions);
  for (const [key, input] of Object.entries(drafts)) {
    if (!input) continue;
    const existing = [...next.values()].find(
      (session) => session.id === key || session.piSessionId === key,
    );
    if (existing) next.set(existing.id, { ...existing, input });
    else {
      const session = makeFreshTab();
      next.set(session.id, { ...session, piSessionId: key, input });
    }
  }
  return next;
}

function cleanLegacyStorage(storage: WorkspaceStorage): void {
  if (!readStored(CLEANED_KEY, storage)) {
    removeStored("local-studio.agent.sessionsCollapsed", storage);
    writeStored(CLEANED_KEY, "1", storage);
  }
  removeStored("local-studio.agent.transcripts.v1", storage);
  removeStored("local-studio.agent.activeSessions.snapshot", storage);
}

export function loadInitialFromStorage(storage: WorkspaceStorage): LoadedFromStorage {
  cleanLegacyStorage(storage);
  const rawState = readStored(PANE_STATE_KEY, storage);
  const rawLayout = readStored(PANE_LAYOUT_KEY, storage);
  const loaded = (rawState && restorePaneState(rawState)) ||
    (rawLayout && restoreLegacyLayout(rawLayout)) || {
      workspace: {},
      selections: new Map<SessionId, ToolSelection>(),
    };
  const fallback = Object.keys(loaded.workspace).length ? loaded.workspace : createInitialState();
  const sessions = restoreDrafts(storage, fallback.sessions ?? new Map());
  return { workspace: { ...fallback, sessions }, selections: loaded.selections };
}

function sessionMeta(session: Session, selection?: ToolSelection): PersistedSessionMeta {
  return {
    id: session.id,
    piSessionId: session.piSessionId,
    projectId: session.projectId,
    cwd: session.cwd,
    modelId: session.modelId,
    thinkingLevel: session.thinkingLevel,
    title: cleanSessionTitle(session.title) || "New session",
    input: session.input,
    startedAt: session.startedAt,
    tokenStats: session.tokenStats,
    usedSkills: session.usedSkills,
    queue: session.queue,
    ...(selection?.skills.length ? { skills: selection.skills } : {}),
    ...(selection?.promptTemplates.length ? { promptTemplates: selection.promptTemplates } : {}),
  };
}

export function paneStateJson(
  state: WorkspaceState,
  selectionFor: (sessionId: SessionId) => ToolSelection | null = () => null,
): string {
  const panes = Object.fromEntries(
    [...state.panesById].map(([paneId, pane]) => {
      const session = state.sessions.get(pane.sessionId);
      return [
        paneId,
        {
          activeTabId: pane.sessionId,
          tabs: session ? [sessionMeta(session, selectionFor(session.id) ?? undefined)] : [],
        },
      ];
    }),
  );
  return JSON.stringify({
    version: 1,
    layout: state.layout,
    focusedPaneId: state.focusedPaneId,
    panes,
    sessions: [...state.sessions.values()].map((session) =>
      sessionMeta(session, selectionFor(session.id) ?? undefined),
    ),
  });
}

export function writePaneState(
  storage: WorkspaceStorage,
  state: WorkspaceState,
  selectionFor?: (sessionId: SessionId) => ToolSelection | null,
): void {
  writeStored(PANE_STATE_KEY, paneStateJson(state, selectionFor), storage);
  removeStored(LEGACY_DRAFTS_KEY, storage);
}
