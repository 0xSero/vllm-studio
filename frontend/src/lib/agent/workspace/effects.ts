import type { ActiveAgentSessionSnapshot } from "@/lib/agent/active-sessions";
import type {
  AgentModel,
  GitSummary,
  PaneId,
  ProjectEntry,
  WorkspaceAction,
  WorkspaceState,
} from "./types";
import {
  SELECTED_PROJECT_KEY,
  findPaneTabByPiSessionId,
  loadPersistedActiveAgentSessions,
  setupWarningFromPiCheck,
  type WorkspaceStorage,
} from "./store";
import {
  writeActiveSessions,
  writeBrowserTool,
  writeComputerTab,
  writeComputerWidth,
  writePaneState,
  writeSelectedProject,
} from "./persistence";

const SESSIONS_CHANGED_EVENT = "vllm-studio.agent.sessionsChanged";
const PROJECTS_CHANGED_EVENT = "vllm-studio.agent.projectsChanged";
const ACTIVE_AGENT_SESSIONS_EVENT = "vllm-studio.agent.activeSessions";

type SetupCheck = { id: string; ok: boolean; guidance?: string };

type WorkspaceApi = {
  loadSetupChecks?: () => Promise<{ checks?: SetupCheck[] }>;
  loadModels?: () => Promise<{ models?: AgentModel[]; error?: string } | AgentModel[]>;
  loadProjects?: () => Promise<ProjectEntry[]>;
  loadGitSummary?: (cwd: string) => Promise<GitSummary | null>;
};

type WorkspaceWindow = {
  Event: typeof Event;
  CustomEvent: typeof CustomEvent;
  dispatchEvent: (event: Event) => boolean;
  setTimeout?: typeof setTimeout;
};

type WorkspaceEffectDeps = {
  storage: WorkspaceStorage;
  window: WorkspaceWindow;
  api: WorkspaceApi;
  dispatch?: (action: WorkspaceAction) => void;
  hasExplicitSessionNav?: () => boolean;
  queueReplay: (paneId: PaneId, piSessionId: string) => void;
};

const PANE_STATE_ACTIONS = new Set<WorkspaceAction["type"]>([
  "setLayout",
  "setSplitRatio",
  "restorePaneState",
  "openNewSession",
  "replaySession",
  "replaySessionInSplit",
  "openSessionPayloadInPane",
  "splitPaneWithPayload",
  "focusPane",
  "focusTab",
  "renameTab",
  "splitTab",
  "closePane",
  "setPaneTabs",
  "patchActiveTab",
  "hydrateActiveSessions",
]);

const SESSIONS_CHANGED_ACTIONS = new Set<WorkspaceAction["type"]>([
  "openNewSession",
  "replaySession",
  "replaySessionInSplit",
  "openSessionPayloadInPane",
  "splitPaneWithPayload",
  "renameTab",
  "splitTab",
  "closePane",
  "setPaneTabs",
  "patchActiveTab",
  "hydrateActiveSessions",
]);

function dispatchEvent(deps: WorkspaceEffectDeps, type: string): void {
  deps.window.dispatchEvent(new deps.window.Event(type));
}

function dispatchCustomEvent<T>(deps: WorkspaceEffectDeps, type: string, detail: T): void {
  deps.window.dispatchEvent(new deps.window.CustomEvent<T>(type, { detail }));
}

function scheduleSessionsRefresh(deps: WorkspaceEffectDeps): void {
  dispatchEvent(deps, SESSIONS_CHANGED_EVENT);
  deps.window.setTimeout?.(() => dispatchEvent(deps, SESSIONS_CHANGED_EVENT), 1_500);
}

function readSelectedProjectId(storage: WorkspaceStorage): string | null {
  try {
    return storage.getItem(SELECTED_PROJECT_KEY);
  } catch {
    return null;
  }
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

  if (deps.api.loadProjects) {
    void deps.api
      .loadProjects()
      .then((projects) => {
        deps.dispatch?.({
          type: "setProjects",
          projects,
          storedProjectId: readSelectedProjectId(deps.storage),
        });
      })
      .catch(() => {
        deps.dispatch?.({ type: "setProjectsLoaded", loaded: true });
      });
  }
}

function activeProjectForState(state: WorkspaceState): ProjectEntry | null {
  return state.projects.find((entry) => entry.id === state.selectedProjectId) ?? null;
}

function focusedProjectPath(state: WorkspaceState): string | null {
  const focusedPane = state.panesById.get(state.focusedPaneId);
  const focusedTab = focusedPane?.tabs.find((tab) => tab.id === focusedPane.activeTabId) ?? null;
  const activeProject = activeProjectForState(state);
  const focusedProject =
    state.projects.find((entry) => entry.id === focusedTab?.projectId) ??
    state.projects.find((entry) => entry.path === focusedTab?.cwd) ??
    activeProject;
  return focusedProject?.path ?? null;
}

function runGitSummaryEffect(
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  const nextPath = focusedProjectPath(nextState);
  if (!nextPath || focusedProjectPath(prevState) === nextPath || !deps.api.loadGitSummary) return;
  void deps.api
    .loadGitSummary(nextPath)
    .then((summary) => {
      deps.dispatch?.({ type: "setGitSummary", cwd: nextPath, summary });
    })
    .catch(() => {
      deps.dispatch?.({ type: "deleteGitSummary", cwd: nextPath });
    });
}

