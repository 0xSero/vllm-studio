import {
  collectLeaves,
  removeLeaf,
  setSplitRatio as setLayoutSplitRatio,
  splitLeaf,
} from "@/app/agent/_components/pane-layout";
import type { SessionTab } from "@/app/agent/_components/chat-pane";
import type {
  PaneId,
  PaneState,
  ProjectEntry,
  WorkspaceLayout,
  WorkspaceSessionPayload,
  WorkspaceState,
} from "./types";

type SessionTabPayload = { tab?: SessionTab };
type RuntimePanePayload = { runtimeSessionId?: string };

export type OpenNewSessionPayload = SessionTabPayload & {
  project?: ProjectEntry;
};

export type ReplaySessionPayload = SessionTabPayload & {
  piSessionId: string;
  sessionTitle?: string;
};

export type ReplaySessionInSplitPayload = ReplaySessionPayload &
  RuntimePanePayload & {
    paneId?: PaneId;
  };

export type OpenSessionPayloadInPanePayload = SessionTabPayload & {
  paneId: PaneId;
  payload: WorkspaceSessionPayload;
};

export type SplitPaneWithPayloadPayload = SessionTabPayload &
  RuntimePanePayload & {
    paneId: PaneId;
    newPaneId?: PaneId;
    direction: "vertical" | "horizontal";
    side: "a" | "b";
    payload: WorkspaceSessionPayload;
  };

export type SplitTabPayload = SessionTabPayload &
  RuntimePanePayload & {
    sourcePaneId: PaneId;
    sourceTabId: string;
    newPaneId?: PaneId;
  };

export type UrlNavigationPayload = SessionTabPayload &
  RuntimePanePayload & {
    key: string;
    projectId?: string | null;
    sessionId?: string | null;
    sessionTitle?: string;
    newSession?: boolean;
    split?: boolean;
    paneId?: PaneId;
  };

function isSessionTab(value: SessionTab | undefined): value is SessionTab {
  return Boolean(
    value &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.runtimeSessionId === "string" &&
    value.runtimeSessionId.length > 0,
  );
}

function replaySessionTitle(sessionTitle?: string, fallback = "Loading session"): string {
  return sessionTitle?.trim() || fallback;
}

function validPaneRuntime(paneId: PaneId | undefined, runtimeSessionId: string | undefined) {
  return Boolean(
    paneId &&
    typeof paneId === "string" &&
    runtimeSessionId &&
    typeof runtimeSessionId === "string",
  );
}

function paneExists(state: WorkspaceState, paneId: PaneId): boolean {
  return state.panesById.has(paneId);
}

function leafExists(state: WorkspaceState, paneId: PaneId): boolean {
  return collectLeaves(state.layout).includes(paneId);
}

function setPane(state: WorkspaceState, paneId: PaneId, pane: PaneState): WorkspaceState {
  const next = new Map(state.panesById);
  next.set(paneId, pane);
  return { ...state, panesById: next };
}

export function isEmptyStarterTab(tab: SessionTab): boolean {
  return !tab.piSessionId && tab.messages.length === 0 && !tab.input.trim();
}

export function findPaneTabByPiSessionId(
  panes: ReadonlyMap<PaneId, PaneState>,
  piSessionId: string,
): { paneId: PaneId; tab: SessionTab } | null {
  for (const [paneId, pane] of panes.entries()) {
    const tab = pane.tabs.find((entry) => entry.piSessionId === piSessionId);
    if (tab) return { paneId, tab };
  }
  return null;
}

function focusExistingSession(
  state: WorkspaceState,
  paneId: PaneId,
  tabId: string,
): WorkspaceState {
  const pane = state.panesById.get(paneId);
  if (!pane || !pane.tabs.some((tab) => tab.id === tabId)) return state;
  return {
    ...setPane(state, paneId, { ...pane, activeTabId: tabId }),
    focusedPaneId: paneId,
  };
}

function addTabToPane(state: WorkspaceState, paneId: PaneId, tab: SessionTab): WorkspaceState {
  const pane = state.panesById.get(paneId);
  if (!pane || !isSessionTab(tab)) return state;
  return {
    ...setPane(state, paneId, { ...pane, tabs: [...pane.tabs, tab], activeTabId: tab.id }),
    focusedPaneId: paneId,
  };
}

function copyTab(sourceTab: SessionTab, fallback: SessionTab | undefined): SessionTab | null {
  if (!isSessionTab(fallback)) return null;
  return { ...sourceTab, id: fallback.id, runtimeSessionId: fallback.runtimeSessionId };
}

function createPane(tab: SessionTab, runtimeSessionId: string): PaneState {
  return { tabs: [tab], activeTabId: tab.id, runtimeSessionId };
}

