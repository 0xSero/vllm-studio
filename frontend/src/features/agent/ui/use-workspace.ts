"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { safeJson } from "@/features/agent/safe-json";
import { clampComputerWidth, gentlySnapComputerWidth } from "@/features/agent/tools/persistence";
import { createInitialState, reducer } from "@/features/agent/workspace/store";
import { createSessionReplayQueue } from "@/features/agent/workspace/replay-queue";
import { makeFreshTab, newPaneId } from "@/features/agent/messages/helpers";
import {
  runWorkspaceEffect,
  type BrowserEventsSubscription,
  type WorkspaceDispatch,
  type WorkspaceEffectDeps,
  type WorkspaceWindow,
} from "@/features/agent/workspace/effects";
import type {
  AgentModel,
  PaneId,
  WorkspaceAction,
  WorkspaceState,
} from "@/features/agent/workspace/types";
import { useProjects } from "@/features/agent/projects/context";
import { useTools } from "@/features/agent/tools/context";
import { getApiKey, getStoredBackendUrl } from "@/lib/api/connection";
import { loadSavedControllers, normalizeControllerUrl } from "@/lib/api/controllers";
import {
  sanitizeBrowserPaneUrl,
  sanitizeLocalFileUrl,
} from "@/features/agent/sanitize-embedded-browser-url";
import type { Project } from "@/features/agent/projects/types";
import { paneSessions } from "@/features/agent/runtime/selectors";
import {
  runBrowserPanelCommand,
  type BrowserCommandResult,
} from "@/features/agent/browser/command";
import {
  browserHostIsReady,
  browserSessionIsKnown,
  createBrowserEvents,
  focusedBrowserSessionId,
  waitForBrowserHost,
} from "@/features/agent/ui/use-workspace-browser-events";
import {
  useBrowserEventsEffects,
  useWorkspaceHydrationEffects,
  useWorkspaceRuntimeSync,
} from "@/features/agent/ui/use-workspace-effects";
import type { ChatPaneHandle, SessionTab } from "@/features/agent/ui/chat-pane";
import type { AgentBrowserHandle } from "@/features/agent/ui/agent-browser";
import type { SessionDropPayload } from "@/features/agent/ui/pane-grid";

export type WorkspaceHandles = {
  registerBrowserHandle: (handle: AgentBrowserHandle | null) => void;
  registerComputerAside: (element: HTMLElement | null) => void;
  openSessionPayloadInPane: (paneId: PaneId, payload: SessionDropPayload) => void;
  renameTab: (paneId: PaneId, tabId: string, title: string) => void;
  splitTabIntoNewPane: (paneId: PaneId, tabId: string) => void;
  registerPaneHandle: (paneId: PaneId, handle: ChatPaneHandle | null) => void;
  compactFocusedSession: () => Promise<void>;
  runBrowserCommand: (
    verb: string,
    payload: Record<string, unknown>,
  ) => Promise<BrowserCommandResult>;
  setSplitRatio: (path: number[], ratio: number) => void;
  setPaneTabs: (
    paneId: PaneId,
    tabs: SessionTab[] | ((tabs: SessionTab[]) => SessionTab[]),
  ) => void;
  closePane: (paneId: PaneId) => void;
  splitPaneWithPayload: (
    paneId: PaneId,
    direction: "vertical" | "horizontal",
    side: "a" | "b",
    payload: SessionDropPayload,
  ) => void;
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

function agentModelControllersPayload() {
  const byUrl = new Map<string, { url: string; apiKey?: string; name?: string }>();
  const activeUrl = normalizeControllerUrl(getStoredBackendUrl());
  if (activeUrl) {
    const activeApiKey = getApiKey();
    byUrl.set(activeUrl, {
      url: activeUrl,
      ...(activeApiKey ? { apiKey: activeApiKey } : {}),
      name: "primary",
    });
  }
  for (const controller of loadSavedControllers()) {
    const url = normalizeControllerUrl(controller.url);
    if (!url) continue;
    const existing = byUrl.get(url);
    byUrl.set(url, {
      ...existing,
      url,
      ...(controller.apiKey || existing?.apiKey
        ? { apiKey: controller.apiKey || existing?.apiKey }
        : {}),
      ...(controller.name || existing?.name ? { name: controller.name || existing?.name } : {}),
    });
  }
  return [...byUrl.values()];
}

async function loadAgentModelsPayload(): Promise<{ models?: AgentModel[]; error?: string }> {
  const response = await fetch("/api/agent/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ controllers: agentModelControllersPayload() }),
  });
  const payload = await safeJson<{ models?: AgentModel[]; error?: string }>(response);
  if (!response.ok) throw new Error(payload.error || "Failed to load models");
  return payload;
}

