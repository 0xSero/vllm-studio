"use client";

import { useEffect, useMemo, useReducer, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { PROJECTS_CHANGED_EVENT, loadAgentProjects } from "@/components/projects-nav-section";
import { safeJson } from "@/lib/agent/safe-json";
import { loadInitialFromStorage } from "@/lib/agent/workspace/persistence";
import {
  clampComputerWidth,
  createInitialState,
  newPaneId,
  newRuntimeId,
  reducer,
} from "@/lib/agent/workspace/store";
import {
  runWorkspaceEffect,
  subscribeWorkspaceWindowEvents,
  type BrowserEventsSubscription,
  type WorkspaceDispatch,
  type WorkspaceEffectDeps,
  type WorkspaceWindow,
} from "@/lib/agent/workspace/effects";
import type {
  AgentModel,
  GitSummary,
  PaneId,
  ProjectEntry,
  WorkspaceAction,
  WorkspaceState,
} from "@/lib/agent/workspace/types";
import { makeFreshTab, type ChatPaneHandle, type SessionTab } from "./chat-pane";
import type { AgentBrowserHandle } from "./agent-browser";
import { runBrowserPanelCommand, type BrowserCommandResult } from "./agent-browser-panel";
import type { SessionDropPayload } from "./pane-grid";

type BrowserCommand = { id: string; verb: string; payload: Record<string, unknown> };

export type WorkspaceHandles = {
  registerBrowserHandle: (handle: AgentBrowserHandle | null) => void;
  registerComputerAside: (element: HTMLElement | null) => void;
  openNewSessionInFocusedPane: (project?: ProjectEntry) => void;
  replaySessionInFocusedPane: (piSessionId: string) => void;
  replaySessionInSplitPane: (piSessionId: string) => void;
  openSessionPayloadInPane: (paneId: PaneId, payload: SessionDropPayload) => void;
  renameTab: (paneId: PaneId, tabId: string, title: string) => void;
  focusTab: (paneId: PaneId, tabId: string) => void;
  splitTabIntoNewPane: (paneId: PaneId, tabId: string) => void;
  selectProject: (project: ProjectEntry | null) => void;
  setBrowserUrl: (url: string, input?: string) => void;
  setBrowserInput: (input: string) => void;
  setComputerTab: (tab: WorkspaceState["computer"]["tab"]) => void;
  toggleBrowserTool: () => void;
  setComputerWidth: (width: number) => void;
  registerPaneHandle: (paneId: PaneId, handle: ChatPaneHandle | null) => void;
  runBrowserCommand: (
    verb: string,
    payload: Record<string, unknown>,
  ) => Promise<BrowserCommandResult>;
  setComputerOpen: (open: boolean) => void;
  toggleComputerOpen: () => void;
  setSplitRatio: (path: number[], ratio: number) => void;
  setPaneTabs: (
    paneId: PaneId,
    tabs: SessionTab[] | ((tabs: SessionTab[]) => SessionTab[]),
  ) => void;
  patchActiveTab: (paneId: PaneId, patch: Partial<SessionTab>) => void;
  closePane: (paneId: PaneId) => void;
  splitPaneWithPayload: (
    paneId: PaneId,
    direction: "vertical" | "horizontal",
    side: "a" | "b",
    payload: SessionDropPayload,
  ) => void;
  selectPaneProject: (paneId: PaneId, project: ProjectEntry) => void;
  selectPaneModel: (paneId: PaneId, modelId: string) => void;
  notifySessionsChanged: () => void;
  startComputerResize: (event: ReactMouseEvent<HTMLDivElement>) => void;
  initGitForActiveProject: () => Promise<void>;
};

export type UseWorkspaceResult = {
  state: WorkspaceState;
  dispatch: WorkspaceDispatch;
  handles: WorkspaceHandles;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseBrowserCommand(raw: string): BrowserCommand | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    const id = parsed.id;
    const verb = parsed.verb;
    const payload = parsed.payload;
    if (typeof id !== "string" || typeof verb !== "string" || !isRecord(payload)) return null;
    return { id, verb, payload };
  } catch {
    return null;
  }
}

