import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

import type { WorkspaceDispatch } from "@/lib/agent/workspace/effects";
import type { ChatMessage } from "@/lib/agent/session";
import type { Session, SessionId } from "@/lib/agent/sessions/types";
import {
  listRuntimeSessions,
  loadRuntimeStatus,
  subscribeRuntimeEvents,
  type RuntimeEventSubscription,
  type RuntimeStatus,
} from "@/lib/agent/sessions/api";
import { applyPiEventToSession } from "@/lib/agent/sessions/pi-event-applier";
import { subscribeResumeRuntimeSession } from "@/lib/agent/sessions/runtime-resume";
import {
  mirrorSessionLastEventSeq,
  shouldApplyRuntimeSeq,
  shouldSubscribeRuntimeEvents,
} from "@/lib/agent/sessions/runtime-subscription-state";
import { createTextDeltaCoalescer } from "@/lib/agent/sessions/text-delta-coalescer";

type UseWorkspaceRuntimeSyncDeps = {
  dispatch: WorkspaceDispatch;
  sessions: Session[];
};

type PiEventBatch = {
  assistantId: string;
  events: Record<string, unknown>[];
  timer: ReturnType<typeof setTimeout> | null;
};

function runtimeStatusActive(status: RuntimeStatus | null | undefined): boolean {
  return status?.active === true;
}

// Membership key for the resume subscriptions. Deliberately excludes the raw
// status string beyond the live/idle boundary. A prompt's optimistic
// "starting" phase deliberately does not subscribe yet: the runtime can still
// be idle from the previous turn, and subscribing too early can receive a final
// idle status before `/turn` has restarted Pi. Once the command endpoint
// returns, "running" opens the stream and replays any early events from the
// runtime log.
function runtimeSubscriptionKey(sessions: Session[]): string {
  return sessions
    .filter((session) => shouldSubscribeRuntimeEvents(session.status))
    .map((session) => `${session.id}:${session.runtimeSessionId}:${session.piSessionId ?? ""}`)
    .join("\n");
}

function resumeConnectionKey(runtimeSessionId: string, piSessionId: string | null): string {
  return `${runtimeSessionId}|${piSessionId ?? ""}`;
}

function runtimeRegistryKey(sessions: Session[]): string {
  return sessions
    .map(
      (session) =>
        `${session.id}:${session.runtimeSessionId}:${session.piSessionId ?? ""}:${session.status}`,
    )
    .join("\n");
}

function patchRuntimeStatus(status: RuntimeStatus): Partial<Session> {
  return {
    ...(status.piSessionId ? { piSessionId: status.piSessionId } : {}),
    ...(status.modelId ? { modelId: status.modelId } : {}),
    ...(status.contextUsage !== undefined ? { contextUsage: status.contextUsage } : {}),
  };
}

function sameRuntimePatch(
  session: Session,
  patch: Partial<Session>,
  status: string,
  runtimeSessionId = session.runtimeSessionId,
): boolean {
  return (
    session.status === status &&
    session.runtimeSessionId === runtimeSessionId &&
    (patch.piSessionId === undefined || session.piSessionId === patch.piSessionId) &&
    (patch.modelId === undefined || session.modelId === patch.modelId) &&
    (patch.contextUsage === undefined ||
      JSON.stringify(session.contextUsage ?? null) === JSON.stringify(patch.contextUsage ?? null))
  );
}

// The useSyncExternalStore subscriptions below run their side effects purely
// for the mount/cleanup lifecycle (effect hooks are banned in this codebase).
// A constant snapshot guarantees they never trigger a re-render.
const getRuntimeSyncSnapshot = (): number => 0;

