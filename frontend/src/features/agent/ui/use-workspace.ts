"use client";

import { useCallback, useMemo, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { useStore } from "zustand";
import { safeJson } from "@/features/agent/safe-json";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { clampComputerWidth, gentlySnapComputerWidth } from "@/features/agent/tools/persistence";
import { ephemeralWorkspaceStore, workspaceStore } from "@/features/agent/workspace/store";
import { makeFreshTab, newPaneId } from "@/features/agent/messages/helpers";
import {
  runWorkspaceEffect,
  refreshWorkspaceModels,
  scheduleSessionsRefresh,
  type WorkspaceDispatch,
  type WorkspaceEffectDeps,
} from "@/features/agent/workspace/effects";
import type { AgentModel, PaneId, WorkspaceState } from "@/features/agent/workspace/types";
import { useProjectsStore } from "@/features/agent/projects/store";
import { toolsRef } from "@/features/agent/tools/store";
import { BACKEND_URL_STORAGE_KEY, getApiKey, getStoredBackendUrl } from "@/lib/api/connection";
import {
  CONTROLLERS_STORAGE_KEY,
  loadSavedControllers,
  normalizeControllerUrl,
} from "@/lib/api/controllers";
import type { Session, UpdateSession } from "@/features/agent/runtime/types";
import type { ChatPaneHandle } from "@/features/agent/ui/chat-pane";
import type { SessionDropPayload } from "@/features/agent/ui/pane-grid";
import { writeDefaultAgentModel } from "@/features/agent/workspace/model-preference";
import {
  closePane,
  openSessionPayloadInPane,
  patchActiveTab,
  patchWorkspaceSession,
  renameTab,
  setWorkspaceSplitRatio,
  splitPaneWithPayload,
  splitTabIntoNewPane,
} from "@/features/agent/workspace/pane-controller";
import { removeSession, setSession } from "@/features/agent/runtime/store";
import { loadInitialFromStorage } from "@/features/agent/workspace/persistence";
import { sessionRuntimeController } from "@/features/agent/runtime/session-runtime-controller";

export type WorkspaceHandles = {
  registerComputerAside: (element: HTMLElement | null) => void;
  openSessionPayloadInPane: (paneId: PaneId, payload: SessionDropPayload) => void;
  renameTab: (paneId: PaneId, tabId: string, title: string) => void;
  splitTabIntoNewPane: (paneId: PaneId, tabId: string) => void;
  registerPaneHandle: (paneId: PaneId, handle: ChatPaneHandle | null) => void;
  compactFocusedSession: () => Promise<void>;
  setSplitRatio: (path: number[], ratio: number) => void;
  updateSession: UpdateSession;
  updateDetachedSession: (fallback: Session, patch: Parameters<UpdateSession>[1]) => void;
  removeDetachedSession: (sessionId: string) => void;
  closePane: (paneId: PaneId) => void;
  splitPaneWithPayload: (
    paneId: PaneId,
    direction: "vertical" | "horizontal",
    side: "a" | "b",
    payload: SessionDropPayload,
  ) => void;
  selectPaneModel: (paneId: PaneId, modelId: string) => void;
  setDefaultModel: (modelId: string) => void;
  notifySessionsChanged: () => void;
  startComputerResize: (event: ReactMouseEvent<HTMLDivElement>) => void;
  initGitForActiveProject: () => Promise<void>;
};

export type UseWorkspaceResult = {
  state: WorkspaceState;
  dispatch: WorkspaceDispatch;
  handles: WorkspaceHandles;
};

export type UseWorkspaceOptions = {
  ephemeral?: boolean;
};

function createMemoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

function agentModelControllersPayload() {
  const activeUrl = normalizeControllerUrl(getStoredBackendUrl());
  const saved = loadSavedControllers().flatMap((controller) => {
    const url = normalizeControllerUrl(controller.url);
    return url ? [{ ...controller, url }] : [];
  });
  const byUrl = new Map(saved.map((controller) => [controller.url, controller]));
  if (activeUrl) {
    const activeApiKey = getApiKey();
    const savedActive = byUrl.get(activeUrl);
    byUrl.delete(activeUrl);
    return [
      {
        ...savedActive,
        url: activeUrl,
        ...(activeApiKey ? { apiKey: activeApiKey } : {}),
        name: savedActive?.name ?? "primary",
      },
      ...byUrl.values(),
    ];
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

export function useWorkspace({ ephemeral = false }: UseWorkspaceOptions = {}): UseWorkspaceResult {
  const store = ephemeral ? ephemeralWorkspaceStore : workspaceStore;
  const state = useStore(store);
  const paneHandlesRef = useRef<Map<PaneId, ChatPaneHandle>>(new Map());
  const computerAsideRef = useRef<HTMLElement | null>(null);

  const controller = useMemo(() => {
    const ephemeralStorage = ephemeral ? createMemoryStorage() : null;
    const makeDeps = (workspaceDispatch: WorkspaceDispatch): WorkspaceEffectDeps | null => {
      if (typeof window === "undefined") return null;
      return {
        storage: ephemeralStorage ?? window.localStorage,
        window,
        api: api(),
        dispatch: workspaceDispatch,
        selectionFor: (id) => toolsRef.current.selectionFor(id),
      };
    };

    const workspaceDispatch: WorkspaceDispatch = (mutation) => {
      const prev = store.getState();
      const next = mutation(prev);
      if (next === prev) return;
      store.setState(next, true);
      const deps = makeDeps(workspaceDispatch);
      if (deps) runWorkspaceEffect(prev, next, deps);
    };

    return {
      dispatch: workspaceDispatch,
      notifySessionsChanged: () => {
        const deps = makeDeps(workspaceDispatch);
        if (deps) scheduleSessionsRefresh(deps);
      },
      refreshModels: () => {
        const deps = makeDeps(workspaceDispatch);
        if (deps) refreshWorkspaceModels(deps);
      },
    };
  }, [ephemeral, store]);

  const { dispatch } = controller;

  useMountSubscription(() => {
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent | Event) => {
      const key = (event as StorageEvent).key;
      if (key && key !== BACKEND_URL_STORAGE_KEY && key !== CONTROLLERS_STORAGE_KEY) return;
      controller.refreshModels();
    };
    const recoverIfEmpty = () => {
      const current = store.getState();
      if (current.models.length === 0 && !current.modelsLoading) controller.refreshModels();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", recoverIfEmpty);
    window.addEventListener("online", recoverIfEmpty);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", recoverIfEmpty);
      window.removeEventListener("online", recoverIfEmpty);
    };
  }, [controller, store]);

  const handles = useMemo<WorkspaceHandles>(
    () => ({
      registerComputerAside: (element: HTMLElement | null) => {
        computerAsideRef.current = element;
      },
      openSessionPayloadInPane: (paneId: PaneId, payload: SessionDropPayload) =>
        dispatch((state) =>
          openSessionPayloadInPane(state, { paneId, payload, tab: makeFreshTab() }),
        ),
      renameTab: (paneId: PaneId, tabId: string, title: string) =>
        dispatch((state) => renameTab(state, { paneId, tabId, title })),
      splitTabIntoNewPane: (paneId: PaneId, tabId: string) =>
        dispatch((state) =>
          splitTabIntoNewPane(state, {
            sourcePaneId: paneId,
            sourceTabId: tabId,
            newPaneId: newPaneId(),
          }),
        ),
      registerPaneHandle: (paneId: PaneId, handle: ChatPaneHandle | null) => {
        if (handle) paneHandlesRef.current.set(paneId, handle);
        else paneHandlesRef.current.delete(paneId);
      },
      compactFocusedSession: async () => {
        const handle = paneHandlesRef.current.get(store.getState().focusedPaneId);
        await handle?.compact();
      },
      setSplitRatio: (path: number[], ratio: number) =>
        dispatch((state) => setWorkspaceSplitRatio(state, { path, ratio })),
      updateSession: (sessionId, patch) =>
        dispatch((state) => patchWorkspaceSession(state, sessionId, patch)),
      updateDetachedSession: (fallback: Session, patch: Parameters<UpdateSession>[1]) => {
        const current = store.getState().sessions.get(fallback.id) ?? fallback;
        dispatch((state) => ({ ...state, sessions: setSession(state.sessions, patch(current)) }));
      },
      removeDetachedSession: (sessionId: string) =>
        dispatch((state) => ({ ...state, sessions: removeSession(state.sessions, sessionId) })),
      closePane: (paneId: PaneId) => dispatch((state) => closePane(state, { paneId })),
      splitPaneWithPayload: (
        paneId: PaneId,
        direction: "vertical" | "horizontal",
        side: "a" | "b",
        payload: SessionDropPayload,
      ) =>
        dispatch((state) =>
          splitPaneWithPayload(state, {
            paneId,
            direction,
            side,
            payload,
            newPaneId: newPaneId(),
            tab: makeFreshTab(),
          }),
        ),
      selectPaneModel: (paneId: PaneId, modelId: string) =>
        dispatch((state) => patchActiveTab(state, { paneId, patch: { modelId } })),
      setDefaultModel: (modelId: string) => {
        writeDefaultAgentModel(ephemeral ? createMemoryStorage() : window.localStorage, modelId);
        dispatch((state) => ({ ...state, selectedModel: modelId }));
      },
      notifySessionsChanged: controller.notifySessionsChanged,
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
          await useProjectsStore.getState().initGitForActiveProject();
        } catch (error) {
          dispatch((state) => ({
            ...state,
            error: error instanceof Error ? error.message : "Failed to initialize git repository",
          }));
        }
      },
    }),
    [controller.notifySessionsChanged, dispatch, ephemeral, store],
  );

  useMountSubscription(() => {
    if (state.hydrated) return;
    const restore =
      !ephemeral && new URLSearchParams(window.location.search).get("restore") !== "0";
    const loaded = restore
      ? loadInitialFromStorage(window.localStorage)
      : { workspace: {}, selections: new Map() };
    dispatch((current) => ({ ...current, ...loaded.workspace, hydrated: true }));
    if (loaded.selections.size > 0) toolsRef.current.hydrateSelections(loaded.selections);
  }, [dispatch, ephemeral, state.hydrated]);

  useMountSubscription(() => {
    const runtime = sessionRuntimeController();
    runtime.bind({
      commit: (sessionId, patch) => {
        dispatch((current) => patchWorkspaceSession(current, sessionId, patch));
      },
      getSessions: () => [...store.getState().sessions.values()],
    });
    return () => {
      runtime.closeAll();
      runtime.unbind();
    };
  }, [dispatch, store]);

  return { state, dispatch, handles };
}
