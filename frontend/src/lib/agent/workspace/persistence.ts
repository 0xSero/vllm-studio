import { collectLeaves } from "@/app/agent/_components/pane-layout";
import type { ActiveAgentSessionSnapshot } from "@/lib/agent/active-sessions";
import type { SessionTab } from "@/app/agent/_components/chat-pane";
import type { ComputerTab, PaneId, PaneState, WorkspaceLayout, WorkspaceState } from "./types";
import {
  BROWSER_TOOL_DEFAULT_OFF_MIGRATION_KEY,
  BROWSER_TOOL_KEY,
  COMPUTER_BROWSER_OPEN_KEY,
  COMPUTER_DEFAULT_CLOSED_STORAGE_ID,
  COMPUTER_FILES_OPEN_KEY,
  COMPUTER_WIDTH_KEY,
  DEFAULT_COMPUTER_WIDTH,
  PANE_LAYOUT_KEY,
  PANE_STATE_KEY,
  SELECTED_PROJECT_KEY,
  clampComputerWidth,
  newRuntimeId,
  persistActiveAgentSessions,
  randomIdSegment,
  restorePersistedPaneState,
  tabForPersistence,
  type WorkspaceStorage,
} from "./store";

const SESSIONS_COLLAPSED_KEY = "vllm-studio.agent.sessionsCollapsed";
const SESSIONS_COLLAPSED_CLEANED_KEY = "vllm-studio.agent.sessionsCollapsedCleaned";

function readStorage(storage: WorkspaceStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function setStorage(storage: WorkspaceStorage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore quota/private-mode failures; workspace state remains in memory.
  }
}

function removeStorage(storage: WorkspaceStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage failures; migrations are best-effort.
  }
}

function newTabId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${randomIdSegment(8)}`;
}

function makeFreshPersistedTab(): SessionTab {
  return {
    id: newTabId("tab"),
    runtimeSessionId: newTabId("rt"),
    piSessionId: null,
    title: "New session",
    messages: [],
    status: "idle",
    error: "",
    input: "",
  };
}

function restoreLegacyLayout(rawLayout: string): {
  layout: WorkspaceLayout;
  panesById: Map<PaneId, PaneState>;
  focusedPaneId: PaneId;
} | null {
  try {
    const layout = JSON.parse(rawLayout) as WorkspaceLayout;
    if (!layout || typeof layout !== "object") return null;
    const leaves = collectLeaves(layout);
    if (leaves.length === 0) return null;
    const panesById = new Map<PaneId, PaneState>();
    for (const paneId of leaves) {
      const tab = makeFreshPersistedTab();
      panesById.set(paneId, {
        tabs: [tab],
        activeTabId: tab.id,
        runtimeSessionId: newRuntimeId(),
      });
    }
    return { layout, panesById, focusedPaneId: leaves[0] };
  } catch {
    return null;
  }
}

function migrateStorage(storage: WorkspaceStorage): void {
  if (!readStorage(storage, SESSIONS_COLLAPSED_CLEANED_KEY)) {
    removeStorage(storage, SESSIONS_COLLAPSED_KEY);
    setStorage(storage, SESSIONS_COLLAPSED_CLEANED_KEY, "1");
  }

  if (!readStorage(storage, BROWSER_TOOL_DEFAULT_OFF_MIGRATION_KEY)) {
    setStorage(storage, BROWSER_TOOL_KEY, "0");
    setStorage(storage, BROWSER_TOOL_DEFAULT_OFF_MIGRATION_KEY, "1");
  }

  if (!readStorage(storage, COMPUTER_DEFAULT_CLOSED_STORAGE_ID)) {
    setStorage(storage, COMPUTER_BROWSER_OPEN_KEY, "0");
    setStorage(storage, COMPUTER_FILES_OPEN_KEY, "0");
    setStorage(storage, COMPUTER_DEFAULT_CLOSED_STORAGE_ID, "1");
  }
  setStorage(storage, COMPUTER_BROWSER_OPEN_KEY, "0");
}

export function loadInitialFromStorage(storage: WorkspaceStorage): Partial<WorkspaceState> {
  migrateStorage(storage);

  const storedComputerWidth = Number(readStorage(storage, COMPUTER_WIDTH_KEY));
  const computerTab: ComputerTab =
    readStorage(storage, COMPUTER_FILES_OPEN_KEY) === "1" ? "files" : "browser";
  const initial: Partial<WorkspaceState> = {
    browserToolEnabled: readStorage(storage, BROWSER_TOOL_KEY) === "1",
    computer: {
      open: false,
      tab: computerTab,
      width: Number.isFinite(storedComputerWidth)
        ? clampComputerWidth(storedComputerWidth)
        : DEFAULT_COMPUTER_WIDTH,
    },
  };

  const rawState = readStorage(storage, PANE_STATE_KEY);
  const restoredState = rawState ? restorePersistedPaneState(rawState) : null;
  if (restoredState) {
    return { ...initial, ...restoredState };
  }

  const rawLayout = readStorage(storage, PANE_LAYOUT_KEY);
  const restoredLayout = rawLayout ? restoreLegacyLayout(rawLayout) : null;
  return restoredLayout ? { ...initial, ...restoredLayout } : initial;
}

export function writePaneState(storage: WorkspaceStorage, state: WorkspaceState): void {
  const panes: Record<
    string,
    {
      activeTabId: string;
      runtimeSessionId: string;
      tabs: SessionTab[];
    }
  > = {};
  for (const [paneId, pane] of state.panesById.entries()) {
    panes[paneId] = {
      activeTabId: pane.activeTabId,
      runtimeSessionId: pane.runtimeSessionId,
      tabs: pane.tabs.map(tabForPersistence),
    };
  }
  setStorage(
    storage,
    PANE_STATE_KEY,
    JSON.stringify({ version: 1, layout: state.layout, focusedPaneId: state.focusedPaneId, panes }),
  );
  setStorage(storage, PANE_LAYOUT_KEY, JSON.stringify(state.layout));
}

export function writeSelectedProject(
  storage: WorkspaceStorage,
  selectedProjectId: string | null,
): void {
  if (selectedProjectId) {
    setStorage(storage, SELECTED_PROJECT_KEY, selectedProjectId);
  } else {
    removeStorage(storage, SELECTED_PROJECT_KEY);
  }
}

export function writeComputerTab(storage: WorkspaceStorage, tab: ComputerTab): void {
  setStorage(storage, COMPUTER_FILES_OPEN_KEY, tab === "files" ? "1" : "0");
}

export function writeComputerWidth(storage: WorkspaceStorage, width: number): void {
  setStorage(storage, COMPUTER_WIDTH_KEY, String(clampComputerWidth(width)));
}

export function writeBrowserTool(storage: WorkspaceStorage, enabled: boolean): void {
  setStorage(storage, BROWSER_TOOL_KEY, enabled ? "1" : "0");
}

export function writeActiveSessions(
  storage: WorkspaceStorage,
  sessions: ActiveAgentSessionSnapshot[],
): void {
  try {
    persistActiveAgentSessions(sessions, storage);
  } catch {
    // Ignore quota/private-mode failures; the broadcast still updates listeners.
  }
}