function createWorkspaceWindow(source: Window): WorkspaceWindow {
  return {
    Event,
    CustomEvent,
    dispatchEvent: source.dispatchEvent.bind(source),
    addEventListener: source.addEventListener.bind(source),
    removeEventListener: source.removeEventListener.bind(source),
    setTimeout: source.setTimeout.bind(source),
  };
}

function createBrowserEvents(
  runBrowserCommand: (
    verb: string,
    payload: Record<string, unknown>,
  ) => Promise<BrowserCommandResult>,
): BrowserEventsSubscription {
  let source: EventSource | null = null;
  let enabled = false;

  const close = () => {
    source?.close();
    source = null;
  };

  return {
    setEnabled(nextEnabled) {
      if (enabled === nextEnabled && source) return;
      enabled = nextEnabled;
      close();
      if (!enabled || typeof EventSource === "undefined") return;
      source = new EventSource("/api/agent/browser/events");
      source.onmessage = (event: MessageEvent<unknown>) => {
        if (typeof event.data !== "string") return;
        const command = parseBrowserCommand(event.data);
        if (!command || typeof fetch !== "function") return;
        void runBrowserCommand(command.verb, command.payload)
          .then((result) =>
            fetch("/api/agent/browser/result", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: command.id, ...result }),
            }),
          )
          .catch((error) => {
            console.warn("[agent] browser bridge dispatch failed", error);
          });
      };
    },
    close() {
      enabled = false;
      close();
    },
  };
}

function focusedProjectPath(state: WorkspaceState): string | null {
  const focusedPane = state.panesById.get(state.focusedPaneId);
  const focusedTab = focusedPane?.tabs.find((tab) => tab.id === focusedPane.activeTabId) ?? null;
  const activeProject =
    state.projects.find((entry) => entry.id === state.selectedProjectId) ?? null;
  const focusedProject =
    state.projects.find((entry) => entry.id === focusedTab?.projectId) ??
    state.projects.find((entry) => entry.path === focusedTab?.cwd) ??
    activeProject;
  return focusedProject?.path ?? null;
}

function hasExplicitSessionNav(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return Boolean(params.get("session") || params.get("new"));
}

function api(): WorkspaceEffectDeps["api"] {
  return {
    loadSetupChecks: async () => {
      const response = await fetch("/api/agent/setup-checks", { cache: "no-store" });
      return safeJson<{ checks?: Array<{ id: string; ok: boolean; guidance?: string }> }>(response);
    },
    loadModels: async () => {
      const response = await fetch("/api/agent/models", { cache: "no-store" });
      const payload = await safeJson<{ models?: AgentModel[]; error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || "Failed to load models");
      return payload;
    },
    loadProjects: loadAgentProjects,
    loadGitSummary: async (cwd: string): Promise<GitSummary | null> => {
      const response = await fetch(`/api/agent/git-diff?cwd=${encodeURIComponent(cwd)}`, {
        cache: "no-store",
      });
      const payload = await safeJson<{
        isRepo?: boolean;
        branch?: string | null;
        additions?: number;
        deletions?: number;
        status?: string[];
      }>(response);
      return {
        isRepo: payload.isRepo === true,
        branch: payload.branch ?? null,
        additions: payload.additions ?? 0,
        deletions: payload.deletions ?? 0,
        statusCount: payload.status?.length ?? 0,
      };
    },
  };
}

