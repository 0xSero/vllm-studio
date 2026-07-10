import type { ActiveAgentSessionSnapshot } from "@/features/agent/active-sessions";
import { Effect } from "effect";
import { cleanSessionTitle } from "@/features/agent/messages/helpers";
import { findPaneByPiSessionId, paneSessionId } from "@/features/agent/runtime/selectors";
import type { Project } from "@/features/agent/projects/types";
import type { Session, SessionId } from "@/features/agent/runtime/types";
import type { ToolSelection } from "@/features/agent/tools/types";
import type { ComposerSkillRef } from "@/features/agent/composer-context";
import type {
  AgentModel,
  PaneId,
  WorkspaceAction,
  WorkspaceState,
} from "@/features/agent/workspace/types";
import {
  loadPersistedActiveAgentSessions,
  sessionMetaForPersistence,
  setupWarningFromPiCheck,
  type WorkspaceStorage,
} from "@/features/agent/workspace/store";
import { writeActiveSessions, writePaneState } from "@/features/agent/workspace/persistence";
import { writeTranscriptSnapshot } from "@/features/agent/workspace/transcript-cache";
import {
  ACTIVE_AGENT_SESSIONS_EVENT,
  PROJECTS_LOADED_EVENT,
  SESSIONS_CHANGED_EVENT,
} from "@/lib/workspace-events";
import { isRecord } from "@/lib/guards";

const EMPTY_SELECTION: ToolSelection = {
  skills: [],
  promptTemplates: [],
};

type SetupCheck = { id: string; ok: boolean; guidance?: string };

export type WorkspaceApi = {
  loadSetupChecks?: () => Promise<{ checks?: SetupCheck[] }>;
  loadModels?: () => Promise<{ models?: AgentModel[]; error?: string } | AgentModel[]>;
};

export type WorkspaceWindow = {
  Event: typeof Event;
  CustomEvent: typeof CustomEvent;
  dispatchEvent: (event: Event) => boolean;
  addEventListener: Window["addEventListener"];
  removeEventListener: Window["removeEventListener"];
  setTimeout?: (handler: () => void, timeout: number) => unknown;
};

export type WorkspaceDispatch = (action: WorkspaceAction) => void;

export type WorkspaceEffectDeps = {
  storage: WorkspaceStorage;
  window: WorkspaceWindow;
  api: WorkspaceApi;
  dispatch?: WorkspaceDispatch;
  queueReplay: (paneId: PaneId, piSessionId: string) => void;
  /** Resolve a project by id from the projects context (workspace doesn't own project state). */
  findProjectById?: (id: string) => Project | null;
  /** Resolve a session's tool selection from the tools context. */
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
  "hydrateActiveSessions",
  "urlNavRequested",
]);

const SESSIONS_CHANGED_ACTIONS = new Set<WorkspaceAction["type"]>([
  "openSessionPayloadInPane",
  "splitPaneWithPayload",
  "renameTab",
  "splitTab",
  "closePane",
  "setPaneSession",
  "patchSession",
  "patchActiveTab",
  "hydrateActiveSessions",
  "notifySessionsChanged",
  "urlNavRequested",
]);

const METADATA_PATCH_ACTIONS = new Set<WorkspaceAction["type"]>([
  "setPaneSession",
  "patchSession",
  "patchActiveTab",
]);

function dispatchEvent(deps: WorkspaceEffectDeps, type: string): void {
  deps.window.dispatchEvent(new deps.window.Event(type));
}

function dispatchCustomEvent<T>(deps: WorkspaceEffectDeps, type: string, detail: T): void {
  deps.window.dispatchEvent(new deps.window.CustomEvent<T>(type, { detail }));
}

function eventDetail(event: Event): unknown {
  return "detail" in event ? event.detail : undefined;
}

export function subscribeWorkspaceWindowEvents(
  workspaceWindow: WorkspaceWindow,
  dispatch: WorkspaceDispatch,
): () => void {
  // Fired by ProjectsProvider once its first load settles. We hold off on
  // hydrating active-session snapshots until then so we can filter sessions
  // whose project is no longer installed.
  const onProjectsLoaded = (event: Event) => {
    const detail = eventDetail(event);
    const projects =
      isRecord(detail) && Array.isArray(detail.projects) ? (detail.projects as Project[]) : [];
    const params =
      typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const restoreWorkspace = params?.get("restore") !== "0";
    dispatch({
      type: "hydrateActiveSessions",
      snapshots: restoreWorkspace ? loadPersistedActiveAgentSessions() : [],
      projects,
      hasExplicitSessionNav:
        !restoreWorkspace || Boolean(params?.get("session") || params?.get("new")),
    });
  };

  workspaceWindow.addEventListener(PROJECTS_LOADED_EVENT, onProjectsLoaded);

  return () => workspaceWindow.removeEventListener(PROJECTS_LOADED_EVENT, onProjectsLoaded);
}

