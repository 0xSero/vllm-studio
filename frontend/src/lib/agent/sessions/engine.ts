import { useCallback, useMemo, useRef } from "react";
import {
  mergeCanonicalAndRuntimeEvents,
  replayCursorAfterRuntimeHydration,
  replaySessionEvents,
  runtimeStatusAcceptsControl,
  type TokenStats,
  usageFromEvent,
} from "@/lib/agent/session";
import {
  activeComposerPlugins,
  selectedContextPrompt,
  type ComposerPluginRef,
  type ComposerPromptTemplateRef,
  type ComposerSkillRef,
} from "@/lib/agent/composer-context";
import type { Session, SessionId } from "@/lib/agent/sessions/types";
import type { BrowserBackend, ToolSelection } from "@/lib/agent/tools/types";
import * as api from "./api";
import { resolveRuntimeSessionId, runtimeCanHydrateCanonicalSession } from "./engine-helpers";
import { submitPromptTurn, type SubmitArgs } from "./prompt-stream";
import { sessionRuntimeController } from "./session-runtime-controller";

const EMPTY_PLUGINS: ComposerPluginRef[] = [];
const EMPTY_SKILLS: ComposerSkillRef[] = [];
const EMPTY_PROMPT_TEMPLATES: ComposerPromptTemplateRef[] = [];

type UpdateSession = (sessionId: SessionId, patch: (session: Session) => Session) => void;

export type UseSessionEngineDeps = {
  /** Latest `tabs` snapshot — engine reads via a ref so it doesn't restart on every frame. */
  tabs: Session[];
  activeTabId: SessionId;
  /** Runtime session id used when a session doesn't carry its own. */
  runtimeSessionId: string;
  modelId: string;
  cwd: string;
  browserToolEnabled: boolean;
  browserBackend: BrowserBackend;
  canvasEnabled: boolean;
  onPiSessionIdChange?: (piSessionId: string) => void;
  /** Mutate a single session record. */
  updateSession: UpdateSession;
  /** Look up the per-session tool selection from the tools subsystem. */
  selectionFor: (sessionId: SessionId) => ToolSelection;
};

export type SessionEngine = {
  /** Send a freshly-typed prompt — orchestrates optimistic update + streaming. */
  submitPrompt: (args: SubmitArgs) => Promise<void>;
  /** Send a steer/follow-up control message while a turn is in progress. */
  sendControl: (
    mode: "steer" | "follow_up",
    text: string,
    runtime: string,
    sessionId: SessionId,
    piSessionId?: string | null,
  ) => Promise<{ ok: boolean; error?: string }>;
  loadRuntimeStatus: (
    runtime: string,
    piSessionId?: string | null,
  ) => Promise<api.RuntimeStatus | null>;
  abortTurn: (sessionId: SessionId) => Promise<void>;
  loadAndReplay: (piSessionId: string, sessionId: SessionId) => Promise<void>;
  compact: (sessionId: SessionId) => Promise<void>;
  /** Helpers exposed for the composer's send/queue logic. */
  acceptsControl: typeof runtimeStatusAcceptsControl;
};

