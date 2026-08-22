import { Effect } from "effect";
import { cleanSessionTitle } from "@/features/agent/messages/helpers";
import { findPaneByPiSessionId, paneSessionId } from "@/features/agent/runtime/selectors";
import type { Session, SessionId } from "@/features/agent/runtime/types";
import {
  markSessionActivitySeen,
  publishOpenSessions,
  type OpenAgentSession,
} from "@/features/agent/session-index";
import type { ToolSelection } from "@/features/agent/tools/types";
import type { ComposerSkillRef } from "@/features/agent/composer-context";
import type {
  AgentModel,
  PaneId,
  WorkspaceAction,
  WorkspaceState,
} from "@/features/agent/workspace/types";
import {
  sessionMetaForPersistence,
  setupWarningFromPiCheck,
  type WorkspaceStorage,
} from "@/features/agent/workspace/store";
import { writePaneState } from "@/features/agent/workspace/persistence";
import { writeSessionDrafts } from "@/features/agent/workspace/session-drafts";
import { writeTranscriptSnapshot } from "@/features/agent/workspace/transcript-cache";
import { readDefaultAgentModel } from "@/features/agent/workspace/model-preference";
import { SESSIONS_CHANGED_EVENT } from "@/lib/workspace-events";

const EMPTY_SELECTION: ToolSelection = { skills: [], promptTemplates: [] };

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

export type WorkspaceDispatch = (action: WorkspaceAction) => void;

export type WorkspaceEffectDeps = {
  storage: WorkspaceStorage;
  window: WorkspaceWindow;
  api: WorkspaceApi;
  dispatch?: WorkspaceDispatch;
  queueReplay: (paneId: PaneId, piSessionId: string) => void;
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
  "urlNavRequested",
]);

const SESSIONS_CHANGED_ACTIONS = new Set<WorkspaceAction["type"]>([
  "openSessionPayloadInPane",
  "splitPaneWithPayload",
  "renameTab",
  "splitTab",
  "closePane",
  "setPaneSession",
  "setDetachedSession",
  "removeDetachedSession",
  "patchSession",
  "patchActiveTab",
  "notifySessionsChanged",
  "urlNavRequested",
]);

const METADATA_PATCH_ACTIONS = new Set<WorkspaceAction["type"]>([
  "setPaneSession",
  "patchSession",
  "patchActiveTab",
]);

function scheduleSessionsRefresh(deps: WorkspaceEffectDeps): void {
  const fire = () => deps.window.dispatchEvent(new deps.window.Event(SESSIONS_CHANGED_EVENT));
  fire();
  deps.window.setTimeout?.(fire, 1_500);
}