function scheduleSessionsRefresh(deps: WorkspaceEffectDeps): void {
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

function runInitialApiEffects(state: WorkspaceState, deps: WorkspaceEffectDeps): void {
  const loadSetupChecksEffect = deps.api.loadSetupChecks
    ? Effect.tryPromise({
        try: () => deps.api.loadSetupChecks?.() ?? Promise.resolve(null),
        catch: () => null,
      }).pipe(Effect.catch(() => Effect.succeed(null)))
    : Effect.succeed(null);

  if (deps.api.loadModels) {
    deps.dispatch?.({ type: "setModelsLoading", loading: true });
    deps.dispatch?.({ type: "setError", error: "" });
    void Effect.runPromise(
      Effect.gen(function* () {
        const payload = yield* Effect.tryPromise({
          try: () => deps.api.loadModels?.() ?? Promise.resolve([]),
          catch: (error) => error,
        });
        const normalized = normalizeModelsPayload(payload);
        if (normalized.error) return yield* Effect.fail(new Error(normalized.error));
        deps.dispatch?.({ type: "setModels", models: normalized.models });
        if (normalized.models.length > 0) {
          deps.dispatch?.({ type: "setSetupWarning", warning: "" });
        } else {
          const setupPayload = yield* loadSetupChecksEffect;
          const pi = setupPayload?.checks?.find((check) => check.id === "pi");
          deps.dispatch?.({
            type: "setSetupWarning",
            warning: setupWarningFromPiCheck(pi, false),
          });
        }
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            deps.dispatch?.({
              type: "setError",
              error: error instanceof Error ? error.message : "Failed to load models",
            });
            deps.dispatch?.({ type: "setModelsLoading", loading: false });
          }),
        ),
      ),
    );
  } else if (deps.api.loadSetupChecks) {
    void Effect.runPromise(
      loadSetupChecksEffect.pipe(
        Effect.map((payload) => {
          const pi = payload?.checks?.find((check) => check.id === "pi");
          deps.dispatch?.({
            type: "setSetupWarning",
            warning: setupWarningFromPiCheck(pi, state.models.length > 0),
          });
        }),
      ),
    );
  }
}

function activeSessionSnapshot(
  state: WorkspaceState,
  tab: Session,
  selectionFor: (id: SessionId) => ToolSelection,
  paneId: string,
  focused: boolean,
): ActiveAgentSessionSnapshot {
  const selection = selectionFor(tab.id);
  const usedSkills = usedSkillsForSession(tab);
  return {
    projectId: tab.projectId ?? "",
    cwd: tab.cwd ?? "",
    paneId,
    tabId: tab.id,
    piSessionId: tab.piSessionId,
    modelId: tab.modelId ?? state.selectedModel,
    title: cleanSessionTitle(tab.title) || (paneId ? "Current session" : "Background session"),
    status: tab.status,
    focused,
    startedAt: tab.startedAt,
    updatedAt: tab.startedAt || new Date().toISOString(),
    skills: selection.skills.length > 0 ? selection.skills : undefined,
    usedSkills: usedSkills.length > 0 ? usedSkills : undefined,
  };
}

function computeActiveSessionBroadcast(
  state: WorkspaceState,
  selectionFor: (id: SessionId) => ToolSelection,
): ActiveAgentSessionSnapshot[] | null {
  if (!state.hydrated) return null;
  const out: ActiveAgentSessionSnapshot[] = [];
  const inPane = new Set<SessionId>();
  for (const [paneId, pane] of state.panesById.entries()) {
    const sessionId = paneSessionId(pane);
    const tab = sessionId ? state.sessions.get(sessionId) : undefined;
    if (!tab) continue;
    inPane.add(tab.id);
    if (!(Boolean(tab.piSessionId) || tab.messages.length > 0) || tab.status === "loading")
      continue;
    out.push(
      activeSessionSnapshot(state, tab, selectionFor, paneId, paneId === state.focusedPaneId),
    );
  }
  // Sessions still working after the user navigated away keep no pane, but
  // pruneSessions keeps them alive in the store. Surface them so a turn started
  // in another chat stays visible (and re-openable) in the sidebar instead of
  // running invisibly in the background.
  for (const tab of state.sessions.values()) {
    if (inPane.has(tab.id)) continue;
    if (tab.status !== "running" && tab.status !== "starting") continue;
    out.push(activeSessionSnapshot(state, tab, selectionFor, "", false));
  }
  return out;
}