export function setWorkspaceLayout(
  state: WorkspaceState,
  payload: { layout: WorkspaceLayout },
): WorkspaceState {
  try {
    return collectLeaves(payload.layout).length > 0 ? { ...state, layout: payload.layout } : state;
  } catch {
    return state;
  }
}

export function setWorkspaceSplitRatio(
  state: WorkspaceState,
  payload: { path: number[]; ratio: number },
): WorkspaceState {
  if (!Array.isArray(payload.path) || !Number.isFinite(payload.ratio)) return state;
  return { ...state, layout: setLayoutSplitRatio(state.layout, payload.path, payload.ratio) };
}

export function restorePaneState(
  state: WorkspaceState,
  payload: {
    layout: WorkspaceLayout;
    panesById: ReadonlyMap<PaneId, PaneState>;
    focusedPaneId: PaneId;
  },
): WorkspaceState {
  if (!payload.panesById.has(payload.focusedPaneId)) return state;
  const leaves = collectLeaves(payload.layout);
  if (leaves.length === 0 || leaves.some((paneId) => !payload.panesById.has(paneId))) {
    return state;
  }
  return {
    ...state,
    layout: payload.layout,
    panesById: new Map(payload.panesById),
    focusedPaneId: payload.focusedPaneId,
    hydrated: true,
  };
}

export function openNewSessionInFocusedPane(
  state: WorkspaceState,
  payload: OpenNewSessionPayload,
): WorkspaceState {
  const pane = state.panesById.get(state.focusedPaneId);
  if (!pane) return state;
  const selectedProjectState = payload.project
    ? {
        ...state,
        selectedProjectId: payload.project.id,
        agentCwd: payload.project.path,
      }
    : state;
  const existing = pane.tabs.find((tab) => {
    if (!isEmptyStarterTab(tab)) return false;
    if (payload.project?.id && tab.projectId && tab.projectId !== payload.project.id) return false;
    if (payload.project?.path && tab.cwd && tab.cwd !== payload.project.path) return false;
    return true;
  });
  if (existing) {
    return setPane(selectedProjectState, selectedProjectState.focusedPaneId, {
      ...pane,
      tabs: pane.tabs.map((tab) =>
        tab.id === existing.id && payload.project
          ? { ...tab, projectId: payload.project.id, cwd: payload.project.path }
          : tab,
      ),
      activeTabId: existing.id,
    });
  }
  if (!isSessionTab(payload.tab)) return selectedProjectState;
  const tab = {
    ...payload.tab,
    projectId: payload.project?.id,
    cwd: payload.project?.path,
  };
  return setPane(selectedProjectState, selectedProjectState.focusedPaneId, {
    ...pane,
    tabs: [...pane.tabs, tab],
    activeTabId: tab.id,
  });
}

export function replaySessionInFocusedPane(
  state: WorkspaceState,
  payload: ReplaySessionPayload,
): WorkspaceState {
  if (!payload.piSessionId) return state;
  const existing = findPaneTabByPiSessionId(state.panesById, payload.piSessionId);
  if (existing) return focusExistingSession(state, existing.paneId, existing.tab.id);
  const pane = state.panesById.get(state.focusedPaneId);
  if (!pane) return state;
  const active = pane.tabs.find((tab) => tab.id === pane.activeTabId);
  const targetTab = active && isEmptyStarterTab(active) ? active : null;
  if (!targetTab && !isSessionTab(payload.tab)) return state;
  const replayTab = targetTab
    ? {
        ...targetTab,
        piSessionId: payload.piSessionId,
        title: replaySessionTitle(payload.sessionTitle, targetTab.title || "Loading session"),
      }
    : {
        ...payload.tab!,
        piSessionId: payload.piSessionId,
        title: replaySessionTitle(payload.sessionTitle),
      };
  const nextTabs = targetTab
    ? pane.tabs.map((tab) => (tab.id === targetTab.id ? replayTab : tab))
    : [...pane.tabs, replayTab];
  return setPane(state, state.focusedPaneId, {
    ...pane,
    tabs: nextTabs,
    activeTabId: replayTab.id,
  });
}