function computeActiveSessionBroadcast(state: WorkspaceState): ActiveAgentSessionSnapshot[] | null {
  const activeProject = activeProjectForState(state);
  if (!activeProject || !state.hydrated) return null;
  return [...state.panesById.entries()].flatMap(([paneId, pane]) =>
    pane.tabs
      .filter(
        (tab) => (Boolean(tab.piSessionId) || tab.messages.length > 0) && tab.status !== "loading",
      )
      .map((tab) => {
        const project =
          state.projects.find((entry) => entry.id === tab.projectId) ??
          state.projects.find((entry) => entry.path === tab.cwd) ??
          activeProject;
        return {
          projectId: project.id,
          cwd: tab.cwd ?? project.path,
          paneId,
          tabId: tab.id,
          piSessionId: tab.piSessionId,
          modelId: tab.modelId ?? state.selectedModel,
          title: tab.title,
          status: tab.status,
          active: paneId === state.focusedPaneId && tab.id === pane.activeTabId,
          startedAt: tab.startedAt,
          updatedAt: tab.startedAt || "",
          plugins: tab.plugins,
          skills: tab.skills,
        };
      }),
  );
}

function activeSessionBroadcastKey(sessions: ActiveAgentSessionSnapshot[] | null): string {
  return JSON.stringify(sessions ?? null);
}

function broadcastActiveSessions(
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  const previous = computeActiveSessionBroadcast(prevState);
  const next = computeActiveSessionBroadcast(nextState);
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
  const located = findPaneTabByPiSessionId(state.panesById, piSessionId);
  if (located) deps.queueReplay(located.paneId, piSessionId);
}

function queueRecoverableActiveTabReplays(state: WorkspaceState, deps: WorkspaceEffectDeps): void {
  const queued = new Set<string>();
  for (const [paneId, pane] of state.panesById.entries()) {
    const activeTab = pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? pane.tabs[0];
    if (
      activeTab?.piSessionId &&
      (activeTab.messages.length === 0 ||
        activeTab.status === "loading" ||
        activeTab.status === "running" ||
        activeTab.status === "starting") &&
      !queued.has(activeTab.piSessionId)
    ) {
      queued.add(activeTab.piSessionId);
      deps.queueReplay(paneId, activeTab.piSessionId);
    }
  }
}

function queueReplayEffects(
  action: WorkspaceAction,
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  switch (action.type) {
    case "replaySession":
      queueLocatedReplay(action.piSessionId, nextState, deps);
      return;
    case "replaySessionInSplit":
      if (!findPaneTabByPiSessionId(prevState.panesById, action.piSessionId)) {
        queueLocatedReplay(action.piSessionId, nextState, deps);
      }
      return;
    case "openSessionPayloadInPane":
    case "splitPaneWithPayload":
      if (
        action.payload.piSessionId &&
        !findPaneTabByPiSessionId(prevState.panesById, action.payload.piSessionId)
      ) {
        queueLocatedReplay(action.payload.piSessionId, nextState, deps);
      }
      return;
    case "restorePaneState":
    case "hydrateActiveSessions":
      queueRecoverableActiveTabReplays(nextState, deps);
      return;
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
    writePaneState(deps.storage, nextState);
  }

  if (
    (action.type === "selectProject" ||
      action.type === "openNewSession" ||
      action.type === "hydrateActiveSessions") &&
    prevState.selectedProjectId !== nextState.selectedProjectId
  ) {
    writeSelectedProject(deps.storage, nextState.selectedProjectId);
  }

  if (prevState.computer.tab !== nextState.computer.tab) {
    writeComputerTab(deps.storage, nextState.computer.tab);
  }

  if (prevState.computer.width !== nextState.computer.width) {
    writeComputerWidth(deps.storage, nextState.computer.width);
  }

  if (prevState.browserToolEnabled !== nextState.browserToolEnabled) {
    writeBrowserTool(deps.storage, nextState.browserToolEnabled);
  }
}

export function runWorkspaceEffect(
  action: WorkspaceAction,
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  persistActionEffects(action, prevState, nextState, deps);
  queueReplayEffects(action, prevState, nextState, deps);

  if (SESSIONS_CHANGED_ACTIONS.has(action.type)) {
    scheduleSessionsRefresh(deps);
  }

  if (action.type === "hydrate") {
    runInitialApiEffects(nextState, deps);
  }

  if (action.type === "setProjects" && !nextState.hydrated) {
    deps.dispatch?.({
      type: "hydrateActiveSessions",
      snapshots: loadPersistedActiveAgentSessions(deps.storage),
      hasExplicitSessionNav: deps.hasExplicitSessionNav?.() ?? false,
    });
  }

  runGitSummaryEffect(prevState, nextState, deps);
  broadcastActiveSessions(prevState, nextState, deps);

  if (action.type === "setGitSummary") {
    dispatchEvent(deps, PROJECTS_CHANGED_EVENT);
  }
}