function usedSkillsForSession(tab: Pick<Session, "messages" | "usedSkills">): ComposerSkillRef[] {
  const byId = new Map<string, ComposerSkillRef>();
  for (const skill of tab.usedSkills ?? []) byId.set(skill.id || skill.path || skill.name, skill);
  for (const message of tab.messages) {
    for (const skill of message.skills ?? []) byId.set(skill.id || skill.path || skill.name, skill);
  }
  return [...byId.values()];
}

function activeSessionBroadcastKey(sessions: ActiveAgentSessionSnapshot[] | null): string {
  return JSON.stringify(sessions ?? null);
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

// Cheap O(sessions) fingerprint of everything the active-session broadcast
// snapshot actually depends on: hydration, the selected-model fallback, focus,
// pane membership, and each session's identity/status/skill scalars. It
// deliberately reads `messages.length` (not message bodies) and `usedSkills`
// length — a streaming text delta grows the last message in place without
// changing any of these, so the signature is stable across the entire token
// stream of a turn. Tool selection (plugins/skills) is intentionally excluded:
// it does not flow through a workspace dispatch, so gating on it would never
// help and only the next session-field change re-broadcasts it (unchanged from
// the prior every-dispatch behavior).
export function activeBroadcastSignature(state: WorkspaceState): string {
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

function broadcastActiveSessions(
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  // Hot path: a coalesced text delta dispatches patchSession on every animation
  // frame. The broadcast snapshot can't change unless a broadcast-relevant
  // scalar changed, so short-circuit on the cheap signature BEFORE the
  // O(sessions x messages) double walk + JSON.stringify that follows.
  if (activeBroadcastSignature(prevState) === activeBroadcastSignature(nextState)) return;
  const selectionFor = deps.selectionFor ?? (() => EMPTY_SELECTION);
  const previous = computeActiveSessionBroadcast(prevState, selectionFor);
  const next = computeActiveSessionBroadcast(nextState, selectionFor);
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
  const located = findPaneByPiSessionId(state, piSessionId);
  if (located) deps.queueReplay(located.paneId, piSessionId);
}

function queueReplayEffects(
  action: WorkspaceAction,
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  switch (action.type) {
    case "openSessionPayloadInPane":
    case "splitPaneWithPayload":
      if (
        action.payload.piSessionId &&
        !findPaneByPiSessionId(prevState, action.payload.piSessionId)
      ) {
        queueLocatedReplay(action.payload.piSessionId, nextState, deps);
      }
      return;
    case "urlNavRequested":
      if (action.sessionId) queueLocatedReplay(action.sessionId, nextState, deps);
      return;
    case "hydrateActiveSessions": {
      const queued = new Set<string>();
      for (const snapshot of action.snapshots) {
        if (!snapshot.piSessionId || queued.has(snapshot.piSessionId)) continue;
        queued.add(snapshot.piSessionId);
        queueLocatedReplay(snapshot.piSessionId, nextState, deps);
      }
      return;
    }
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
    writePaneState(deps.storage, nextState, deps.selectionFor);
    return;
  }
  if (
    METADATA_PATCH_ACTIONS.has(action.type) &&
    paneMetadataKey(prevState, deps.selectionFor) !== paneMetadataKey(nextState, deps.selectionFor)
  ) {
    writePaneState(deps.storage, nextState, deps.selectionFor);
  }
  // Browser/computer tool state persistence now lives in
  // features/agent/tools/persistence.ts and is driven by ToolsProvider directly.
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

function isSettledStatus(status: string): boolean {
  return status === "idle" || status === "done";
}

// Cheap content fingerprint — enough to tell "this session's transcript moved"
// without serializing every message on every dispatch.
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

// Persist the crash-recovery transcript fallback once a session settles with
// new content. Gated on settle + signature change so it writes about once per
// completed turn, never per streamed token. The canonical pi JSONL stays the
// source of truth; this only backstops a failed/empty replay on restore.
function persistSettledTranscripts(
  prevState: WorkspaceState,
  nextState: WorkspaceState,
  deps: WorkspaceEffectDeps,
): void {
  for (const [id, session] of nextState.sessions) {
    if (!session.piSessionId || session.messages.length === 0) continue;
    if (!isSettledStatus(session.status)) continue;
    const before = prevState.sessions.get(id);
    if (before && transcriptSignature(before) === transcriptSignature(session)) continue;
    writeTranscriptSnapshot(
      session.piSessionId,
      session.messages,
      cleanSessionTitle(session.title),
      deps.storage,
    );
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

  broadcastActiveSessions(prevState, nextState, deps);
  if (SESSIONS_CHANGED_ACTIONS.has(action.type)) {
    persistSettledTranscripts(prevState, nextState, deps);
  }
  if (
    SESSIONS_CHANGED_ACTIONS.has(action.type) &&
    storedSessionsKey(prevState) !== storedSessionsKey(nextState)
  ) {
    scheduleSessionsRefresh(deps);
  }
}
