import { collectLeaves } from "@/app/agent/_components/pane-layout";
import {
  mergeActiveAgentSessions,
  type ActiveAgentSessionSnapshot,
  type ActiveSessionPrefs,
} from "@/lib/agent/active-sessions";
import type { SessionTab } from "@/app/agent/_components/chat-pane";
import type {
  AgentModel,
  PaneId,
  PaneState,
  WorkspaceAction,
  WorkspaceLayout,
  WorkspaceState,
} from "./types";
import {
  DEFAULT_BROWSER_URL,
  DEFAULT_COMPUTER_WIDTH,
  MAX_COMPUTER_WIDTH,
  MIN_COMPUTER_WIDTH,
  setBrowserInput,
  setBrowserToolEnabled,
  setBrowserUrl,
  setComputerOpen,
  setComputerTab,
  setComputerWidth,
  toggleBrowserTool,
  toggleComputerOpen,
} from "./computer-controller";
import {
  applyUrlNavigation,
  closePane,
  focusPane,
  focusTab,
  openNewSessionInFocusedPane,
  openSessionPayloadInPane,
  patchActiveTab,
  replaySessionInFocusedPane,
  replaySessionInSplitPane,
  restorePaneState as restorePaneWorkspaceState,
  setPaneTabs,
  setWorkspaceLayout,
  setWorkspaceSplitRatio,
  splitPaneWithPayload,
  splitTabIntoNewPane,
  renameTab,
} from "./pane-controller";

export {
  DEFAULT_BROWSER_URL,
  DEFAULT_COMPUTER_WIDTH,
  MAX_COMPUTER_WIDTH,
  MIN_COMPUTER_WIDTH,
  clampComputerWidth,
  normalizeBrowserInput,
} from "./computer-controller";

export { findPaneTabByPiSessionId, isEmptyStarterTab } from "./pane-controller";

export const DEFAULT_AGENT_CWD = "";

export const SELECTED_PROJECT_KEY = "vllm-studio.agent.selectedProjectId";
export const BROWSER_TOOL_KEY = "vllm-studio.agent.browserToolEnabled";
export const BROWSER_TOOL_DEFAULT_OFF_MIGRATION_KEY =
  "***************************************************";
export const COMPUTER_BROWSER_OPEN_KEY = "vllm-studio.agent.computer.browserOpen";
export const COMPUTER_FILES_OPEN_KEY = "vllm-studio.agent.computer.filesOpen";
export const COMPUTER_DEFAULT_CLOSED_STORAGE_ID = "vllm-studio.agent.computer.defaultCollapsedV2";
export const COMPUTER_WIDTH_KEY = "vllm-studio.agent.computer.width";
export const PANE_LAYOUT_KEY = "vllm-studio.agent.paneLayout";
export const PANE_STATE_KEY = "vllm-studio.agent.paneState";
export const ACTIVE_AGENT_SESSIONS_SNAPSHOT_KEY = "vllm-studio.agent.activeSessions.snapshot";
export const SESSION_PREFS_KEY = "vllm-studio.agent.sessionPrefs";

export type WorkspaceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type PersistedPaneState = {
  version: 1;
  layout: WorkspaceLayout;
  focusedPaneId: PaneId;
  panes: Record<
    string,
    {
      tabs?: unknown[];
      activeTabId?: unknown;
      runtimeSessionId?: unknown;
    }
  >;
};

export function randomIdSegment(length: number): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID().replace(/-/g, "").slice(0, length);
  }
  const bytes = new Uint8Array(Math.ceil(length / 2));
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

export function newPaneId(): PaneId {
  return `p-${Date.now().toString(36)}-${randomIdSegment(6)}`;
}