export function replaySessionInSplitPane(
  state: WorkspaceState,
  payload: ReplaySessionInSplitPayload,
): WorkspaceState {
  if (!payload.piSessionId) return state;
  const existing = findPaneTabByPiSessionId(state.panesById, payload.piSessionId);
  if (existing) return focusExistingSession(state, existing.paneId, existing.tab.id);
  if (!isSessionTab(payload.tab)) return state;
  const leaves = collectLeaves(state.layout);
  if (leaves.length >= 2) {
    const targetPaneId = leaves.find((id) => id !== state.focusedPaneId) ?? state.focusedPaneId;
    return addTabToPane(state, targetPaneId, {
      ...payload.tab,
      piSessionId: payload.piSessionId,
      title: replaySessionTitle(payload.sessionTitle),
    });
  }
  if (!validPaneRuntime(payload.paneId, payload.runtimeSessionId)) return state;
  const paneId = payload.paneId;
  const runtimeSessionId = payload.runtimeSessionId;
  if (!paneId || !runtimeSessionId || !leafExists(state, state.focusedPaneId)) return state;
  const tab = {
    ...payload.tab,
    piSessionId: payload.piSessionId,
    title: replaySessionTitle(payload.sessionTitle),
  };
  const nextPanes = new Map(state.panesById);
  nextPanes.set(paneId, createPane(tab, runtimeSessionId));
  return {
    ...state,
    panesById: nextPanes,
    layout: splitLeaf(state.layout, state.focusedPaneId, paneId, "vertical", "b"),
    focusedPaneId: paneId,
  };
}

export function openSessionPayloadInPane(
  state: WorkspaceState,
  payload: OpenSessionPayloadInPanePayload,
): WorkspaceState {
  if (!paneExists(state, payload.paneId)) return state;
  if (payload.payload.piSessionId) {
    const existing = findPaneTabByPiSessionId(state.panesById, payload.payload.piSessionId);
    if (existing) return focusExistingSession(state, existing.paneId, existing.tab.id);
    if (!isSessionTab(payload.tab)) return state;
    return addTabToPane(state, payload.paneId, {
      ...payload.tab,
      projectId: payload.payload.projectId,
      cwd: payload.payload.cwd,
      piSessionId: payload.payload.piSessionId,
      title: payload.payload.title ?? "Loading session",
    });
  }
  if (payload.payload.paneId && payload.payload.tabId) {
    const source = state.panesById.get(payload.payload.paneId);
    const sourceTab = source?.tabs.find((tab) => tab.id === payload.payload.tabId);
    if (!sourceTab) return state;
    const tab = copyTab(sourceTab, payload.tab);
    return tab ? addTabToPane(state, payload.paneId, tab) : state;
  }
  return { ...state, focusedPaneId: payload.paneId };
}

export function splitPaneWithPayload(
  state: WorkspaceState,
  payload: SplitPaneWithPayloadPayload,
): WorkspaceState {
  if (!leafExists(state, payload.paneId)) return state;
  if (payload.payload.piSessionId) {
    const existing = findPaneTabByPiSessionId(state.panesById, payload.payload.piSessionId);
    if (existing) return focusExistingSession(state, existing.paneId, existing.tab.id);
  }
  if (collectLeaves(state.layout).length >= 2) return state;
  if (!validPaneRuntime(payload.newPaneId, payload.runtimeSessionId)) return state;
  const newPaneId = payload.newPaneId;
  const runtimeSessionId = payload.runtimeSessionId;
  if (!newPaneId || !runtimeSessionId || !isSessionTab(payload.tab)) return state;
  const baseTab = {
    ...payload.tab,
    projectId: payload.payload.projectId,
    cwd: payload.payload.cwd,
    piSessionId: payload.payload.piSessionId ?? null,
    title: payload.payload.title ?? "Loading session",
  };
  const source = payload.payload.paneId ? state.panesById.get(payload.payload.paneId) : null;
  const sourceTab = source?.tabs.find((tab) => tab.id === payload.payload.tabId);
  const copied = !payload.payload.piSessionId && sourceTab ? copyTab(sourceTab, baseTab) : null;
  const tab = copied ?? baseTab;
  const nextPanes = new Map(state.panesById);
  nextPanes.set(newPaneId, createPane(tab, runtimeSessionId));
  return {
    ...state,
    panesById: nextPanes,
    layout: splitLeaf(state.layout, payload.paneId, newPaneId, payload.direction, payload.side),
    focusedPaneId: newPaneId,
  };
}

export function focusPane(state: WorkspaceState, payload: { paneId: PaneId }): WorkspaceState {
  return paneExists(state, payload.paneId) ? { ...state, focusedPaneId: payload.paneId } : state;
}

export function focusTab(
  state: WorkspaceState,
  payload: { paneId: PaneId; tabId: string },
): WorkspaceState {
  return focusExistingSession(state, payload.paneId, payload.tabId);
}

export function renameTab(
  state: WorkspaceState,
  payload: { paneId: PaneId; tabId: string; title: string },
): WorkspaceState {
  const pane = state.panesById.get(payload.paneId);
  if (!pane || !pane.tabs.some((tab) => tab.id === payload.tabId)) return state;
  return setPane(state, payload.paneId, {
    ...pane,
    tabs: pane.tabs.map((tab) =>
      tab.id === payload.tabId ? { ...tab, title: payload.title } : tab,
    ),
  });
}

