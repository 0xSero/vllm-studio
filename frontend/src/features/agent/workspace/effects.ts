import type { ActiveAgentSessionSnapshot } from "@/features/agent/active-sessions";
import { cleanSessionTitle } from "@/features/agent/messages/helpers";
import { findPaneByPiSessionId } from "@/features/agent/runtime/selectors";
import type { Project } from "@/features/agent/projects/types";
import type { Session, SessionId } from "@/features/agent/runtime/types";
import type { ToolSelection } from "@/features/agent/tools/types";
import type { ComposerSkillRef } from "@/features/agent/composer-context";
import type {
  AgentModel,
  PaneId,
  WorkspaceAction,
  WorkspaceState,
} from "@/features/agent/workspace/types";
import {
  loadPersistedActiveAgentSessions,
  sessionMetaForPersistence,
  setupWarningFromPiCheck,
  type WorkspaceStorage,
} from "@/features/agent/workspace/store";
import { writeActiveSessions, writePaneState } from "@/features/agent/workspace/persistence";
import {
  ACTIVE_AGENT_SESSIONS_EVENT,
  PROJECTS_LOADED_EVENT,
  SESSIONS_CHANGED_EVENT,
} from "@/lib/workspace-events";

const EMPTY_SELECTION: ToolSelection = {
  plugins: [],
  skills: [],
  promptTemplates: [],
};

type SetupCheck = { id: string; ok: boolean; guidance?: string };

export type WorkspaceApi = {
  loadSetupChecks?: () => Promise<{ checks?: SetupCheck[] }>;
  loadModels?: () => Promise<{ models?: AgentModel[]; error?: string } | AgentModel[]>;
};

export type WorkspaceWindow = {
  Event: typeof Event;
  CustomEvent: typeof CustomEvent;
  dispatchEvent: (event: Event) => boolean;
  addEventListener: Window["addEventListener"];
  removeEventListener: Window["removeEventListener"];
  setTimeout?: (handler: () => void, timeout: number) => unknown;
};

export type BrowserEventsSubscription = {
  setEnabled: (enabled: boolean) => void;
  close: () => void;
};

export type WorkspaceDispatch = (action: WorkspaceAction) => void;

export type WorkspaceEffectDeps = {
  storage: WorkspaceStorage;
  window: WorkspaceWindow;
  api: WorkspaceApi;
  dispatch?: WorkspaceDispatch;
  queueReplay: (paneId: PaneId, piSessionId: string) => void;
  browserEvents?: BrowserEventsSubscription;
  /** Resolve a project by id from the projects context (workspace doesn't own project state). */
  findProjectById?: (id: string) => Project | null;
  /** Resolve a session's tool selection from the tools context. */
  selectionFor?: (sessionId: SessionId) => ToolSelection;
};

const PANE_STATE_ACTIONS = new Set<WorkspaceAction["type"]>([
  "setSplitRatio",
  "openSessionPayloadInPane",
  "splitPaneWithPayload",
  "focusPane",
  "focusPaneSession",
  "renameTab",
  "splitTab",
  "closePane",
  "hydrateActiveSessions",
  "urlNavRequested",
]);

const SESSIONS_CHANGED_ACTIONS = new Set<WorkspaceAction["type"]>([
  "openSessionPayloadInPane",
  "splitPaneWithPayload",
  "renameTab",
  "splitTab",
  "closePane",
  "setPaneSession",
  "patchSession",
  "patchActiveTab",
  "hydrateActiveSessions",
  "notifySessionsChanged",
  "urlNavRequested",
]);

const METADATA_PATCH_ACTIONS = new Set<WorkspaceAction["type"]>([
  "setPaneSession",
  "patchSession",
  "patchActiveTab",
]);

function dispatchEvent(deps: WorkspaceEffectDeps, type: string): void {
  deps.window.dispatchEvent(new deps.window.Event(type));
}