export function newRuntimeId(): string {
  return `rt-${Date.now().toString(36)}-${randomIdSegment(6)}`;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomIdSegment(8)}`;
}

function makeFreshWorkspaceTab(): SessionTab {
  return {
    id: newId("tab"),
    runtimeSessionId: newId("rt"),
    piSessionId: null,
    title: "New session",
    messages: [],
    status: "idle",
    error: "",
    input: "",
  };
}

function freshTab(tab?: SessionTab): SessionTab {
  return tab ? { ...tab } : makeFreshWorkspaceTab();
}

export function createInitialState(): WorkspaceState {
  const tab = makeFreshWorkspaceTab();
  return {
    projects: [],
    projectsLoaded: false,
    selectedProjectId: null,
    agentCwd: DEFAULT_AGENT_CWD,
    models: [],
    selectedModel: "",
    modelsLoading: true,
    layout: { kind: "leaf", paneId: "p-init" },
    panesById: new Map([
      [
        "p-init",
        {
          tabs: [tab],
          activeTabId: tab.id,
          runtimeSessionId: `rt-${randomIdSegment(9)}`,
        },
      ],
    ]),
    focusedPaneId: "p-init",
    setupWarning: "",
    error: "",
    gitSummaries: new Map(),
    computer: { open: false, tab: "browser", width: DEFAULT_COMPUTER_WIDTH },
    browserToolEnabled: false,
    browserUrl: DEFAULT_BROWSER_URL,
    browserInput: DEFAULT_BROWSER_URL,
    hydrated: false,
    lastHandledNavKey: "",
  };
}

export function setupWarningFromPiCheck(
  piCheck: { ok: boolean; guidance?: string } | undefined,
  hasUsableModels: boolean,
): string {
  if (hasUsableModels || !piCheck || piCheck.ok) return "";
  return piCheck.guidance ?? "Pi is not installed.";
}

export function normalizePersistedTab(value: unknown): SessionTab | null {
  if (!value || typeof value !== "object") return null;
  const tab = value as Partial<SessionTab>;
  if (typeof tab.id !== "string" || typeof tab.runtimeSessionId !== "string") return null;
  const fallback = makeFreshWorkspaceTab();
  return {
    ...fallback,
    ...tab,
    id: tab.id,
    runtimeSessionId: tab.runtimeSessionId,
    piSessionId: typeof tab.piSessionId === "string" ? tab.piSessionId : null,
    title: typeof tab.title === "string" && tab.title.trim() ? tab.title : fallback.title,
    messages: Array.isArray(tab.messages) ? tab.messages.slice(-80) : [],
    status: typeof tab.status === "string" ? tab.status : "idle",
    error: "",
    startedAt: typeof tab.startedAt === "string" ? tab.startedAt : undefined,
    input: typeof tab.input === "string" ? tab.input : "",
    queue: Array.isArray(tab.queue) ? tab.queue : undefined,
    activeAssistantId:
      typeof tab.activeAssistantId === "string" ? tab.activeAssistantId : undefined,
    lastEventSeq: typeof tab.lastEventSeq === "number" ? tab.lastEventSeq : undefined,
    plugins: Array.isArray(tab.plugins) ? tab.plugins : undefined,
    skills: Array.isArray(tab.skills) ? tab.skills : undefined,
  };
}

export function restorePersistedPaneState(raw: string): {
  layout: WorkspaceLayout;
  panesById: Map<PaneId, PaneState>;
  focusedPaneId: PaneId;
} | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedPaneState>;
    if (!parsed.layout || typeof parsed.layout !== "object") return null;
    const leaves = collectLeaves(parsed.layout as WorkspaceLayout);
    if (leaves.length === 0) return null;
    const panes = parsed.panes && typeof parsed.panes === "object" ? parsed.panes : {};
    const panesById = new Map<PaneId, PaneState>();
    for (const paneId of leaves) {
      const pane = panes[paneId] ?? {};
      const restoredTabs = Array.isArray(pane.tabs)
        ? pane.tabs.map(normalizePersistedTab).filter((tab): tab is SessionTab => Boolean(tab))
        : [];
      const tabs = restoredTabs.length > 0 ? restoredTabs : [makeFreshWorkspaceTab()];
      const activeTabId =
        typeof pane.activeTabId === "string" && tabs.some((tab) => tab.id === pane.activeTabId)
          ? pane.activeTabId
          : tabs[0].id;
      panesById.set(paneId, {
        tabs,
        activeTabId,
        runtimeSessionId:
          typeof pane.runtimeSessionId === "string" && pane.runtimeSessionId.trim()
            ? pane.runtimeSessionId
            : newRuntimeId(),
      });
    }
    const focusedPaneId =
      typeof parsed.focusedPaneId === "string" && leaves.includes(parsed.focusedPaneId)
        ? parsed.focusedPaneId
        : leaves[0];
    return { layout: parsed.layout as WorkspaceLayout, panesById, focusedPaneId };
  } catch {
    return null;
  }
}

export function tabForPersistence(tab: SessionTab): SessionTab {
  return {
    ...tab,
    messages: tab.messages.slice(-80),
    status: tab.status,
    error: "",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function defaultWorkspaceStorage(): WorkspaceStorage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function loadSessionPrefs(storage: WorkspaceStorage): ActiveSessionPrefs {
  try {
    const raw = storage.getItem(SESSION_PREFS_KEY);
    return raw ? (JSON.parse(raw) as ActiveSessionPrefs) : {};
  } catch {
    return {};
  }
}

export function loadPersistedActiveAgentSessions(
  storage: WorkspaceStorage | null = defaultWorkspaceStorage(),
): ActiveAgentSessionSnapshot[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(ACTIVE_AGENT_SESSIONS_SNAPSHOT_KEY);
    if (!raw) return [];
    const prefs = loadSessionPrefs(storage);
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isRecord)
      .map((entry): ActiveAgentSessionSnapshot => {
        const piSessionId = typeof entry.piSessionId === "string" ? entry.piSessionId.trim() : null;
        return {
          projectId: typeof entry.projectId === "string" ? entry.projectId : "",
          cwd: typeof entry.cwd === "string" ? entry.cwd : "",
          paneId: typeof entry.paneId === "string" ? entry.paneId : "",
          tabId: typeof entry.tabId === "string" ? entry.tabId : "",
          piSessionId: piSessionId || null,
          modelId: typeof entry.modelId === "string" ? entry.modelId : undefined,
          title: typeof entry.title === "string" ? entry.title : "Loading session",
          status: typeof entry.status === "string" ? entry.status : "idle",
          active: entry.active === true,
          startedAt: typeof entry.startedAt === "string" ? entry.startedAt : undefined,
          updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
          plugins: Array.isArray(entry.plugins)
            ? (entry.plugins as SessionTab["plugins"])
            : undefined,
          skills: Array.isArray(entry.skills) ? (entry.skills as SessionTab["skills"]) : undefined,
        };
      })
      .filter(
        (entry) =>
          !prefs[entry.piSessionId ?? ""]?.hidden &&
          Boolean(entry.projectId) &&
          Boolean(entry.cwd) &&
          Boolean(entry.paneId) &&
          Boolean(entry.tabId),
      );
  } catch {
    return [];
  }
}

export function persistActiveAgentSessions(
  sessions: ActiveAgentSessionSnapshot[],
  storage: WorkspaceStorage | null = defaultWorkspaceStorage(),
): void {
  if (!storage) return;
  const prefs = loadSessionPrefs(storage);
  const merged = mergeActiveAgentSessions(
    loadPersistedActiveAgentSessions(storage),
    sessions,
    prefs,
  );
  if (merged.length > 0) {
    storage.setItem(ACTIVE_AGENT_SESSIONS_SNAPSHOT_KEY, JSON.stringify(merged));
  } else {
    storage.removeItem(ACTIVE_AGENT_SESSIONS_SNAPSHOT_KEY);
  }
}

export function layoutFromPaneIds(paneIds: PaneId[]): WorkspaceLayout {
  if (paneIds.length <= 1) return { kind: "leaf", paneId: paneIds[0] ?? "p-init" };
  const [first, ...rest] = paneIds;
  return {
    kind: "split",
    direction: "vertical",
    ratio: 0.5,
    a: { kind: "leaf", paneId: first },
    b: layoutFromPaneIds(rest),
  };
}

export function tabFromSnapshot(session: ActiveAgentSessionSnapshot): SessionTab {
  const fresh = makeFreshWorkspaceTab();
  return {
    ...fresh,
    id: session.tabId || fresh.id,
    piSessionId: session.piSessionId,
    projectId: session.projectId,
    cwd: session.cwd,
    modelId: session.modelId,
    title: session.title || "Loading session",
    status: "loading",
    startedAt: session.startedAt ?? session.updatedAt,
    plugins: session.plugins,
    skills: session.skills,
  };
}

function chooseModelId(
  models: AgentModel[],
  currentModelId: string,
  preferredModelId?: string,
): string {
  if (preferredModelId && models.some((model) => model.id === preferredModelId)) {
    return preferredModelId;
  }
  if (currentModelId && models.some((model) => model.id === currentModelId)) {
    return currentModelId;
  }
  return models.find((model) => model.active)?.id || models[0]?.id || "";
}

function hydrateSessionSnapshots(
  state: WorkspaceState,
  snapshots: ActiveAgentSessionSnapshot[],
): WorkspaceState {
  const paneStateAlreadyRestored = [...state.panesById.values()].some((pane) =>
    pane.tabs.some((tab) => Boolean(tab.piSessionId) || tab.messages.length > 0),
  );
  if (paneStateAlreadyRestored) return { ...state, hydrated: true };

  const restorable = snapshots.filter((session) =>
    state.projects.some(
      (project) => project.id === session.projectId || project.path === session.cwd,
    ),
  );
  if (restorable.length === 0) return { ...state, hydrated: true };

  const grouped = new Map<PaneId, ActiveAgentSessionSnapshot[]>();
  for (const session of restorable) {
    const current = grouped.get(session.paneId) ?? [];
    current.push(session);
    grouped.set(session.paneId, current);
  }

  const paneIds = [...grouped.keys()];
  const panesById = new Map<PaneId, PaneState>();
  for (const paneId of paneIds) {
    const group = grouped.get(paneId) ?? [];
    const tabs = group.map(tabFromSnapshot);
    const activeTabId =
      group.find((session) => session.active)?.tabId || tabs[0]?.id || makeFreshWorkspaceTab().id;
    panesById.set(paneId, {
      tabs: tabs.length > 0 ? tabs : [makeFreshWorkspaceTab()],
      activeTabId,
      runtimeSessionId: newRuntimeId(),
    });
  }

  const activeSnapshot = restorable.find((session) => session.active) ?? restorable[0];
  const activeProject =
    state.projects.find((project) => project.id === activeSnapshot.projectId) ??
    state.projects.find((project) => project.path === activeSnapshot.cwd) ??
    null;

  return {
    ...state,
    panesById,
    layout: layoutFromPaneIds(paneIds),
    focusedPaneId: activeSnapshot.paneId,
    selectedProjectId: activeProject ? activeProject.id : state.selectedProjectId,
    agentCwd: activeProject ? activeProject.path : state.agentCwd,
    hydrated: true,
  };
}

export function reducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "hydrate":
    case "HYDRATE": {
      const hydration = action.type === "HYDRATE" ? action.payload : action.state;
      const next = { ...state, ...hydration };
      return { ...next, hydrated: action.hydrated ?? next.hydrated };
    }
    case "WORKSPACE_UNMOUNTED":
    case "PROJECTS_CHANGED":
    case "NOTIFY_SESSIONS_CHANGED":
      return state;
    case "setProjects": {
      const initial =
        (action.storedProjectId &&
          action.projects.find((entry) => entry.id === action.storedProjectId)) ||
        action.projects[0] ||
        null;
      return {
        ...state,
        projects: action.projects,
        projectsLoaded: true,
        selectedProjectId: initial?.id ?? null,
        agentCwd: initial?.path ?? DEFAULT_AGENT_CWD,
      };
    }
    case "setProjectsLoaded":
      return { ...state, projectsLoaded: action.loaded };
    case "selectProject":
    case "SELECT_PROJECT":
      return {
        ...state,
        selectedProjectId: action.project?.id ?? null,
        agentCwd: action.project?.path ?? DEFAULT_AGENT_CWD,
      };
    case "setAgentCwd":
      return { ...state, agentCwd: action.cwd };
    case "setModelsLoading":
      return { ...state, modelsLoading: action.loading };
    case "setModels":
      return {
        ...state,
        models: action.models,
        selectedModel: chooseModelId(action.models, state.selectedModel, action.preferredModelId),
        modelsLoading: false,
      };
    case "setSelectedModel":
      return { ...state, selectedModel: action.modelId };
    case "setSetupWarning":
      return { ...state, setupWarning: action.warning };
    case "setError":
      return { ...state, error: action.error };
    case "setLayout":
      return setWorkspaceLayout(state, { layout: action.layout });
    case "setSplitRatio":
    case "SET_SPLIT_RATIO":
      return setWorkspaceSplitRatio(state, { path: action.path, ratio: action.ratio });
    case "restorePaneState":
      return restorePaneWorkspaceState(state, action);
    case "openNewSession":
    case "OPEN_NEW_SESSION": {
      const project =
        action.project ??
        (action.type === "OPEN_NEW_SESSION" && action.projectId
          ? state.projects.find((entry) => entry.id === action.projectId)
          : undefined);
      return openNewSessionInFocusedPane(state, { project, tab: freshTab(action.tab) });
    }
    case "replaySession":
    case "REPLAY_SESSION":
      return replaySessionInFocusedPane(state, {
        piSessionId: action.piSessionId,
        sessionTitle: action.sessionTitle,
        tab: freshTab(action.tab),
      });
    case "replaySessionInSplit":
    case "REPLAY_SESSION_IN_SPLIT":
      return replaySessionInSplitPane(state, {
        piSessionId: action.piSessionId,
        paneId: action.paneId ?? newPaneId(),
        runtimeSessionId: action.runtimeSessionId ?? newRuntimeId(),
        sessionTitle: action.sessionTitle,
        tab: freshTab(action.tab),
      });
    case "openSessionPayloadInPane":
    case "OPEN_SESSION_PAYLOAD_IN_PANE":
      return openSessionPayloadInPane(state, {
        paneId: action.paneId,
        payload: action.payload,
        tab: freshTab(action.tab),
      });
    case "splitPaneWithPayload":
    case "SPLIT_PANE_WITH_PAYLOAD":
      return splitPaneWithPayload(state, {
        paneId: action.paneId,
        direction: action.direction,
        side: action.side,
        payload: action.payload,
        newPaneId: action.newPaneId ?? newPaneId(),
        runtimeSessionId: action.runtimeSessionId ?? newRuntimeId(),
        tab: freshTab(action.tab),
      });
    case "focusPane":
    case "FOCUS_PANE":
      return focusPane(state, { paneId: action.paneId });
    case "focusTab":
    case "FOCUS_TAB":
      return focusTab(state, { paneId: action.paneId, tabId: action.tabId });
    case "renameTab":
    case "RENAME_TAB":
      return renameTab(state, {
        paneId: action.paneId,
        tabId: action.tabId,
        title: action.title,
      });
    case "splitTab":
    case "SPLIT_TAB":
      return splitTabIntoNewPane(state, {
        sourcePaneId: action.sourcePaneId,
        sourceTabId: action.sourceTabId,
        newPaneId: action.newPaneId ?? newPaneId(),
        runtimeSessionId: action.runtimeSessionId ?? newRuntimeId(),
        tab: freshTab(action.tab),
      });
    case "closePane":
    case "CLOSE_PANE":
      return closePane(state, { paneId: action.paneId });
    case "setPaneTabs":
    case "SET_PANE_TABS":
      return setPaneTabs(state, { paneId: action.paneId, tabs: action.tabs });
    case "patchActiveTab":
    case "PATCH_ACTIVE_TAB":
      return patchActiveTab(state, { paneId: action.paneId, patch: action.patch });
    case "setComputerOpen":
    case "SET_COMPUTER_OPEN":
      return setComputerOpen(state, { open: action.open });
    case "toggleComputerOpen":
    case "TOGGLE_COMPUTER_OPEN":
      return toggleComputerOpen(state);
    case "setComputerTab":
    case "SET_COMPUTER_TAB":
      return setComputerTab(state, { tab: action.tab });
    case "setComputerWidth":
    case "SET_COMPUTER_WIDTH":
      return setComputerWidth(state, { width: action.width });
    case "setBrowserToolEnabled":
    case "SET_BROWSER_TOOL_ENABLED":
      return setBrowserToolEnabled(state, { enabled: action.enabled });
    case "toggleBrowserTool":
    case "TOGGLE_BROWSER_TOOL":
      return toggleBrowserTool(state);
    case "setBrowserUrl":
    case "SET_BROWSER_URL":
      return setBrowserUrl(state, { url: action.url, input: action.input });
    case "setBrowserInput":
    case "SET_BROWSER_INPUT":
      return setBrowserInput(state, { input: action.input });
    case "setGitSummary": {
      const next = new Map(state.gitSummaries);
      if (action.summary) next.set(action.cwd, action.summary);
      else next.delete(action.cwd);
      return { ...state, gitSummaries: next };
    }
    case "deleteGitSummary": {
      const next = new Map(state.gitSummaries);
      next.delete(action.cwd);
      return { ...state, gitSummaries: next };
    }
    case "URL_NAV_REQUESTED":
      return applyUrlNavigation(state, {
        key: action.key,
        projectId: action.projectId,
        sessionId: action.sessionId,
        sessionTitle: action.sessionTitle,
        newSession: action.newSession,
        split: action.split,
        paneId: newPaneId(),
        runtimeSessionId: newRuntimeId(),
        tab: freshTab(),
      });
    case "hydrateActiveSessions":
      return action.hasExplicitSessionNav
        ? { ...state, hydrated: true }
        : hydrateSessionSnapshots(state, action.snapshots);
    default:
      return state;
  }
}