export function useWorkspaceRuntimeSync({ dispatch, sessions }: UseWorkspaceRuntimeSyncDeps): void {
  const sessionsRef = useRef(sessions);
  const liveAssistantIdsRef = useRef<Map<SessionId, string>>(new Map());
  const piEventBatchesRef = useRef<Map<SessionId, PiEventBatch>>(new Map());
  const lastSeqBySessionRef = useRef<Map<SessionId, number>>(new Map());
  // Live resume subscriptions, one per session, managed incrementally so a
  // status flip never tears down and rebuilds unrelated connections.
  const resumeSubsRef = useRef<Map<SessionId, { key: string; sub: RuntimeEventSubscription }>>(
    new Map(),
  );

  // Mirror the latest sessions into a ref in the commit phase (never during
  // render) so the long-lived subscriptions below read the current value
  // without re-subscribing on every content update.
  const subscribeSessionsRef = useCallback(() => {
    sessionsRef.current = sessions;
    return () => undefined;
  }, [sessions]);
  useSyncExternalStore(subscribeSessionsRef, getRuntimeSyncSnapshot, getRuntimeSyncSnapshot);

  // Mirror the persisted cursor per session. Pi's per-runtime event sequence can
  // reset when a new prompt starts on the same Pi session, so deliberate
  // lastEventSeq resets must propagate into the in-memory gate too.
  const subscribeLastSeq = useCallback(() => {
    for (const session of sessions) {
      const next = mirrorSessionLastEventSeq(
        lastSeqBySessionRef.current.get(session.id),
        session.lastEventSeq,
      );
      if (typeof next === "number") {
        lastSeqBySessionRef.current.set(session.id, next);
      } else {
        lastSeqBySessionRef.current.delete(session.id);
      }
    }
    return () => undefined;
  }, [sessions]);
  useSyncExternalStore(subscribeLastSeq, getRuntimeSyncSnapshot, getRuntimeSyncSnapshot);

  const updateSession = useCallback(
    (sessionId: SessionId, patch: (session: Session) => Session) => {
      dispatch({ type: "patchSession", sessionId, patch });
    },
    [dispatch],
  );

  const patchAssistant = useCallback(
    (sessionId: SessionId, assistantId: string, patch: (message: ChatMessage) => ChatMessage) => {
      updateSession(sessionId, (session) => ({
        ...session,
        messages: session.messages.map((message) =>
          message.id === assistantId ? patch(message) : message,
        ),
      }));
    },
    [updateSession],
  );

  const applyPiEvent = useCallback(
    (sessionId: SessionId, assistantId: string, event: Record<string, unknown>) => {
      applyPiEventToSession(
        { liveAssistantIdsRef, patchAssistant, tabsRef: sessionsRef, updateSession },
        sessionId,
        assistantId,
        event,
      );
    },
    [patchAssistant, updateSession],
  );
  const applyPiEventRef = useRef(applyPiEvent);
  const subscribeApplyPiEventRef = useCallback(() => {
    applyPiEventRef.current = applyPiEvent;
    return () => undefined;
  }, [applyPiEvent]);
  useSyncExternalStore(subscribeApplyPiEventRef, getRuntimeSyncSnapshot, getRuntimeSyncSnapshot);

  // Single coalescer per hook instance, created lazily in the commit phase (not
  // during render, so the dispatcher's ref read stays lint-clean). It always
  // routes through the latest applyPiEvent.
  const coalescerRef = useRef<ReturnType<typeof createTextDeltaCoalescer> | null>(null);
  const subscribeCoalescer = useCallback(() => {
    coalescerRef.current ??= createTextDeltaCoalescer({
      applyPiEvent: (sessionId, assistantId, event) =>
        applyPiEventRef.current(sessionId, assistantId, event),
    });
    return () => undefined;
  }, []);
  useSyncExternalStore(subscribeCoalescer, getRuntimeSyncSnapshot, getRuntimeSyncSnapshot);

  const flushPiEvents = useCallback(
    (sessionId: SessionId) => {
      coalescerRef.current?.flushNow(sessionId);
      const batch = piEventBatchesRef.current.get(sessionId);
      if (!batch) return;
      if (batch.timer) clearTimeout(batch.timer);
      piEventBatchesRef.current.delete(sessionId);
      for (const event of batch.events) applyPiEvent(sessionId, batch.assistantId, event);
    },
    [applyPiEvent],
  );

  const enqueuePiEvent = useCallback(
    (
      sessionId: SessionId,
      assistantId: string,
      event: Record<string, unknown>,
      options: { flushNow?: boolean } = {},
    ) => {
      if (coalescerRef.current?.enqueuePiEvent(sessionId, assistantId, event, options)) {
        return;
      }
      coalescerRef.current?.flushNow(sessionId);
      if (options.flushNow) flushPiEvents(sessionId);
      applyPiEvent(sessionId, assistantId, event);
    },
    [applyPiEvent, flushPiEvents],
  );

  const shouldApplySeq = useCallback(
    (sessionId: SessionId, seq?: number): boolean => {
      const current = lastSeqBySessionRef.current.get(sessionId);
      const decision = shouldApplyRuntimeSeq(current, seq);
      if (!decision.apply) return false;
      if (typeof decision.next === "number")
        lastSeqBySessionRef.current.set(sessionId, decision.next);
      updateSession(sessionId, (session) =>
        typeof seq !== "number" ||
        (typeof session.lastEventSeq === "number" && seq <= session.lastEventSeq)
          ? session
          : { ...session, lastEventSeq: seq },
      );
      return true;
    },
    [updateSession],
  );

  const subscriptionKey = useMemo(() => runtimeSubscriptionKey(sessions), [sessions]);

  // Incremental reconciler: open a resume subscription when a session enters the
  // live set, close it when it leaves, and recreate it only when its connection
  // params (runtime/pi id) change. A transient status flip leaves every
  // existing connection untouched.
  const subscribeResume = useCallback(() => {
    const desired = new Map<SessionId, { runtimeSessionId: string; piSessionId: string | null }>();
    for (const session of sessionsRef.current) {
      if (shouldSubscribeRuntimeEvents(session.status) && session.runtimeSessionId) {
        desired.set(session.id, {
          runtimeSessionId: session.runtimeSessionId,
          piSessionId: session.piSessionId ?? null,
        });
      }
    }

    const subs = resumeSubsRef.current;
    for (const [sessionId, entry] of [...subs]) {
      const want = desired.get(sessionId);
      const key = want ? resumeConnectionKey(want.runtimeSessionId, want.piSessionId) : "";
      if (!want || entry.key !== key) {
        entry.sub.close();
        subs.delete(sessionId);
      }
    }

    for (const [sessionId, want] of desired) {
      if (subs.has(sessionId)) continue;
      const after =
        sessionsRef.current.find((session) => session.id === sessionId)?.lastEventSeq ?? 0;
      const sub = subscribeResumeRuntimeSession({
        after,
        api: { loadRuntimeStatus, subscribeRuntimeEvents },
        applyPiEvent: enqueuePiEvent,
        flushPiEvents,
        piSessionId: want.piSessionId,
        runtime: want.runtimeSessionId,
        sessionId,
        shouldApplySeq,
        submitPromptRef: { current: async () => undefined },
        tabsRef: sessionsRef,
        updateSession,
      });
      subs.set(sessionId, {
        key: resumeConnectionKey(want.runtimeSessionId, want.piSessionId),
        sub,
      });
    }
    return () => undefined;
  }, [subscriptionKey, enqueuePiEvent, flushPiEvents, shouldApplySeq, updateSession]);
  useSyncExternalStore(subscribeResume, getRuntimeSyncSnapshot, getRuntimeSyncSnapshot);

  const registryKey = useMemo(() => runtimeRegistryKey(sessions), [sessions]);

  const subscribePoll = useCallback(() => {
    if (sessionsRef.current.length === 0) return () => undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const reconcile = async () => {
      const runtimeSessions = await listRuntimeSessions();
      if (cancelled) return;
      const byRuntime = new Map(runtimeSessions.map((entry) => [entry.sessionId, entry.status]));
      const byPi = new Map(
        runtimeSessions
          .filter((entry) => entry.status.piSessionId)
          .map((entry) => [
            entry.status.piSessionId!,
            { runtimeSessionId: entry.sessionId, status: entry.status },
          ]),
      );
      for (const session of sessionsRef.current) {
        const direct = byRuntime.get(session.runtimeSessionId);
        const piMatch = session.piSessionId ? byPi.get(session.piSessionId) : undefined;
        const status = direct ?? piMatch?.status;
        if (!status) continue;
        const active = runtimeStatusActive(status);
        if (active) {
          const patch = patchRuntimeStatus(status);
          const nextRuntimeSessionId = piMatch?.runtimeSessionId ?? session.runtimeSessionId;
          updateSession(session.id, (current) => {
            if (sameRuntimePatch(current, patch, "running", nextRuntimeSessionId)) return current;
            return {
              ...current,
              ...(current.runtimeSessionId !== nextRuntimeSessionId
                ? { runtimeSessionId: nextRuntimeSessionId }
                : {}),
              ...patch,
              status: "running",
            };
          });
        } else if (session.status === "running") {
          // Only a session the runtime once acknowledged (status "running") may be
          // idled by the poll. A freshly-sent "starting" turn is not yet in the
          // runtime list during prefill/TTFT; idling it here would hide the
          // working indicator for several seconds until the first token lands.
          // The prompt stream's own `finally` owns the starting->terminal
          // transition, so the poll must not race it.
          const patch = patchRuntimeStatus(status);
          updateSession(session.id, (current) => {
            if (current.status !== "running") return current;
            if (sameRuntimePatch(current, patch, "idle") && !current.activeAssistantId) {
              return current;
            }
            return {
              ...current,
              ...patch,
              status: "idle",
              activeAssistantId: undefined,
            };
          });
        }
      }
    };

    void reconcile();
    timer = setInterval(() => void reconcile(), 5_000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [registryKey, updateSession]);
  useSyncExternalStore(subscribePoll, getRuntimeSyncSnapshot, getRuntimeSyncSnapshot);

  // Unmount cleanup: flush/dispose the coalescer, clear pending batches, and
  // close any open resume subscriptions.
  const subscribeCleanup = useCallback(
    () => () => {
      coalescerRef.current?.flushAll();
      coalescerRef.current?.dispose();
      for (const batch of piEventBatchesRef.current.values()) {
        if (batch.timer) clearTimeout(batch.timer);
      }
      piEventBatchesRef.current.clear();
      for (const entry of resumeSubsRef.current.values()) entry.sub.close();
      resumeSubsRef.current.clear();
    },
    [],
  );
  useSyncExternalStore(subscribeCleanup, getRuntimeSyncSnapshot, getRuntimeSyncSnapshot);
}