function dispatchCustomEvent<T>(deps: WorkspaceEffectDeps, type: string, detail: T): void {
  deps.window.dispatchEvent(new deps.window.CustomEvent<T>(type, { detail }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function eventDetail(event: Event): unknown {
  return "detail" in event ? event.detail : undefined;
}

export function subscribeWorkspaceWindowEvents(
  workspaceWindow: WorkspaceWindow,
  dispatch: WorkspaceDispatch,
): () => void {
  // Fired by ProjectsProvider once its first load settles. We hold off on
  // hydrating active-session snapshots until then so we can filter sessions
  // whose project is no longer installed.
  const onProjectsLoaded = (event: Event) => {
    const detail = eventDetail(event);
    const projects =
      isRecord(detail) && Array.isArray(detail.projects) ? (detail.projects as Project[]) : [];
    const params =
      typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const restoreWorkspace = params?.get("restore") !== "0";
    dispatch({
      type: "hydrateActiveSessions",
      snapshots: restoreWorkspace ? loadPersistedActiveAgentSessions() : [],
      projects,
      hasExplicitSessionNav:
        !restoreWorkspace || Boolean(params?.get("session") || params?.get("new")),
    });
  };

  workspaceWindow.addEventListener(PROJECTS_LOADED_EVENT, onProjectsLoaded);

  return () => {
    workspaceWindow.removeEventListener(PROJECTS_LOADED_EVENT, onProjectsLoaded);
    dispatch({ type: "workspaceUnmounted" });
  };
}

function scheduleSessionsRefresh(deps: WorkspaceEffectDeps): void {
  dispatchEvent(deps, SESSIONS_CHANGED_EVENT);
  deps.window.setTimeout?.(() => dispatchEvent(deps, SESSIONS_CHANGED_EVENT), 1_500);
}

function normalizeModelsPayload(
  payload: { models?: AgentModel[]; error?: string } | AgentModel[],
): { models: AgentModel[]; error?: string } {
  return Array.isArray(payload)
    ? { models: payload }
    : { models: payload.models ?? [], error: payload.error };
}

function runInitialApiEffects(state: WorkspaceState, deps: WorkspaceEffectDeps): void {
  const setupChecks = deps.api.loadSetupChecks?.().catch(() => null);

  if (deps.api.loadModels) {
    deps.dispatch?.({ type: "setModelsLoading", loading: true });
    deps.dispatch?.({ type: "setError", error: "" });
    void deps.api
      .loadModels()
      .then((payload) => {
        const normalized = normalizeModelsPayload(payload);
        if (normalized.error) throw new Error(normalized.error);
        deps.dispatch?.({ type: "setModels", models: normalized.models });
        if (normalized.models.length > 0) {
          deps.dispatch?.({ type: "setSetupWarning", warning: "" });
        } else {
          void setupChecks?.then((setupPayload) => {
            const pi = setupPayload?.checks?.find((check) => check.id === "pi");
            deps.dispatch?.({
              type: "setSetupWarning",
              warning: setupWarningFromPiCheck(pi, false),
            });
          });
        }
      })
      .catch((error) => {
        deps.dispatch?.({
          type: "setError",
          error: error instanceof Error ? error.message : "Failed to load models",
        });
        deps.dispatch?.({ type: "setModelsLoading", loading: false });
      });
  } else if (setupChecks) {
    void setupChecks.then((payload) => {
      const pi = payload?.checks?.find((check) => check.id === "pi");
      deps.dispatch?.({
        type: "setSetupWarning",
        warning: setupWarningFromPiCheck(pi, state.models.length > 0),
      });
    });
  }
}

function activeSessionSnapshot(
  state: WorkspaceState,
  tab: Session,
  selectionFor: (id: SessionId) => ToolSelection,
  paneId: string,
  focused: boolean,
): ActiveAgentSessionSnapshot {
  const selection = selectionFor(tab.id);
  const usedSkills = usedSkillsForSession(tab);
  return {
    projectId: tab.projectId ?? "",
    cwd: tab.cwd ?? "",
    paneId,
    tabId: tab.id,
    runtimeSessionId: tab.runtimeSessionId,
    piSessionId: tab.piSessionId,
    modelId: tab.modelId ?? state.selectedModel,
    title: cleanSessionTitle(tab.title) || (paneId ? "Current session" : "Background session"),
    status: tab.status,
    focused,
    startedAt: tab.startedAt,
    updatedAt: tab.startedAt || new Date().toISOString(),
    plugins: selection.plugins.length > 0 ? selection.plugins : undefined,
    skills: selection.skills.length > 0 ? selection.skills : undefined,
    usedSkills: usedSkills.length > 0 ? usedSkills : undefined,
  };
}

function computeActiveSessionBroadcast(
  state: WorkspaceState,
  selectionFor: (id: SessionId) => ToolSelection,
): ActiveAgentSessionSnapshot[] | null {
  if (!state.hydrated) return null;
  const out: ActiveAgentSessionSnapshot[] = [];
  const inPane = new Set<SessionId>();
  for (const [paneId, pane] of state.panesById.entries()) {
    const tab = state.sessions.get(pane.sessionId);
    if (!tab) continue;
    inPane.add(tab.id);
    if (!(Boolean(tab.piSessionId) || tab.messages.length > 0) || tab.status === "loading")
      continue;
    out.push(
      activeSessionSnapshot(state, tab, selectionFor, paneId, paneId === state.focusedPaneId),
    );
  }
  // Sessions still working after the user navigated away keep no pane, but
  // pruneSessions keeps them alive in the store. Surface them so a turn started
  // in another chat stays visible (and re-openable) in the sidebar instead of
  // running invisibly in the background.
  for (const tab of state.sessions.values()) {
    if (inPane.has(tab.id)) continue;
    if (tab.status !== "running" && tab.status !== "starting") continue;
    out.push(activeSessionSnapshot(state, tab, selectionFor, "", false));
  }
  return out;
}

function usedSkillsForSession(tab: Pick<Session, "messages" | "usedSkills">): ComposerSkillRef[] {
  const byId = new Map<string, ComposerSkillRef>();
  for (const skill of tab.usedSkills ?? []) byId.set(skill.id || skill.path || skill.name, skill);
  for (const message of tab.messages) {
    for (const skill of message.skills ?? []) byId.set(skill.id || skill.path || skill.name, skill);
  }
  return [...byId.values()];
}

function activeSessionBroadcastKey(sessions: ActiveAgentSessionSnapshot[] | null): string {
  return JSON.stringify(sessions ?? null);
}

function storedSessionsKey(state: WorkspaceState): string {
  const entries: Array<{ id: string; title: string; cwd?: string }> = [];
  for (const tab of state.sessions.values()) {
    if (!tab.piSessionId) continue;
    entries.push({ id: tab.piSessionId, title: cleanSessionTitle(tab.title), cwd: tab.cwd });
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(entries);
}

function broadcastActiveSessions(
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  const selectionFor = deps.selectionFor ?? (() => EMPTY_SELECTION);
  const previous = computeActiveSessionBroadcast(prevState, selectionFor);
  const next = computeActiveSessionBroadcast(nextState, selectionFor);
  if (!next || activeSessionBroadcastKey(previous) === activeSessionBroadcastKey(next)) return;
  writeActiveSessions(deps.storage, next);
  dispatchCustomEvent(deps, ACTIVE_AGENT_SESSIONS_EVENT, { sessions: next });
}

function queueLocatedReplay(
  piSessionId: string | null | undefined,
  state: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  if (!piSessionId) return;
  const located = findPaneByPiSessionId(state, piSessionId);
  if (located) deps.queueReplay(located.paneId, piSessionId);
}

function queueReplayEffects(
  action: WorkspaceAction,
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  switch (action.type) {
    case "openSessionPayloadInPane":
    case "splitPaneWithPayload":
      if (
        action.payload.piSessionId &&
        !findPaneByPiSessionId(prevState, action.payload.piSessionId)
      ) {
        queueLocatedReplay(action.payload.piSessionId, nextState, deps);
      }
      return;
    case "urlNavRequested":
      if (action.sessionId) queueLocatedReplay(action.sessionId, nextState, deps);
      return;
    case "hydrateActiveSessions": {
      const queued = new Set<string>();
      for (const snapshot of action.snapshots) {
        if (!snapshot.piSessionId || queued.has(snapshot.piSessionId)) continue;
        queued.add(snapshot.piSessionId);
        queueLocatedReplay(snapshot.piSessionId, nextState, deps);
      }
      return;
    }
    default:
      return;
  }
}

function persistActionEffects(
  action: WorkspaceAction,
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  if (PANE_STATE_ACTIONS.has(action.type)) {
    writePaneState(deps.storage, nextState, deps.selectionFor);
    return;
  }
  if (
    METADATA_PATCH_ACTIONS.has(action.type) &&
    paneMetadataKey(prevState, deps.selectionFor) !== paneMetadataKey(nextState, deps.selectionFor)
  ) {
    writePaneState(deps.storage, nextState, deps.selectionFor);
  }
  // Browser/computer tool state persistence now lives in
  // features/agent/tools/persistence.ts and is driven by ToolsProvider directly.
}

function paneMetadataKey(
  state: WorkspaceState,
  selectionFor: ((sessionId: SessionId) => ToolSelection | null) | undefined,
): string {
  const panes: Record<string, unknown> = {};
  for (const [paneId, pane] of state.panesById.entries()) {
    panes[paneId] = {
      sessionId: pane.sessionId,
      tab: state.sessions.get(pane.sessionId)
        ? sessionMetaForPersistence(
            state.sessions.get(pane.sessionId)!,
            selectionFor?.(pane.sessionId) ?? undefined,
          )
        : null,
    };
  }
  return JSON.stringify({
    layout: state.layout,
    focusedPaneId: state.focusedPaneId,
    panes,
  });
}

export function runWorkspaceEffect(
  action: WorkspaceAction,
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  if (action.type === "workspaceUnmounted") {
    deps.browserEvents?.close();
    return;
  }

  persistActionEffects(action, prevState, nextState, deps);
  queueReplayEffects(action, prevState, nextState, deps);

  if (action.type === "hydrate") {
    runInitialApiEffects(nextState, deps);
  }

  broadcastActiveSessions(prevState, nextState, deps);
  if (
    SESSIONS_CHANGED_ACTIONS.has(action.type) &&
    storedSessionsKey(prevState) !== storedSessionsKey(nextState)
  ) {
    scheduleSessionsRefresh(deps);
  }
  // BrowserEventsSubscription.setEnabled is driven by ToolsProvider via
  // use-workspace; the workspace effect no longer reads `browserToolEnabled`.
}