function api(): WorkspaceEffectDeps["api"] {
  return {
    loadSetupChecks: async () => {
      const response = await fetch("/api/agent/setup-checks", { cache: "no-store" });
      return safeJson<{ checks?: Array<{ id: string; ok: boolean; guidance?: string }> }>(response);
    },
    loadModels: async () => {
      return loadAgentModelsPayload();
    },
  };
}

export function useWorkspace(): UseWorkspaceResult {
  const projects = useProjects();
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const tools = useTools();
  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  const [state, setState] = useState<WorkspaceState>(createInitialState);
  const stateRef = useRef(state);
  const paneHandlesRef = useRef<Map<PaneId, ChatPaneHandle>>(new Map());
  const browserRef = useRef<AgentBrowserHandle | null>(null);
  const computerAsideRef = useRef<HTMLElement | null>(null);

  const replayQueue = useMemo(
    () =>
      createSessionReplayQueue({
        getHandle: (paneId) => paneHandlesRef.current.get(paneId),
        getState: () => stateRef.current,
        setTimeout: (handler, delay) => window.setTimeout(handler, delay),
      }),
    [],
  );
  const queueSessionReplay = replayQueue.queue;

  const controller = useMemo(() => {
    let browserEvents: BrowserEventsSubscription | null = null;
    const getBrowserEvents = () => {
      browserEvents ??= createBrowserEvents(runBrowserCommand, (sessionId) => ({
        focused: focusedBrowserSessionId(stateRef.current),
        known: browserSessionIsKnown(stateRef.current, sessionId),
      }));
      return browserEvents;
    };
    const makeDeps = (workspaceDispatch: WorkspaceDispatch): WorkspaceEffectDeps | null => {
      if (typeof window === "undefined") return null;
      return {
        storage: window.localStorage,
        window: createWorkspaceWindow(window),
        api: api(),
        dispatch: workspaceDispatch,
        queueReplay: queueSessionReplay,
        browserEvents: getBrowserEvents(),
        findProjectById: (id) => projectsRef.current.findById(id),
        selectionFor: (id) => toolsRef.current.selectionFor(id),
      };
    };

    const workspaceDispatch: WorkspaceDispatch = (action: WorkspaceAction) => {
      const prev = stateRef.current;
      const next = reducer(prev, action);
      if (action.type === "workspaceUnmounted") {
        const deps = makeDeps(workspaceDispatch);
        if (deps) runWorkspaceEffect(action, prev, next, deps);
        return;
      }
      stateRef.current = next;
      setState(next);
      const deps = makeDeps(workspaceDispatch);
      if (deps) runWorkspaceEffect(action, prev, next, deps);
    };

    const runBrowserCommand = async (
      verb: string,
      payload: Record<string, unknown>,
    ): Promise<BrowserCommandResult> => {
      const isElectron = typeof navigator !== "undefined" && /electron/i.test(navigator.userAgent);
      const currentTools = toolsRef.current;
      const hadBrowserHost = browserHostIsReady(browserRef.current, isElectron);
      // A `navigate` is real, intentional browser use: open the panel so the
      // webview host mounts and the user can watch. Passive verbs (get-url,
      // get-text, screenshot, etc.) only register/select the browser tab without
      // popping the panel — that combination fixes both the "browser opens on
      // every prompt" annoyance and the model losing browser access when the
      // panel is closed.
      currentTools.setBrowserEnabled(true);
      if (verb === "navigate") {
        currentTools.setComputerTab("browser");
        const raw = String(payload.url || "");
        const nextUrl = /^file:\/\//i.test(raw)
          ? sanitizeLocalFileUrl(raw)
          : sanitizeBrowserPaneUrl(raw);
        if (nextUrl && !hadBrowserHost) currentTools.setBrowserUrl(nextUrl, nextUrl);
      } else {
        currentTools.selectComputerTabWithoutOpening("browser");
      }
      if (verb !== "get-url") {
        await waitForBrowserHost(() => browserRef.current, isElectron);
      }
      return runBrowserPanelCommand(verb, payload, {
        browser: browserRef.current,
        currentUrl: toolsRef.current.browser.url,
        setBrowserUrl: toolsRef.current.setBrowserUrl,
        isElectron,
      });
    };
    return { browserEvents: getBrowserEvents(), dispatch: workspaceDispatch, runBrowserCommand };
  }, [queueSessionReplay]);

  const { browserEvents, dispatch, runBrowserCommand } = controller;

  useBrowserEventsEffects({
    browserEvents,
    enabled: tools.browser.enabled && tools.computer.open && tools.computer.tab === "browser",
  });

  const subscribeWorkspaceModelStorage = useCallback(
    (_notify: () => void) => {
      if (typeof window === "undefined") return () => {};
      const reload = () => {
        dispatch({ type: "setModelsLoading", loading: true });
        dispatch({ type: "setError", error: "" });
        void loadAgentModelsPayload()
          .then((models) => {
            dispatch({ type: "setModels", models: models.models ?? [] });
          })
          .catch((error) => {
            dispatch({
              type: "setError",
              error: error instanceof Error ? error.message : String(error),
            });
            dispatch({ type: "setModels", models: [] });
          })
          .finally(() => dispatch({ type: "setModelsLoading", loading: false }));
      };
      const onStorage = (event: StorageEvent | Event) => {
        const key = (event as StorageEvent).key;
        if (key && key !== "localstudio_backend_url" && key !== "local-studio.controllers") return;
        reload();
      };
      // Models load once on hydrate; a transient empty/failed initial fetch
      // (controller briefly slow, model not yet launched, a network blip) would
      // otherwise strand the picker on "No models" until a manual page reload.
      // Recover when the user refocuses the window or the network returns — but
      // only when the list is actually empty and not already loading, so a
      // populated picker is never re-churned.
      const recoverIfEmpty = () => {
        if (stateRef.current.models.length === 0 && !stateRef.current.modelsLoading) reload();
      };
      // The initial hydrate load can lose the startup race with the embedded
      // proxy / controller coming up (a transient "fetch failed"), leaving the
      // list empty with no focus event to recover it (the window is already
      // focused on first paint). Retry a few times, backing off, until the list
      // populates — then the timers no-op.
      const retryTimers = [900, 2500, 6000].map((ms) => window.setTimeout(recoverIfEmpty, ms));
      window.addEventListener("storage", onStorage);
      window.addEventListener("focus", recoverIfEmpty);
      window.addEventListener("online", recoverIfEmpty);
      return () => {
        for (const t of retryTimers) window.clearTimeout(t);
        window.removeEventListener("storage", onStorage);
        window.removeEventListener("focus", recoverIfEmpty);
        window.removeEventListener("online", recoverIfEmpty);
      };
    },
    [dispatch],
  );

  useSyncExternalStore(
    subscribeWorkspaceModelStorage,
    getWorkspaceModelStorageSnapshot,
    getWorkspaceModelStorageSnapshot,
  );

  const handles = useMemo<WorkspaceHandles>(
    () => ({
      registerBrowserHandle: (handle: AgentBrowserHandle | null) => {
        browserRef.current = handle;
      },
      registerComputerAside: (element: HTMLElement | null) => {
        computerAsideRef.current = element;
      },
      openSessionPayloadInPane: (paneId: PaneId, payload: SessionDropPayload) =>
        dispatch({ type: "openSessionPayloadInPane", paneId, payload, tab: makeFreshTab() }),
      renameTab: (paneId: PaneId, tabId: string, title: string) =>
        dispatch({ type: "renameTab", paneId, tabId, title }),
      splitTabIntoNewPane: (paneId: PaneId, tabId: string) =>
        dispatch({
          type: "splitTab",
          sourcePaneId: paneId,
          sourceTabId: tabId,
          newPaneId: newPaneId(),
          tab: makeFreshTab(),
        }),
      registerPaneHandle: (paneId: PaneId, handle: ChatPaneHandle | null) => {
        if (handle) paneHandlesRef.current.set(paneId, handle);
        else paneHandlesRef.current.delete(paneId);
        if (handle) replayQueue.notifyHandleRegistered(paneId);
      },
      compactFocusedSession: async () => {
        const handle = paneHandlesRef.current.get(stateRef.current.focusedPaneId);
        await handle?.compact();
      },
      runBrowserCommand,
      setSplitRatio: (path: number[], ratio: number) =>
        dispatch({ type: "setSplitRatio", path, ratio }),
      setPaneTabs: (
        paneId: PaneId,
        tabs: SessionTab[] | ((tabs: SessionTab[]) => SessionTab[]),
      ) => {
        const pane = stateRef.current.panesById.get(paneId);
        if (!pane) return;
        const current = paneSessions(stateRef.current, paneId);
        const next = typeof tabs === "function" ? tabs(current) : tabs;
        const session = next.at(-1) ?? current[0];
        if (!session) return;
        dispatch({
          type: "setPaneSession",
          paneId,
          session,
        });
      },
      closePane: (paneId: PaneId) => dispatch({ type: "closePane", paneId }),
      splitPaneWithPayload: (
        paneId: PaneId,
        direction: "vertical" | "horizontal",
        side: "a" | "b",
        payload: SessionDropPayload,
      ) =>
        dispatch({
          type: "splitPaneWithPayload",
          paneId,
          direction,
          side,
          payload,
          newPaneId: newPaneId(),
          tab: makeFreshTab(),
        }),
      selectPaneModel: (paneId: PaneId, modelId: string) =>
        dispatch({ type: "patchActiveTab", paneId, patch: { modelId } }),
      notifySessionsChanged: () => dispatch({ type: "notifySessionsChanged" }),
      startComputerResize: (event: ReactMouseEvent<HTMLDivElement>) => {
        if (typeof window === "undefined") return;
        event.preventDefault();
        const startX = event.clientX;
        const startWidth =
          computerAsideRef.current?.getBoundingClientRect().width ??
          toolsRef.current.computer.width;
        const containerWidth =
          computerAsideRef.current?.parentElement?.getBoundingClientRect().width ??
          window.innerWidth;
        let frame = 0;
        if (computerAsideRef.current) computerAsideRef.current.style.transition = "none";
        const onMove = (moveEvent: MouseEvent) => {
          const next = clampComputerWidth(startWidth + startX - moveEvent.clientX, containerWidth);
          if (frame) cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            if (computerAsideRef.current) computerAsideRef.current.style.width = `${next}px`;
          });
        };
        const onUp = (upEvent: MouseEvent) => {
          if (frame) cancelAnimationFrame(frame);
          const raw = startWidth + startX - upEvent.clientX;
          const next = gentlySnapComputerWidth(raw, containerWidth);
          if (computerAsideRef.current) {
            computerAsideRef.current.style.transition =
              "width 150ms cubic-bezier(0.22, 1, 0.36, 1)";
            computerAsideRef.current.style.width = `${next}px`;
            window.setTimeout(() => {
              if (computerAsideRef.current) computerAsideRef.current.style.transition = "";
            }, 170);
          }
          toolsRef.current.setComputerWidth(next);
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      },
      initGitForActiveProject: async () => {
        try {
          await projectsRef.current.initGitForActiveProject();
        } catch (error) {
          dispatch({
            type: "setError",
            error: error instanceof Error ? error.message : "Failed to initialize git repository",
          });
        }
      },
    }),
    [dispatch, replayQueue, runBrowserCommand],
  );

  useWorkspaceHydrationEffects({ dispatch, projectsRef, toolsRef });
  useWorkspaceRuntimeSync({ dispatch, sessions: [...state.sessions.values()] });

  return { state, dispatch, handles };
}

const getWorkspaceModelStorageSnapshot = (): number => 0;