function runInitialApiEffects(state: WorkspaceState, deps: WorkspaceEffectDeps): void {
  const loadSetupChecksEffect = deps.api.loadSetupChecks
    ? Effect.tryPromise({
        try: () => deps.api.loadSetupChecks?.() ?? Promise.resolve(null),
        catch: () => null,
      }).pipe(Effect.catch(() => Effect.succeed(null)))
    : Effect.succeed(null);
  const applySetupWarning = (payload: { checks?: SetupCheck[] } | null, hasModels: boolean) => {
    const pi = payload?.checks?.find((check) => check.id === "pi");
    deps.dispatch?.({ type: "setSetupWarning", warning: setupWarningFromPiCheck(pi, hasModels) });
  };

  if (deps.api.loadModels) {
    // Retry quietly with backoff: transient controller/network failures should
    // resolve themselves without the user having to reload the page. The error
    // notice stays visible (dismissible) until an attempt succeeds.
    const attemptLoadModels = (attempt: number): void => {
      deps.dispatch?.({ type: "setModelsLoading", loading: true });
      if (attempt === 0) deps.dispatch?.({ type: "setError", error: "" });
      void Effect.runPromise(
        Effect.gen(function* () {
          const payload = yield* Effect.tryPromise({
            try: () => deps.api.loadModels?.() ?? Promise.resolve([]),
            catch: (error) => error,
          });
          const normalized = Array.isArray(payload)
            ? { models: payload, error: undefined }
            : { models: payload.models ?? [], error: payload.error };
          if (normalized.error) return yield* Effect.fail(new Error(normalized.error));
          deps.dispatch?.({ type: "setError", error: "" });
          deps.dispatch?.({
            type: "setModels",
            models: normalized.models,
            preferredModelId: readDefaultAgentModel(deps.storage),
          });
          if (normalized.models.length > 0) {
            deps.dispatch?.({ type: "setSetupWarning", warning: "" });
          } else {
            applySetupWarning(yield* loadSetupChecksEffect, false);
          }
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              deps.dispatch?.({
                type: "setError",
                error: error instanceof Error ? error.message : "Failed to load models",
              });
              deps.dispatch?.({ type: "setModelsLoading", loading: false });
              const delay = Math.min(5_000 * 2 ** attempt, 60_000);
              deps.window.setTimeout?.(() => attemptLoadModels(attempt + 1), delay);
            }),
          ),
        ),
      );
    };
    attemptLoadModels(0);
  } else if (deps.api.loadSetupChecks) {
    void Effect.runPromise(
      loadSetupChecksEffect.pipe(
        Effect.map((payload) => applySetupWarning(payload, state.models.length > 0)),
      ),
    );
  }
}

function openSessionSnapshot(
  state: WorkspaceState,
  tab: Session,
  selectionFor: (id: SessionId) => ToolSelection,
  paneId: string,
  focused: boolean,
): OpenAgentSession {
  const selection = selectionFor(tab.id);
  const usedSkills = usedSkillsForSession(tab);
  return {
    id: tab.id,
    threadId: tab.piSessionId,
    projectId: tab.projectId ?? "",
    cwd: tab.cwd ?? "",
    paneId,
    modelId: tab.modelId ?? state.selectedModel,
    title: cleanSessionTitle(tab.title) || (paneId ? "Current session" : "Background session"),
    status: tab.status,
    focused,
    startedAt: tab.startedAt,
    updatedAt: tab.startedAt ?? "",
    skills: selection.skills.length > 0 ? selection.skills : undefined,
    usedSkills: usedSkills.length > 0 ? usedSkills : undefined,
  };
}

function openSessionsFromWorkspace(
  state: WorkspaceState,
  selectionFor: (id: SessionId) => ToolSelection,
): OpenAgentSession[] | null {
  if (!state.hydrated) return null;
  const out: OpenAgentSession[] = [];
  const inPane = new Set<SessionId>();
  for (const [paneId, pane] of state.panesById.entries()) {
    const sessionId = paneSessionId(pane);
    const tab = sessionId ? state.sessions.get(sessionId) : undefined;
    if (!tab) continue;
    inPane.add(tab.id);
    if (!(Boolean(tab.piSessionId) || tab.messages.length > 0) || tab.status === "loading")
      continue;
    out.push(openSessionSnapshot(state, tab, selectionFor, paneId, paneId === state.focusedPaneId));
  }
  for (const tab of state.sessions.values()) {
    if (inPane.has(tab.id)) continue;
    if (tab.status !== "running" && tab.status !== "starting") continue;
    out.push(openSessionSnapshot(state, tab, selectionFor, "", false));
  }
  return out;
}

