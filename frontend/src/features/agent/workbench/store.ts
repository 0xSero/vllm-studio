import { Effect } from "effect";
import { createStore } from "zustand/vanilla";
import { safeJson } from "@/features/agent/safe-json";
import { cleanSessionTitle, makeFreshTab, newPaneId } from "@/features/agent/messages/helpers";
import { removeSession, setSession } from "@/features/agent/runtime/store";
import type { Session, SessionId, UpdateSession } from "@/features/agent/runtime/types";
import { useProjectsStore } from "@/features/agent/projects/store";
import { clampComputerWidth, gentlySnapComputerWidth } from "@/features/agent/tools/persistence";
import { useToolsStore } from "@/features/agent/tools/store";
import type { ToolSelection } from "@/features/agent/tools/types";
import type { ChatPaneHandle } from "@/features/agent/ui/chat-pane";
import type { SessionDropPayload } from "@/features/agent/ui/pane-grid";
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
import {
  loadInitialFromStorage,
  paneStateJson,
  writePaneState,
} from "@/features/agent/workspace/persistence";
import {
  readDefaultAgentModel,
  writeDefaultAgentModel,
} from "@/features/agent/workspace/model-preference";
import { connectWorkspaceRuntime } from "@/features/agent/workspace/runtime-activity";
import {
  createInitialState,
  setupWarningFromPiCheck,
  type WorkspaceStorage,
} from "@/features/agent/workspace/store";
import type { AgentModel, PaneId, WorkspaceState } from "@/features/agent/workspace/types";
import { BACKEND_URL_STORAGE_KEY, getApiKey, getStoredBackendUrl } from "@/lib/api/connection";
import {
  CONTROLLERS_STORAGE_KEY,
  loadSavedControllers,
  normalizeControllerUrl,
} from "@/lib/api/controllers";
import { SESSIONS_CHANGED_EVENT } from "@/lib/workspace-events";

export type WorkspaceMutation = (state: WorkspaceState) => WorkspaceState;
export type WorkspaceDispatch = (mutation: WorkspaceMutation) => void;
type ComputerResizeStart = { clientX: number; preventDefault: () => void };

export type WorkbenchState = WorkspaceState & {
  dispatch: WorkspaceDispatch;
  initialize: () => () => void;
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
  startComputerResize: (event: ComputerResizeStart) => void;
  initGitForActiveProject: () => Promise<void>;
  markActivitySeen: (ids: readonly (string | null | undefined)[]) => void;
};

type SetupCheck = { id: string; ok: boolean; guidance?: string };

function createMemoryStorage(): WorkspaceStorage {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
}

