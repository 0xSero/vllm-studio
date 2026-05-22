import { useCallback, useMemo, useRef } from "react";
import {
  useSessionEngineBatchCleanupEffect,
  useSessionEngineRuntimeResumeEffect,
} from "@/hooks/agent/use-session-engine-effects";
import { isAgentEndEvent } from "@/lib/agent/pi-events";
import {
  type ChatMessage,
  type ChatMessageAttachment,
  mergeCanonicalAndRuntimeEvents,
  newId,
  nowLabel,
  piSessionIdFromEvent,
  replayCursorAfterRuntimeHydration,
  replaySessionEvents,
  runtimeStatusAcceptsControl,
  sessionTitleFromPrompt,
  statusAfterControlPhase,
  type TokenStats,
  usageFromEvent,
} from "@/lib/agent/session";
import {
  activeComposerPlugins,
  selectedContextPrompt,
  type ComposerPluginRef,
  type ComposerSkillRef,
} from "@/lib/agent/composer-context";
import type { AgentImageInput } from "@/lib/agent/contracts/turn";
import type { Session, SessionId, SessionStatus } from "@/lib/agent/sessions/types";
import type { ToolSelection } from "@/lib/agent/tools/types";
import * as api from "./api";
import {
  resolveResumeRuntimeTarget,
  resolveRuntimeSessionId,
  runtimeCanHydrateCanonicalSession,
  runtimeIsActiveForPiSession,
} from "./engine-helpers";
import { applyPiEventToSession } from "./pi-event-applier";
import { drainQueuedTurnAfterAgentEnd } from "./queue-drain";
import { createSessionBatcher } from "./session-batcher";

const EMPTY_PLUGINS: ComposerPluginRef[] = [];
const EMPTY_SKILLS: ComposerSkillRef[] = [];

type UpdateSession = (sessionId: SessionId, patch: (session: Session) => Session) => void;

type SubmitArgs = {
  text: string;
  /** Pre-resolved prompt text (with attachments / context already merged). */
  prompt: string;
  displayText: string;
  userText: string;
  images?: AgentImageInput[];
  attachments?: ChatMessageAttachment[];
  targetSessionId?: SessionId;
};