function usedSkillsForSession(tab: Pick<Session, "messages" | "usedSkills">): ComposerSkillRef[] {
  const all = [
    ...(tab.usedSkills ?? []),
    ...tab.messages.flatMap((message) => message.skills ?? []),
  ];
  return [...new Map(all.map((skill) => [skill.id || skill.path || skill.name, skill])).values()];
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

function openSessionsSignature(state: WorkspaceState): string {
  if (!state.hydrated) return "\u0000unhydrated";
  const parts: string[] = [`m:${state.selectedModel ?? ""}`, `f:${state.focusedPaneId ?? ""}`];
  for (const [paneId, pane] of state.panesById.entries())
    parts.push(`P:${paneId}>${pane.sessionId}`);
  for (const tab of state.sessions.values()) {
    parts.push(
      `S:${tab.id}|${tab.status}|${tab.piSessionId ?? ""}|` +
        `${tab.projectId ?? ""}|${tab.cwd ?? ""}|${tab.modelId ?? ""}|${tab.startedAt ?? ""}|` +
        `${tab.title ?? ""}|${tab.messages.length}|${tab.usedSkills?.length ?? 0}`,
    );
  }
  return parts.join("\n");
}

function publishWorkspaceSessions(
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  if (openSessionsSignature(prevState) === openSessionsSignature(nextState)) return;
  const selectionFor = deps.selectionFor ?? (() => EMPTY_SELECTION);
  const next = openSessionsFromWorkspace(nextState, selectionFor);
  if (!next) return;
  publishOpenSessions(next);
  for (const session of next) {
    if (session.focused) markSessionActivitySeen(session.id, session.threadId);
  }
}

function queueReplayEffects(
  action: WorkspaceAction,
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  const piSessionId =
    action.type === "openSessionPayloadInPane" || action.type === "splitPaneWithPayload"
      ? action.payload.piSessionId
      : action.type === "urlNavRequested"
        ? action.sessionId
        : undefined;
  if (!piSessionId || findPaneByPiSessionId(prevState, piSessionId)) return;
  const located = findPaneByPiSessionId(nextState, piSessionId);
  if (located) deps.queueReplay(located.paneId, piSessionId);
}

function persistActionEffects(
  action: WorkspaceAction,
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  if (prevState.sessionDrafts !== nextState.sessionDrafts) {
    writeSessionDrafts(deps.storage, nextState.sessionDrafts);
  }
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

// Widened to string: persisted/hydrated sessions can carry statuses outside the
// current union, and they must still settle rather than be treated as in-flight.
function isSettledStatus(status: string): boolean {
  return status === "idle" || status === "done";
}

function transcriptSignature(session: Session): string {
  const last = session.messages[session.messages.length - 1];
  return [
    session.piSessionId ?? "",
    session.status,
    session.messages.length,
    last?.id ?? "",
    last?.text.length ?? 0,
    last?.blocks?.length ?? 0,
  ].join("|");
}

/**
 * Snapshots transcripts at the three points they can go stale: when a session
 * settles, when a new turn starts (preserving the pre-turn transcript), and
 * when a session leaves the workspace entirely.
 */
function persistTranscripts(
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  const snapshot = (session: Session) => {
    if (!session.piSessionId || session.messages.length === 0) return;
    writeTranscriptSnapshot(
      session.piSessionId,
      session.messages,
      cleanSessionTitle(session.title),
      deps.storage,
    );
  };
  for (const [id, session] of nextState.sessions) {
    const before = prevState.sessions.get(id);
    if (isSettledStatus(session.status)) {
      if (!before || transcriptSignature(before) !== transcriptSignature(session))
        snapshot(session);
    } else if (
      (session.status === "running" || session.status === "starting") &&
      before &&
      before.status !== session.status
    ) {
      snapshot(session);
    }
  }
  for (const [id, session] of prevState.sessions) {
    if (!nextState.sessions.has(id)) snapshot(session);
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

  if (action.type === "hydrate") {
    runInitialApiEffects(nextState, deps);
  }

  publishWorkspaceSessions(prevState, nextState, deps);
  if (SESSIONS_CHANGED_ACTIONS.has(action.type)) {
    persistTranscripts(prevState, nextState, deps);
    if (storedSessionsKey(prevState) !== storedSessionsKey(nextState)) {
      scheduleSessionsRefresh(deps);
    }
  }
}