export function splitTabIntoNewPane(
  state: WorkspaceState,
  payload: SplitTabPayload,
): WorkspaceState {
  const leaves = collectLeaves(state.layout);
  const source = state.panesById.get(payload.sourcePaneId);
  const sourceTab = source?.tabs.find((tab) => tab.id === payload.sourceTabId);
  if (!sourceTab || !isSessionTab(payload.tab)) return state;
  const tab = copyTab(sourceTab, payload.tab);
  if (!tab) return state;
  if (leaves.length >= 2) {
    const targetPaneId =
      leaves.find((leafId) => leafId !== state.focusedPaneId) ?? state.focusedPaneId;
    return addTabToPane(state, targetPaneId, tab);
  }
  if (!validPaneRuntime(payload.newPaneId, payload.runtimeSessionId)) return state;
  const newPaneId = payload.newPaneId;
  const runtimeSessionId = payload.runtimeSessionId;
  if (!newPaneId || !runtimeSessionId || !leafExists(state, state.focusedPaneId)) return state;
  const nextPanes = new Map(state.panesById);
  nextPanes.set(newPaneId, createPane(tab, runtimeSessionId));
  return {
    ...state,
    panesById: nextPanes,
    layout: splitLeaf(state.layout, state.focusedPaneId, newPaneId, "vertical", "b"),
    focusedPaneId: newPaneId,
  };
}

export function closePane(state: WorkspaceState, payload: { paneId: PaneId }): WorkspaceState {
  const leaves = collectLeaves(state.layout);
  if (leaves.length <= 1 || !leaves.includes(payload.paneId)) return state;
  const nextLayout = removeLeaf(state.layout, payload.paneId) ?? state.layout;
  const nextPanes = new Map(state.panesById);
  nextPanes.delete(payload.paneId);
  const remaining = leaves.filter((id) => id !== payload.paneId);
  return {
    ...state,
    layout: nextLayout,
    panesById: nextPanes,
    focusedPaneId:
      state.focusedPaneId === payload.paneId
        ? (remaining[0] ?? state.focusedPaneId)
        : state.focusedPaneId,
  };
}

export function setPaneTabs(
  state: WorkspaceState,
  payload: { paneId: PaneId; tabs: SessionTab[] },
): WorkspaceState {
  const pane = state.panesById.get(payload.paneId);
  if (!pane || !Array.isArray(payload.tabs) || payload.tabs.length === 0) return state;
  const activeTabId = payload.tabs.some((tab) => tab.id === pane.activeTabId)
    ? pane.activeTabId
    : payload.tabs[0].id;
  return setPane(state, payload.paneId, { ...pane, tabs: payload.tabs, activeTabId });
}

export function patchActiveTab(
  state: WorkspaceState,
  payload: { paneId: PaneId; patch: Partial<SessionTab> },
): WorkspaceState {
  const pane = state.panesById.get(payload.paneId);
  if (!pane || !pane.tabs.some((tab) => tab.id === pane.activeTabId)) return state;
  return setPane(state, payload.paneId, {
    ...pane,
    tabs: pane.tabs.map((tab) =>
      tab.id === pane.activeTabId ? { ...tab, ...payload.patch } : tab,
    ),
  });
}

export function applyUrlNavigation(
  state: WorkspaceState,
  payload: UrlNavigationPayload,
): WorkspaceState {
  if (state.lastHandledNavKey === payload.key) return state;
  if (!payload.projectId && !payload.sessionId && !payload.newSession) return state;

  if (payload.projectId) {
    const target = state.projects.find((entry) => entry.id === payload.projectId);
    if (!target) return state;
    if (state.selectedProjectId !== target.id || state.agentCwd !== target.path) {
      return {
        ...state,
        selectedProjectId: target.id,
        agentCwd: target.path,
      };
    }
  }

  const marked = { ...state, lastHandledNavKey: payload.key };
  if (payload.newSession && !payload.sessionId) {
    return openNewSessionInFocusedPane(marked, { tab: payload.tab });
  }
  if (payload.sessionId && payload.split) {
    return replaySessionInSplitPane(marked, {
      piSessionId: payload.sessionId,
      sessionTitle: payload.sessionTitle,
      tab: payload.tab,
      paneId: payload.paneId,
      runtimeSessionId: payload.runtimeSessionId,
    });
  }
  if (payload.sessionId) {
    return replaySessionInFocusedPane(marked, {
      piSessionId: payload.sessionId,
      sessionTitle: payload.sessionTitle,
      tab: payload.tab,
    });
  }
  return marked;
}
