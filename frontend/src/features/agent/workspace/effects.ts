import { Effect } from "effect";
import { cleanSessionTitle } from "@/features/agent/messages/helpers";
import { findPaneByPiSessionId, paneSessionId } from "@/features/agent/runtime/selectors";
import type { SessionId } from "@/features/agent/runtime/types";
import { markSessionActivitySeen } from "@/features/agent/session-index";
import type { ToolSelection } from "@/features/agent/tools/types";
import type { AgentModel, PaneId, WorkspaceState } from "@/features/agent/workspace/types";
import {
  sessionMetaForPersistence,
  setupWarningFromPiCheck,
  type WorkspaceStorage,
} from "@/features/agent/workspace/store";
import { writePaneState } from "@/features/agent/workspace/persistence";
import { readDefaultAgentModel } from "@/features/agent/workspace/model-preference";
import { SESSIONS_CHANGED_EVENT } from "@/lib/workspace-events";

type SetupCheck = { id: string; ok: boolean; guidance?: string };

export type WorkspaceApi = {
  loadSetupChecks?: () => Promise<{ checks?: SetupCheck[] }>;
  loadModels?: () => Promise<{ models?: AgentModel[]; error?: string } | AgentModel[]>;
};

export type WorkspaceWindow = {
  Event: typeof Event;
  dispatchEvent: (event: Event) => boolean;
  setTimeout?: (handler: () => void, timeout: number) => unknown;
};

export type WorkspaceMutation = (state: WorkspaceState) => WorkspaceState;
export type WorkspaceDispatch = (mutation: WorkspaceMutation) => void;

export type WorkspaceEffectDeps = {
  storage: WorkspaceStorage;
  window: WorkspaceWindow;
  api: WorkspaceApi;
  dispatch?: WorkspaceDispatch;
  queueReplay: (paneId: PaneId, piSessionId: string) => void;
  selectionFor?: (sessionId: SessionId) => ToolSelection;
};

function dispatchEvent(deps: WorkspaceEffectDeps, type: string): void {
  deps.window.dispatchEvent(new deps.window.Event(type));
}

export function scheduleSessionsRefresh(deps: WorkspaceEffectDeps): void {
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

function chooseModelId(models: AgentModel[], current: string, preferred?: string): string {
  if (preferred && models.some((model) => model.id === preferred)) return preferred;
  if (current && models.some((model) => model.id === current)) return current;
  return models.find((model) => model.active)?.id ?? models[0]?.id ?? "";
}

function patchWorkspace(deps: WorkspaceEffectDeps, patch: Partial<WorkspaceState>): void {
  deps.dispatch?.((state) => ({ ...state, ...patch }));
}

function loadSetupChecks(deps: WorkspaceEffectDeps) {
  return deps.api.loadSetupChecks
    ? Effect.tryPromise({
        try: () => deps.api.loadSetupChecks?.() ?? Promise.resolve(null),
        catch: () => null,
      }).pipe(Effect.catch(() => Effect.succeed(null)))
    : Effect.succeed(null);
}

function runInitialApiEffects(state: WorkspaceState, deps: WorkspaceEffectDeps): void {
  if (deps.api.loadModels) refreshWorkspaceModels(deps);
  else if (deps.api.loadSetupChecks) {
    void Effect.runPromise(
      loadSetupChecks(deps).pipe(
        Effect.map((payload) => {
          const pi = payload?.checks?.find((check) => check.id === "pi");
          patchWorkspace(deps, {
            setupWarning: setupWarningFromPiCheck(pi, state.models.length > 0),
          });
        }),
      ),
    );
  }
}

export function refreshWorkspaceModels(deps: WorkspaceEffectDeps, attempt = 0): void {
  if (!deps.api.loadModels) return;
  patchWorkspace(deps, { modelsLoading: true, ...(attempt === 0 ? { error: "" } : {}) });
  void Effect.runPromise(
    Effect.gen(function* () {
      const payload = yield* Effect.tryPromise({
        try: () => deps.api.loadModels?.() ?? Promise.resolve([]),
        catch: (error) => error,
      });
      const normalized = normalizeModelsPayload(payload);
      if (normalized.error) return yield* Effect.fail(new Error(normalized.error));
      deps.dispatch?.((state) => ({
        ...state,
        error: "",
        models: normalized.models,
        selectedModel: chooseModelId(
          normalized.models,
          state.selectedModel,
          readDefaultAgentModel(deps.storage),
        ),
        modelsLoading: false,
      }));
      if (normalized.models.length > 0) patchWorkspace(deps, { setupWarning: "" });
      else {
        const setupPayload = yield* loadSetupChecks(deps);
        const pi = setupPayload?.checks?.find((check) => check.id === "pi");
        patchWorkspace(deps, { setupWarning: setupWarningFromPiCheck(pi, false) });
      }
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          patchWorkspace(deps, {
            error: error instanceof Error ? error.message : "Failed to load models",
            modelsLoading: false,
          });
          const delay = Math.min(5_000 * 2 ** attempt, 60_000);
          deps.window.setTimeout?.(() => refreshWorkspaceModels(deps, attempt + 1), delay);
        }),
      ),
    ),
  );
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
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  for (const pane of nextState.panesById.values()) {
    const session = nextState.sessions.get(pane.sessionId);
    if (
      session?.piSessionId &&
      session.messages.length === 0 &&
      !findPaneByPiSessionId(prevState, session.piSessionId)
    ) {
      queueLocatedReplay(session.piSessionId, nextState, deps);
    }
  }
}

function persistActionEffects(
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  if (
    prevState.hydrated &&
    paneMetadataKey(prevState, deps.selectionFor) !== paneMetadataKey(nextState, deps.selectionFor)
  ) {
    writePaneState(deps.storage, nextState, deps.selectionFor);
  }
}

function paneMetadataKey(
  state: WorkspaceState,
  selectionFor: ((sessionId: SessionId) => ToolSelection | null) | undefined,
): string {
  const panes: Record<string, unknown> = {};
  for (const [paneId, pane] of state.panesById.entries()) {
    const sessionId = paneSessionId(pane);
    const session = sessionId ? state.sessions.get(sessionId) : undefined;
    panes[paneId] = {
      sessionId: pane.sessionId,
      tab: session
        ? sessionMetaForPersistence(session, selectionFor?.(pane.sessionId) ?? undefined)
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
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  persistActionEffects(prevState, nextState, deps);
  queueReplayEffects(prevState, nextState, deps);
  if (!prevState.hydrated && nextState.hydrated) runInitialApiEffects(nextState, deps);
  const focusedPane = nextState.panesById.get(nextState.focusedPaneId);
  const focusedSession = focusedPane ? nextState.sessions.get(focusedPane.sessionId) : undefined;
  if (focusedSession) markSessionActivitySeen(focusedSession.id, focusedSession.piSessionId);
  if (storedSessionsKey(prevState) !== storedSessionsKey(nextState)) scheduleSessionsRefresh(deps);
}