export function useWorkspace(): UseWorkspaceResult {
  const [state, reducerDispatch] = useReducer(reducer, undefined, createInitialState);
  const stateRef = useRef(state);
  const paneHandlesRef = useRef<Map<PaneId, ChatPaneHandle>>(new Map());
  const pendingSessionReplaysRef = useRef<Map<PaneId, string>>(new Map());
  const browserRef = useRef<AgentBrowserHandle | null>(null);
  const computerAsideRef = useRef<HTMLElement | null>(null);

  const queueSessionReplay = useMemo(
    () => (paneId: PaneId, sessionId: string) => {
      pendingSessionReplaysRef.current.set(paneId, sessionId);
      window.setTimeout(() => {
        const pendingSessionId = pendingSessionReplaysRef.current.get(paneId);
        const handle = paneHandlesRef.current.get(paneId);
        if (!pendingSessionId || !handle) return;
        pendingSessionReplaysRef.current.delete(paneId);
        void handle.loadAndReplay(pendingSessionId);
      }, 0);
    },
    [],
  );

  const controller = useMemo(() => {
    let browserEvents: BrowserEventsSubscription | null = null;
    const getBrowserEvents = () => {
      browserEvents ??= createBrowserEvents(runBrowserCommand);
      return browserEvents;
    };
    const makeDeps = (workspaceDispatch: WorkspaceDispatch): WorkspaceEffectDeps | null => {
      if (typeof window === "undefined") return null;
      return {
        storage: window.localStorage,
        window: createWorkspaceWindow(window),
        api: api(),
        dispatch: workspaceDispatch,
        hasExplicitSessionNav,
        queueReplay: queueSessionReplay,
        browserEvents: getBrowserEvents(),
      };
    };

    const workspaceDispatch: WorkspaceDispatch = (action: WorkspaceAction) => {
      const prev = stateRef.current;
      const next = reducer(prev, action);
      if (action.type === "WORKSPACE_UNMOUNTED") {
        const deps = makeDeps(workspaceDispatch);
        if (deps) runWorkspaceEffect(action, prev, next, deps);
        return;
      }
      stateRef.current = next;
      reducerDispatch(action);
      const deps = makeDeps(workspaceDispatch);
      if (deps) runWorkspaceEffect(action, prev, next, deps);
    };

    const runBrowserCommand = async (
      verb: string,
      payload: Record<string, unknown>,
    ): Promise<BrowserCommandResult> =>
      runBrowserPanelCommand(verb, payload, {
        browser: browserRef.current,
        currentUrl: stateRef.current.browserUrl,
        dispatch: workspaceDispatch,
        isElectron: typeof navigator !== "undefined" && /electron/i.test(navigator.userAgent),
      });
    return { dispatch: workspaceDispatch, runBrowserCommand };
  }, [queueSessionReplay, reducerDispatch]);

  const { dispatch, runBrowserCommand } = controller;

  const handles = useMemo<WorkspaceHandles>(
    () => ({
      registerBrowserHandle: (handle: AgentBrowserHandle | null) => {
        browserRef.current = handle;
      },
      registerComputerAside: (element: HTMLElement | null) => {
        computerAsideRef.current = element;
      },
      openNewSessionInFocusedPane: (project?: ProjectEntry) =>
        dispatch({ type: "OPEN_NEW_SESSION", project }),
      replaySessionInFocusedPane: (piSessionId: string) =>
        dispatch({ type: "REPLAY_SESSION", piSessionId }),
      replaySessionInSplitPane: (piSessionId: string) =>
        dispatch({ type: "REPLAY_SESSION_IN_SPLIT", piSessionId }),
      openSessionPayloadInPane: (paneId: PaneId, payload: SessionDropPayload) =>
        dispatch({ type: "OPEN_SESSION_PAYLOAD_IN_PANE", paneId, payload }),
      renameTab: (paneId: PaneId, tabId: string, title: string) =>
        dispatch({ type: "RENAME_TAB", paneId, tabId, title }),
      focusTab: (paneId: PaneId, tabId: string) => dispatch({ type: "FOCUS_TAB", paneId, tabId }),
      splitTabIntoNewPane: (paneId: PaneId, tabId: string) =>
        dispatch({ type: "SPLIT_TAB", sourcePaneId: paneId, sourceTabId: tabId }),
      selectProject: (project: ProjectEntry | null) =>
        dispatch({ type: "SELECT_PROJECT", project }),
      setBrowserUrl: (url: string, input?: string) =>
        dispatch({ type: "SET_BROWSER_URL", url, input }),
      setBrowserInput: (input: string) => dispatch({ type: "SET_BROWSER_INPUT", input }),
      setComputerTab: (tab: WorkspaceState["computer"]["tab"]) =>
        dispatch({ type: "SET_COMPUTER_TAB", tab }),
      toggleBrowserTool: () => dispatch({ type: "TOGGLE_BROWSER_TOOL" }),
      setComputerWidth: (width: number) => dispatch({ type: "SET_COMPUTER_WIDTH", width }),
      registerPaneHandle: (paneId: PaneId, handle: ChatPaneHandle | null) => {
        if (handle) paneHandlesRef.current.set(paneId, handle);
        else paneHandlesRef.current.delete(paneId);
        const pendingSessionId = pendingSessionReplaysRef.current.get(paneId);
        if (handle && pendingSessionId) queueSessionReplay(paneId, pendingSessionId);
      },
      runBrowserCommand,
      setComputerOpen: (open: boolean) => dispatch({ type: "SET_COMPUTER_OPEN", open }),
      toggleComputerOpen: () => dispatch({ type: "TOGGLE_COMPUTER_OPEN" }),
      setSplitRatio: (path: number[], ratio: number) =>
        dispatch({ type: "SET_SPLIT_RATIO", path, ratio }),
      setPaneTabs: (
        paneId: PaneId,
        tabs: SessionTab[] | ((tabs: SessionTab[]) => SessionTab[]),
      ) => {
        const pane = stateRef.current.panesById.get(paneId);
        if (!pane) return;
        dispatch({
          type: "SET_PANE_TABS",
          paneId,
          tabs: typeof tabs === "function" ? tabs(pane.tabs) : tabs,
        });
      },
      patchActiveTab: (paneId: PaneId, patch: Partial<SessionTab>) =>
        dispatch({ type: "PATCH_ACTIVE_TAB", paneId, patch }),
      closePane: (paneId: PaneId) => dispatch({ type: "CLOSE_PANE", paneId }),
      splitPaneWithPayload: (
        paneId: PaneId,
        direction: "vertical" | "horizontal",
        side: "a" | "b",
        payload: SessionDropPayload,
      ) =>
        dispatch({
          type: "SPLIT_PANE_WITH_PAYLOAD",
          paneId,
          direction,
          side,
          payload,
          newPaneId: newPaneId(),
          runtimeSessionId: newRuntimeId(),
          tab: makeFreshTab(),
        }),
      selectPaneProject: (paneId: PaneId, project: ProjectEntry) =>
        dispatch({
          type: "PATCH_ACTIVE_TAB",
          paneId,
          patch: { projectId: project.id, cwd: project.path },
        }),
      selectPaneModel: (paneId: PaneId, modelId: string) =>
        dispatch({ type: "PATCH_ACTIVE_TAB", paneId, patch: { modelId } }),
      notifySessionsChanged: () => dispatch({ type: "NOTIFY_SESSIONS_CHANGED" }),
      startComputerResize: (event: ReactMouseEvent<HTMLDivElement>) => {
        if (typeof window === "undefined") return;
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = stateRef.current.computer.width;
        let frame = 0;
        const onMove = (moveEvent: MouseEvent) => {
          const next = clampComputerWidth(startWidth + startX - moveEvent.clientX);
          if (frame) cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            if (computerAsideRef.current) computerAsideRef.current.style.width = `${next}px`;
          });
        };
        const onUp = (upEvent: MouseEvent) => {
          if (frame) cancelAnimationFrame(frame);
          const next = clampComputerWidth(startWidth + startX - upEvent.clientX);
          if (computerAsideRef.current) computerAsideRef.current.style.width = `${next}px`;
          dispatch({ type: "SET_COMPUTER_WIDTH", width: next });
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      },
      initGitForActiveProject: async () => {
        const cwd = focusedProjectPath(stateRef.current);
        if (!cwd) return;
        const response = await fetch(`/api/agent/git-diff?cwd=${encodeURIComponent(cwd)}`, {
          method: "POST",
        });
        if (!response.ok) {
          const payload = await safeJson<{ error?: string }>(response);
          dispatch({
            type: "setError",
            error: payload.error || "Failed to initialize git repository",
          });
          return;
        }
        const summary = await api().loadGitSummary?.(cwd);
        dispatch({ type: "setGitSummary", cwd, summary: summary ?? null });
        window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
      },
    }),
    [dispatch, queueSessionReplay, runBrowserCommand],
  );

  useEffect(() => {
    const hydrated = loadInitialFromStorage(window.localStorage);
    dispatch({ type: "HYDRATE", payload: hydrated });
    const unsub = subscribeWorkspaceWindowEvents(window, dispatch);
    return unsub;
  }, []);

  return { state, dispatch, handles };
}