export function useSessionEngine(deps: UseSessionEngineDeps): SessionEngine {
  const {
    tabs,
    activeTabId,
    runtimeSessionId,
    modelId,
    cwd,
    browserToolEnabled,
    browserBackend,
    canvasEnabled,
    onPiSessionIdChange,
    updateSession,
    selectionFor,
  } = deps;

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const selectionForRef = useRef(selectionFor);
  selectionForRef.current = selectionFor;

  const loadRuntimeStatusCb = useCallback(api.loadRuntimeStatus, []);

  const sendControl = useCallback(
    async (
      mode: "steer" | "follow_up",
      text: string,
      runtime: string,
      sessionId: SessionId,
      piSessionId?: string | null,
    ): Promise<{ ok: boolean; error?: string }> => {
      if (!text.trim() || !modelId) return { ok: false };
      const selection = selectionForRef.current(sessionId);
      const plugins = activeComposerPlugins(selection.plugins ?? EMPTY_PLUGINS);
      const skills = selection.skills ?? EMPTY_SKILLS;
      const promptTemplates = selection.promptTemplates ?? EMPTY_PROMPT_TEMPLATES;
      const browserEnabledForTurn = browserToolEnabled;
      const message = selectedContextPrompt(text, plugins, skills);
      try {
        const result = await api.submitTurnCommand({
          sessionId: runtime,
          modelId,
          message,
          cwd: cwd.trim() || undefined,
          piSessionId,
          mode,
          browserToolEnabled: browserEnabledForTurn,
          browserSessionId: runtime,
          browserBackend,
          canvasEnabled,
          plugins: plugins as ComposerPluginRef[],
          skills,
          promptTemplates,
        });
        updateSession(sessionId, (session) => ({
          ...session,
          piSessionId: result.piSessionId || session.piSessionId,
          contextUsage: api.runtimeContextUsage(result.status, session.contextUsage),
          status: "running",
        }));
        if (result.piSessionId) onPiSessionIdChange?.(result.piSessionId);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Message failed" };
      }
    },
    [
      browserToolEnabled,
      browserBackend,
      canvasEnabled,
      cwd,
      modelId,
      onPiSessionIdChange,
      updateSession,
    ],
  );

  const submitPrompt = useCallback(
    async (args: SubmitArgs) => {
      await submitPromptTurn(
        {
          activeTabId,
          browserToolEnabled,
          browserBackend,
          canvasEnabled,
          cwd,
          modelId,
          onPiSessionIdChange,
          runtimeSessionId,
          selectionFor: selectionForRef.current,
          tabsRef,
          updateSession,
        },
        args,
      );
    },
    [
      activeTabId,
      modelId,
      runtimeSessionId,
      cwd,
      browserToolEnabled,
      browserBackend,
      canvasEnabled,
      onPiSessionIdChange,
      updateSession,
    ],
  );

  const abortTurn = useCallback(
    async (sessionId: SessionId) => {
      const session = tabsRef.current.find((tab) => tab.id === sessionId);
      const runtime = resolveRuntimeSessionId(session, runtimeSessionId);
      await api.abortSession(runtime);
      updateSession(sessionId, (s) => ({ ...s, status: "idle" }));
    },
    [runtimeSessionId, updateSession],
  );

  const loadAndReplay = useCallback(
    async (piSessionId: string, sessionId: SessionId) => {
      if (!cwd) {
        // No cwd yet — we can't hydrate session history. Make sure the
        // session isn't left in a permanent "loading" state (which blocks
        // the composer's send button) just because the snapshot reducer
        // optimistically tagged it as loading on hydration.
        updateSession(sessionId, (session) =>
          session.status === "loading" ? { ...session, status: "idle" } : session,
        );
        return;
      }
      updateSession(sessionId, (session) => ({ ...session, status: "loading", error: "" }));
      try {
        const { events } = await api.loadCanonicalSession(piSessionId, cwd);
        const runtimeId = resolveRuntimeSessionId(
          tabsRef.current.find((tab) => tab.id === sessionId),
          runtimeSessionId,
        );
        const runtimeStatus = await api.loadRuntimeStatus(runtimeId, piSessionId);
        const runtimeActive = runtimeCanHydrateCanonicalSession(runtimeStatus, piSessionId);
        const replayEvents = mergeCanonicalAndRuntimeEvents(
          events,
          runtimeActive ? runtimeStatus?.events : [],
        );
        const {
          messages,
          title,
          startedAt,
          modelId: replayModelId,
        } = replaySessionEvents(replayEvents);
        const tokenStats = [...replayEvents]
          .slice(latestCompactionBoundaryIndex(replayEvents) + 1)
          .reverse()
          .map(usageFromEvent)
          .find((stats): stats is TokenStats => Boolean(stats));
        const replaySeq = replayCursorAfterRuntimeHydration(runtimeActive, runtimeStatus?.eventSeq);
        updateSession(sessionId, (session) => ({
          ...session,
          messages,
          piSessionId,
          cwd: session.cwd || cwd,
          modelId: session.modelId || replayModelId || runtimeStatus?.modelId || modelId,
          title: title ?? session.title,
          startedAt: startedAt ?? session.startedAt,
          tokenStats: tokenStats ?? undefined,
          contextUsage: api.runtimeContextUsage(runtimeStatus, session.contextUsage),
          status: runtimeActive ? "running" : "idle",
          activeAssistantId: undefined,
          error: "",
        }));
        // Reattach the live stream from the hydrated cursor so EventSource
        // does not replay already-rendered content.
        sessionRuntimeController().noteReplayHydrated(sessionId, replaySeq);
      } catch (err) {
        updateSession(sessionId, (session) => ({
          ...session,
          error: err instanceof Error ? err.message : "Failed to load session",
          status: "idle",
        }));
      }
    },
    [cwd, modelId, runtimeSessionId, updateSession],
  );

  const compact = useCallback(
    async (sessionId: SessionId) => {
      const session = tabsRef.current.find((tab) => tab.id === sessionId);
      if (!session || !modelId) return;
      updateSession(sessionId, (s) => ({ ...s, error: "" }));
      try {
        const result = await api.compactSession({
          sessionId: session.runtimeSessionId || runtimeSessionId,
          modelId,
          cwd: cwd.trim() || undefined,
          piSessionId: session.piSessionId,
          browserToolEnabled,
          browserSessionId: session.runtimeSessionId || runtimeSessionId,
          browserBackend,
          canvasEnabled,
          plugins: activeComposerPlugins(
            selectionForRef.current(sessionId).plugins ?? EMPTY_PLUGINS,
          ) as ComposerPluginRef[],
          skills: selectionForRef.current(sessionId).skills ?? EMPTY_SKILLS,
          promptTemplates:
            selectionForRef.current(sessionId).promptTemplates ?? EMPTY_PROMPT_TEMPLATES,
        });
        const nextSessionId = result.status?.piSessionId || session.piSessionId;
        if (nextSessionId) await loadAndReplay(nextSessionId, sessionId);
        updateSession(sessionId, (s) => ({
          ...s,
          contextUsage: api.runtimeContextUsage(result.status ?? null, null),
          tokenStats: undefined,
        }));
      } catch (error) {
        updateSession(sessionId, (s) => ({
          ...s,
          error: error instanceof Error ? error.message : "Compaction failed",
        }));
      }
    },
    [
      browserToolEnabled,
      browserBackend,
      canvasEnabled,
      cwd,
      loadAndReplay,
      modelId,
      runtimeSessionId,
      updateSession,
    ],
  );

  return useMemo<SessionEngine>(
    () => ({
      submitPrompt,
      sendControl,
      loadRuntimeStatus: loadRuntimeStatusCb,
      abortTurn,
      loadAndReplay,
      compact,
      acceptsControl: runtimeStatusAcceptsControl,
    }),
    [submitPrompt, sendControl, loadRuntimeStatusCb, abortTurn, loadAndReplay, compact],
  );
}

function latestCompactionBoundaryIndex(events: Record<string, unknown>[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const type = typeof event?.type === "string" ? event.type.toLowerCase() : "";
    if (isSuccessfulCompactionBoundary(event, type)) return index;
  }
  return -1;
}

function isSuccessfulCompactionBoundary(event: Record<string, unknown>, type: string): boolean {
  if (!type.includes("compact") && !type.includes("compaction")) return false;
  if (type.includes("start") || type.includes("begin")) return false;
  if (
    event.error ||
    event.errorMessage ||
    event.aborted ||
    event.cancelled ||
    event.canceled ||
    event.failed
  ) {
    return false;
  }
  if (event.type === "compaction_end" && event.result == null) return false;
  const status =
    typeof event.status === "string"
      ? event.status
      : typeof (event.result as { status?: unknown } | undefined)?.status === "string"
        ? (event.result as { status: string }).status
        : "";
  return !/abort|cancel|error|fail/.test(status.toLowerCase());
}