function agentModelControllersPayload() {
  const activeUrl = normalizeControllerUrl(getStoredBackendUrl());
  const saved = loadSavedControllers().flatMap((controller) => {
    const url = normalizeControllerUrl(controller.url);
    return url ? [{ ...controller, url }] : [];
  });
  const byUrl = new Map(saved.map((controller) => [controller.url, controller]));
  if (!activeUrl) return [...byUrl.values()];
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

function chooseModelId(models: AgentModel[], current: string, preferred?: string): string {
  if (preferred && models.some((model) => model.id === preferred)) return preferred;
  if (current && models.some((model) => model.id === current)) return current;
  return models.find((model) => model.active)?.id ?? models[0]?.id ?? "";
}

function storedSessionsKey(state: WorkspaceState): string {
  const entries = [...state.sessions.values()]
    .filter((session) => session.piSessionId)
    .map((session) => ({
      id: session.piSessionId!,
      title: cleanSessionTitle(session.title),
      cwd: session.cwd,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return JSON.stringify(entries);
}

function createWorkbenchStore(ephemeral: boolean) {
  const memoryStorage = createMemoryStorage();
  const paneHandles = new Map<PaneId, ChatPaneHandle>();
  let computerAside: HTMLElement | null = null;
  let mounts = 0;
  let cleanup: (() => void) | null = null;
  const storage = () => (ephemeral ? memoryStorage : window.localStorage);
  const dispatch: WorkspaceDispatch = (mutation) => {
    const previous = store.getState();
    const next = mutation(previous);
    if (next === previous) return;
    store.setState(next);
    if (!previous.hydrated && next.hydrated) refreshModels();
    if (
      previous.hydrated &&
      paneStateJson(previous, selectionFor) !== paneStateJson(next, selectionFor)
    ) {
      writePaneState(storage(), next, selectionFor);
    }
    if (storedSessionsKey(previous) !== storedSessionsKey(next)) scheduleSessionsRefresh();
    const focused = next.panesById.get(next.focusedPaneId);
    const session = focused ? next.sessions.get(focused.sessionId) : null;
    if (session) markActivitySeen([session.id, session.piSessionId]);
  };
  const selectionFor = (sessionId: SessionId): ToolSelection =>
    useToolsStore.getState().selectionFor(sessionId);
  const scheduleSessionsRefresh = () => {
    window.dispatchEvent(new Event(SESSIONS_CHANGED_EVENT));
    window.setTimeout(() => window.dispatchEvent(new Event(SESSIONS_CHANGED_EVENT)), 1_500);
  };
  const refreshModels = (attempt = 0): void => {
    dispatch((state) => ({
      ...state,
      modelsLoading: true,
      ...(attempt === 0 ? { error: "" } : {}),
    }));
    void Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* Effect.tryPromise({
          try: loadAgentModelsPayload,
          catch: (error) => error,
        });
        if (payload.error) return yield* Effect.fail(new Error(payload.error));
        const models = payload.models ?? [];
        dispatch((state) => ({
          ...state,
          error: "",
          models,
          selectedModel: chooseModelId(
            models,
            state.selectedModel,
            readDefaultAgentModel(storage()),
          ),
          modelsLoading: false,
        }));
        if (models.length > 0) {
          dispatch((state) => ({ ...state, setupWarning: "" }));
          return;
        }
        const response = yield* Effect.tryPromise({
          try: () => fetch("/api/agent/setup-checks", { cache: "no-store" }),
          catch: () => null,
        });
        const setup = response
          ? yield* Effect.tryPromise({
              try: () => safeJson<{ checks?: SetupCheck[] }>(response),
              catch: () => ({}),
            })
          : null;
        const pi = setup?.checks?.find((check) => check.id === "pi");
        dispatch((state) => ({ ...state, setupWarning: setupWarningFromPiCheck(pi, false) }));
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            dispatch((state) => ({
              ...state,
              error: error instanceof Error ? error.message : "Failed to load models",
              modelsLoading: false,
            }));
            window.setTimeout(
              () => refreshModels(attempt + 1),
              Math.min(5_000 * 2 ** attempt, 60_000),
            );
          }),
        ),
      ),
    );
  };
  const markActivitySeen = (ids: readonly (string | null | undefined)[]) => {
    const current = store.getState();
    const runtimeActivity = new Map(current.runtimeActivity);
    ids.forEach((id) => id && runtimeActivity.delete(id));
    store.setState({ runtimeActivity });
  };
  const initialize = () => {
    mounts += 1;
    if (mounts === 1) {
      const disconnectRuntime = connectWorkspaceRuntime(store);
      const onStorage = (event: StorageEvent | Event) => {
        const key = (event as StorageEvent).key;
        if (!key || key === BACKEND_URL_STORAGE_KEY || key === CONTROLLERS_STORAGE_KEY)
          refreshModels();
      };
      const recoverIfEmpty = () => {
        const current = store.getState();
        if (current.models.length === 0 && !current.modelsLoading) refreshModels();
      };
      window.addEventListener("storage", onStorage);
      window.addEventListener("focus", recoverIfEmpty);
      window.addEventListener("online", recoverIfEmpty);
      cleanup = () => {
        disconnectRuntime();
        window.removeEventListener("storage", onStorage);
        window.removeEventListener("focus", recoverIfEmpty);
        window.removeEventListener("online", recoverIfEmpty);
      };
      if (!store.getState().hydrated) {
        const restore =
          !ephemeral && new URLSearchParams(window.location.search).get("restore") !== "0";
        const loaded = restore
          ? loadInitialFromStorage(window.localStorage)
          : { workspace: {}, selections: new Map<SessionId, ToolSelection>() };
        dispatch((state) => ({ ...state, ...loaded.workspace, hydrated: true }));
        if (loaded.selections.size > 0)
          useToolsStore.getState().hydrateSelections(loaded.selections);
      }
    }
    return () => {
      mounts = Math.max(0, mounts - 1);
      if (mounts > 0) return;
      cleanup?.();
      cleanup = null;
    };
  };
  const store = createStore<WorkbenchState>(() => ({
    ...createInitialState(),
    dispatch,
    initialize,
    registerComputerAside: (element) => {
      computerAside = element;
    },
    openSessionPayloadInPane: (paneId, payload) =>
      dispatch((state) =>
        openSessionPayloadInPane(state, { paneId, payload, tab: makeFreshTab() }),
      ),
    renameTab: (paneId, tabId, title) =>
      dispatch((state) => renameTab(state, { paneId, tabId, title })),
    splitTabIntoNewPane: (paneId, tabId) =>
      dispatch((state) =>
        splitTabIntoNewPane(state, {
          sourcePaneId: paneId,
          sourceTabId: tabId,
          newPaneId: newPaneId(),
        }),
      ),
    registerPaneHandle: (paneId, handle) => {
      if (handle) paneHandles.set(paneId, handle);
      else paneHandles.delete(paneId);
    },
    compactFocusedSession: async () => {
      await paneHandles.get(store.getState().focusedPaneId)?.compact();
    },
    setSplitRatio: (path, ratio) =>
      dispatch((state) => setWorkspaceSplitRatio(state, { path, ratio })),
    updateSession: (sessionId, patch) =>
      dispatch((state) => patchWorkspaceSession(state, sessionId, patch)),
    updateDetachedSession: (fallback, patch) => {
      const current = store.getState().sessions.get(fallback.id) ?? fallback;
      dispatch((state) => ({ ...state, sessions: setSession(state.sessions, patch(current)) }));
    },
    removeDetachedSession: (sessionId) =>
      dispatch((state) => ({ ...state, sessions: removeSession(state.sessions, sessionId) })),
    closePane: (paneId) => dispatch((state) => closePane(state, { paneId })),
    splitPaneWithPayload: (paneId, direction, side, payload) =>
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
    selectPaneModel: (paneId, modelId) =>
      dispatch((state) => patchActiveTab(state, { paneId, patch: { modelId } })),
    setDefaultModel: (modelId) => {
      writeDefaultAgentModel(storage(), modelId);
      dispatch((state) => ({ ...state, selectedModel: modelId }));
    },
    notifySessionsChanged: scheduleSessionsRefresh,
    startComputerResize: (event) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth =
        computerAside?.getBoundingClientRect().width ?? useToolsStore.getState().computer.width;
      const containerWidth =
        computerAside?.parentElement?.getBoundingClientRect().width ?? window.innerWidth;
      let frame = 0;
      if (computerAside) computerAside.style.transition = "none";
      const onMove = (moveEvent: MouseEvent) => {
        const next = clampComputerWidth(startWidth + startX - moveEvent.clientX, containerWidth);
        if (frame) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          if (computerAside) computerAside.style.width = `${next}px`;
        });
      };
      const onUp = (upEvent: MouseEvent) => {
        if (frame) cancelAnimationFrame(frame);
        const next = gentlySnapComputerWidth(startWidth + startX - upEvent.clientX, containerWidth);
        if (computerAside) {
          computerAside.style.transition = "width 150ms cubic-bezier(0.22, 1, 0.36, 1)";
          computerAside.style.width = `${next}px`;
          window.setTimeout(() => {
            if (computerAside) computerAside.style.transition = "";
          }, 170);
        }
        useToolsStore.getState().setComputerWidth(next);
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
    markActivitySeen,
  }));
  return store;
}

export const workbenchStore = createWorkbenchStore(false);
export const ephemeralWorkbenchStore = createWorkbenchStore(true);