export type UseSessionEngineDeps = {
  /** Latest `tabs` snapshot — engine reads via a ref so it doesn't restart on every frame. */
  tabs: Session[];
  activeTabId: SessionId;
  /** Runtime session id used when a session doesn't carry its own. */
  runtimeSessionId: string;
  modelId: string;
  cwd: string;
  browserToolEnabled: boolean;
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
  loadRuntimeStatus: (runtime: string) => Promise<api.RuntimeStatus | null>;
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
    canvasEnabled,
    onPiSessionIdChange,
    updateSession,
    selectionFor,
  } = deps;

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const selectionForRef = useRef(selectionFor);
  selectionForRef.current = selectionFor;

  // Tracks which sessions own their stream right now (we own = don't double-
  // subscribe via the resume-runtime SSE). Keyed by session id.
  const localStreamRef = useRef<Set<SessionId>>(new Set());
  // The "live" assistant message id we're currently appending to, per session.
  // Pi can split a single user turn across multiple assistant messages (after
  // a queue_update / message_start), and we need a stable id to patch.
  const liveAssistantIdsRef = useRef<Map<SessionId, string>>(new Map());

  // Per-session frame queue. Each entry is either a raw Pi event (applied via
  // `applyPiEventToSession`) or a direct session patch (status / lastEventSeq /
  // piSessionId / etc. emitted by the SSE handler outside the Pi taxonomy).
  // The whole queue drains inside one `requestAnimationFrame` tick through the
  // session batcher, so a frame of streaming maps to exactly one React commit.
  type FrameItem =
    | { kind: "pi"; assistantId: string; event: Record<string, unknown> }
    | { kind: "patch"; patch: (session: Session) => Session };
  type FrameQueue = {
    assistantId: string;
    items: FrameItem[];
    rafId: number | null;
  };
  const piEventBatchesRef = useRef<Map<SessionId, FrameQueue>>(new Map());

  // The session batcher composes every `updateSession` call made during a
  // single flush into ONE functional patch — both our direct `updateSession`
  // calls and the (potentially many) calls that `applyPiEventToSession` makes
  // internally for queue/token/user-message/assistant-message bookkeeping.
  // We always read the LATEST `updateSession` via a ref so the batcher itself
  // can stay stable for the component's lifetime.
  const updateSessionRef = useRef(updateSession);
  updateSessionRef.current = updateSession;
  const batcherRef = useRef(
    createSessionBatcher((sessionId, patch) => updateSessionRef.current(sessionId, patch)),
  );

  const flushPiEventBatch = useCallback((sessionId: SessionId) => {
    const batch = piEventBatchesRef.current.get(sessionId);
    if (!batch) return;
    if (batch.rafId != null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(batch.rafId);
    }
    piEventBatchesRef.current.delete(sessionId);
    if (batch.items.length === 0) return;
    batcherRef.current.run(sessionId, (update) => {
      const patchAssistant = (
        sid: SessionId,
        assistantId: string,
        patch: (msg: ChatMessage) => ChatMessage,
      ) => {
        update(sid, (session) => ({
          ...session,
          messages: session.messages.map((m) => (m.id === assistantId ? patch(m) : m)),
        }));
      };
      for (const item of batch.items) {
        if (item.kind === "patch") {
          update(sessionId, item.patch);
          continue;
        }
        applyPiEventToSession(
          {
            liveAssistantIdsRef,
            patchAssistant,
            tabsRef,
            updateSession: update,
          },
          sessionId,
          item.assistantId,
          item.event,
        );
      }
    });
  }, []);

  // Schedule a per-session drain on the next animation frame. We use rAF (with
  // a `setTimeout(..., 16)` fallback for hidden tabs / SSR) so streaming
  // updates align with the browser's paint cadence — the same trick Codex's
  // `frameTextDeltaQueue` uses.
  const scheduleFrame = useCallback(
    (sessionId: SessionId, queue: FrameQueue) => {
      if (queue.rafId != null) return;
      const raf =
        typeof requestAnimationFrame === "function"
          ? requestAnimationFrame
          : (callback: FrameRequestCallback) =>
              setTimeout(() => callback(performance.now()), 16) as unknown as number;
      queue.rafId = raf(() => {
        queue.rafId = null;
        flushPiEventBatch(sessionId);
      });
    },
    [flushPiEventBatch],
  );

  function getOrCreateQueue(sessionId: SessionId, assistantId: string): FrameQueue {
    let queue = piEventBatchesRef.current.get(sessionId);
    if (!queue) {
      queue = { assistantId, items: [], rafId: null };
      piEventBatchesRef.current.set(sessionId, queue);
    } else if (assistantId && !queue.assistantId) {
      queue.assistantId = assistantId;
    }
    return queue;
  }

  // Enqueue an out-of-Pi-taxonomy session patch (e.g. status / lastEventSeq /
  // piSessionId / activeAssistantId / error) onto the same frame queue Pi
  // events flow through. This is what eliminates the "3 extra updateSession
  // calls per Pi event" cost the audit identified.
  const enqueueSessionPatch = useCallback(
    (
      sessionId: SessionId,
      patch: (session: Session) => Session,
      options: { flushNow?: boolean; assistantId?: string } = {},
    ) => {
      const queue = getOrCreateQueue(sessionId, options.assistantId ?? "");
      queue.items.push({ kind: "patch", patch });
      if (options.flushNow) {
        flushPiEventBatch(sessionId);
        return;
      }
      scheduleFrame(sessionId, queue);
    },
    [flushPiEventBatch, scheduleFrame],
  );

  const enqueuePiEvent = useCallback(
    (
      sessionId: SessionId,
      assistantId: string,
      event: Record<string, unknown>,
      options: { flushNow?: boolean } = {},
    ) => {
      const queue = getOrCreateQueue(sessionId, assistantId);
      queue.items.push({ kind: "pi", assistantId, event });
      if (options.flushNow) {
        flushPiEventBatch(sessionId);
        return;
      }
      scheduleFrame(sessionId, queue);
    },
    [flushPiEventBatch, scheduleFrame],
  );

  useSessionEngineBatchCleanupEffect({ piEventBatchesRef });

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
      const message = selectedContextPrompt(text, plugins, skills);
      const ensureAssistantId = () => {
        const current = tabsRef.current.find((tab) => tab.id === sessionId);
        const existing =
          (current?.activeAssistantId &&
            current.messages.some((entry) => entry.id === current.activeAssistantId) &&
            current.activeAssistantId) ||
          [...(current?.messages ?? [])].reverse().find((entry) => entry.role === "assistant")?.id;
        if (existing) return existing;
        const assistantId = newId("assistant");
        updateSession(sessionId, (session) => ({
          ...session,
          activeAssistantId: assistantId,
          messages: [
            ...session.messages,
            { id: assistantId, role: "assistant", text: "", blocks: [], timestamp: nowLabel() },
          ],
        }));
        return assistantId;
      };
      try {
        let controlError = "";
        await api.submitTurnStream(
          {
            sessionId: runtime,
            modelId,
            message,
            cwd: cwd.trim() || undefined,
            piSessionId,
            mode,
            browserToolEnabled,
            browserSessionId: runtime,
            canvasEnabled,
            plugins: plugins as ComposerPluginRef[],
            skills,
          },
          (payload) => {
            if (payload.type === "error") controlError = payload.error;
            if (payload.type === "status") {
              // Status transitions are user-visible chrome; flush immediately
              // so any UI bound to `session.status` reacts on the same tick.
              enqueueSessionPatch(
                sessionId,
                (session) => ({
                  ...session,
                  piSessionId: payload.piSessionId || session.piSessionId,
                  status: statusAfterControlPhase(session.status, payload.phase),
                }),
                { flushNow: true },
              );
            }
            if (payload.type === "pi") {
              const eventId = piSessionIdFromEvent(payload.event);
              const assistantId = ensureAssistantId();
              const agentEnded = isAgentEndEvent(payload.event);
              const seq = typeof payload.seq === "number" ? payload.seq : undefined;
              enqueueSessionPatch(
                sessionId,
                (session) => ({
                  ...session,
                  piSessionId: eventId || session.piSessionId,
                  lastEventSeq: seq ?? session.lastEventSeq,
                  status: agentEnded ? "idle" : session.status,
                  activeAssistantId: agentEnded ? undefined : assistantId,
                }),
                { assistantId },
              );
              if (eventId) onPiSessionIdChange?.(eventId);
              enqueuePiEvent(sessionId, assistantId, payload.event, { flushNow: agentEnded });
            }
          },
        );
        if (controlError) throw new Error(controlError);
        return { ok: true };
      } catch (error) {
        flushPiEventBatch(sessionId);
        return { ok: false, error: error instanceof Error ? error.message : "Message failed" };
      }
    },
    [
      browserToolEnabled,
      canvasEnabled,
      cwd,
      enqueuePiEvent,
      enqueueSessionPatch,
      flushPiEventBatch,
      modelId,
      onPiSessionIdChange,
      updateSession,
    ],
  );

  // Stable ref for the queue-drain self-call from inside submitPrompt and the
  // resume-runtime SSE handler.
  const submitPromptRef = useRef<(args: SubmitArgs) => Promise<void>>(() => Promise.resolve());

  const submitPrompt = useCallback(
    async (args: SubmitArgs) => {
      const sessionId = args.targetSessionId ?? activeTabId;
      const selected = tabsRef.current.find((tab) => tab.id === sessionId);
      if (!selected || !modelId) return;

      const userId = newId("user");
      const assistantId = newId("assistant");
      const runtime = selected.runtimeSessionId || runtimeSessionId;

      // Optimistic: push a user message + a blank assistant placeholder so the
      // UI shows "we received it" even before the first SSE chunk lands.
      updateSession(sessionId, (session) => ({
        ...session,
        cwd: session.cwd || cwd,
        modelId: session.modelId || modelId,
        startedAt: session.startedAt ?? new Date().toISOString(),
        input: "",
        error: "",
        status: "starting",
        activeAssistantId: assistantId,
        title:
          session.messages.filter((m) => m.role === "user").length === 0
            ? sessionTitleFromPrompt(args.userText)
            : session.title,
        messages: [
          ...session.messages,
          {
            id: userId,
            role: "user",
            text: args.displayText,
            attachments: args.attachments,
            timestamp: nowLabel(),
          },
          { id: assistantId, role: "assistant", text: "", blocks: [], timestamp: nowLabel() },
        ],
      }));

      let agentEnded = false;
      let streamError = "";
      liveAssistantIdsRef.current.set(sessionId, assistantId);
      localStreamRef.current.add(sessionId);
      try {
        await api.submitTurnStream(
          {
            sessionId: runtime,
            modelId,
            message: args.prompt,
            images: args.images,
            cwd: cwd.trim() || undefined,
            piSessionId:
              tabsRef.current.find((tab) => tab.id === sessionId)?.piSessionId ??
              selected.piSessionId,
            browserToolEnabled,
            browserSessionId: runtime,
            canvasEnabled,
            plugins: activeComposerPlugins(
              selectionForRef.current(sessionId).plugins ?? EMPTY_PLUGINS,
            ) as ComposerPluginRef[],
            skills: selectionForRef.current(sessionId).skills ?? EMPTY_SKILLS,
          },
          (payload) => {
            if (payload.type === "status") {
              const phase = payload.phase;
              enqueueSessionPatch(
                sessionId,
                (session) => ({
                  ...session,
                  piSessionId: payload.piSessionId || session.piSessionId,
                  status: (phase === "done" ? "idle" : phase) as SessionStatus,
                  activeAssistantId: phase === "done" ? undefined : session.activeAssistantId,
                }),
                { flushNow: true },
              );
              if (payload.piSessionId) onPiSessionIdChange?.(payload.piSessionId);
            } else if (payload.type === "error") {
              streamError = payload.error;
              enqueueSessionPatch(
                sessionId,
                (session) => ({ ...session, error: payload.error, status: "idle" }),
                { flushNow: true },
              );
            } else if (payload.type === "pi") {
              const piEvent = payload.event;
              const eventId = piSessionIdFromEvent(piEvent);
              if (eventId) onPiSessionIdChange?.(eventId);
              if (isAgentEndEvent(piEvent)) {
                agentEnded = true;
                const latestPiSessionId =
                  eventId ??
                  tabsRef.current.find((tab) => tab.id === sessionId)?.piSessionId ??
                  selected.piSessionId ??
                  "";
                onPiSessionIdChange?.(latestPiSessionId);
              }
              // Coalesce the three previously-bare `updateSession` calls
              // (piSessionId, lastEventSeq, agent-end housekeeping) into one
              // patch that rides on the same animation frame as the Pi event.
              const seq = typeof payload.seq === "number" ? payload.seq : undefined;
              if (eventId || seq !== undefined || agentEnded) {
                enqueueSessionPatch(
                  sessionId,
                  (session) => ({
                    ...session,
                    piSessionId: eventId || session.piSessionId,
                    lastEventSeq: seq ?? session.lastEventSeq,
                    activeAssistantId: agentEnded ? undefined : session.activeAssistantId,
                  }),
                  { assistantId },
                );
              }
              enqueuePiEvent(sessionId, assistantId, piEvent, { flushNow: agentEnded });
            }
          },
        );
      } catch (err) {
        streamError = err instanceof Error ? err.message : "Agent request failed";
      } finally {
        flushPiEventBatch(sessionId);
        localStreamRef.current.delete(sessionId);
        liveAssistantIdsRef.current.delete(sessionId);
        const runtimeStatus = agentEnded ? null : await api.loadRuntimeStatus(runtime);
        const currentPiSessionId =
          tabsRef.current.find((tab) => tab.id === sessionId)?.piSessionId ??
          selected.piSessionId ??
          null;
        const runtimeStillActive = runtimeIsActiveForPiSession(runtimeStatus, currentPiSessionId);
        updateSession(sessionId, (session) => ({
          ...session,
          status: runtimeStillActive ? "running" : "idle",
          activeAssistantId: runtimeStillActive ? assistantId : undefined,
          error: streamError
            ? runtimeStillActive
              ? `${streamError}; reattaching to the running session.`
              : streamError
            : session.error,
        }));
      }

      // Drain the per-session queue once the agent finished its turn.
      if (agentEnded) {
        drainQueuedTurnAfterAgentEnd({ submitPromptRef, tabsRef, updateSession }, sessionId);
      }
    },
    [
      activeTabId,
      modelId,
      runtimeSessionId,
      cwd,
      browserToolEnabled,
      canvasEnabled,
      onPiSessionIdChange,
      enqueuePiEvent,
      enqueueSessionPatch,
      flushPiEventBatch,
      updateSession,
    ],
  );

  submitPromptRef.current = submitPrompt;

  const abortTurn = useCallback(
    async (sessionId: SessionId) => {
      const session = tabsRef.current.find((tab) => tab.id === sessionId);
      const runtime = resolveRuntimeSessionId(session, runtimeSessionId);
      await api.abortSession(runtime);
      flushPiEventBatch(sessionId);
      updateSession(sessionId, (s) => ({ ...s, status: "idle" }));
    },
    [flushPiEventBatch, runtimeSessionId, updateSession],
  );

  const loadAndReplay = useCallback(
    async (piSessionId: string, sessionId: SessionId) => {
      if (!cwd) return;
      updateSession(sessionId, (session) => ({ ...session, status: "loading", error: "" }));
      try {
        const { events } = await api.loadCanonicalSession(piSessionId, cwd);
        const runtimeId = resolveRuntimeSessionId(
          tabsRef.current.find((tab) => tab.id === sessionId),
          runtimeSessionId,
        );
        const runtimeStatus = await api.loadRuntimeStatus(runtimeId);
        const runtimeActive = runtimeCanHydrateCanonicalSession(runtimeStatus, piSessionId);
        const replayEvents = mergeCanonicalAndRuntimeEvents(
          events,
          runtimeActive ? runtimeStatus?.events : [],
        );
        const { messages, title, startedAt } = replaySessionEvents(replayEvents);
        const tokenStats = [...replayEvents]
          .reverse()
          .map(usageFromEvent)
          .find((stats): stats is TokenStats => Boolean(stats));
        const replaySeq = replayCursorAfterRuntimeHydration(runtimeActive, runtimeStatus?.eventSeq);
        updateSession(sessionId, (session) => ({
          ...session,
          messages,
          piSessionId,
          cwd: session.cwd || cwd,
          modelId: session.modelId || modelId,
          title: title ?? session.title,
          startedAt: startedAt ?? session.startedAt,
          tokenStats: tokenStats ?? session.tokenStats,
          status: runtimeActive ? "running" : "idle",
          activeAssistantId: undefined,
          lastEventSeq: replaySeq,
          error: "",
        }));
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
          canvasEnabled,
          plugins: activeComposerPlugins(
            selectionForRef.current(sessionId).plugins ?? EMPTY_PLUGINS,
          ) as ComposerPluginRef[],
          skills: selectionForRef.current(sessionId).skills ?? EMPTY_SKILLS,
        });
        const nextSessionId = result.status?.piSessionId || session.piSessionId;
        if (nextSessionId) await loadAndReplay(nextSessionId, sessionId);
      } catch (error) {
        updateSession(sessionId, (s) => ({
          ...s,
          error: error instanceof Error ? error.message : "Compaction failed",
        }));
      }
    },
    [
      browserToolEnabled,
      canvasEnabled,
      cwd,
      loadAndReplay,
      modelId,
      runtimeSessionId,
      updateSession,
    ],
  );

  // Resume an in-flight runtime session via SSE — fires when the active
  // session's status flips to running/starting and we *don't* own the local
  // stream (e.g. after a refresh, or when a different pane joins a running
  // session).
  const resumeRuntimeTarget = resolveResumeRuntimeTarget(
    tabsRef.current,
    activeTabId,
    runtimeSessionId,
  );
  const resumeRuntimeId = resumeRuntimeTarget?.sessionId ?? null;
  const resumeRuntimeSessionId = resumeRuntimeTarget?.runtimeSessionId ?? null;
  const resumeAfter = resumeRuntimeTarget?.after ?? 0;

  useSessionEngineRuntimeResumeEffect({
    after: resumeAfter,
    applyPiEvent: enqueuePiEvent,
    flushPiEvents: flushPiEventBatch,
    localStreamRef,
    onPiSessionIdChange,
    runtime: resumeRuntimeSessionId,
    sessionId: resumeRuntimeId,
    submitPromptRef,
    tabsRef,
    updateSession,
  });

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
