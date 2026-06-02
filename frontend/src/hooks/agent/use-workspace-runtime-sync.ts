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
  hasRuntimePromptStream,
  runtimePromptStreamsSnapshot,
  subscribeRuntimePromptStreams,
} from "@/lib/agent/sessions/stream-ownership";
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

function liveSessionStatus(status: string): boolean {
  return status === "running" || status === "starting";
}

function runtimeStatusActive(status: RuntimeStatus | null | undefined): boolean {
  return status?.active === true;
}

// Membership key for the resume subscriptions. Deliberately excludes the raw
// status string: starting/running are both "live", so a starting->running flip
// must NOT churn connections. Only entering/leaving the live set, a changed
// runtime/pi id, or an ownership change re-evaluates the subscription set.
function runtimeSubscriptionKey(sessions: Session[], ownershipVersion: number): string {
  return `${ownershipVersion}\n${sessions
    .filter((session) => liveSessionStatus(session.status))
    .map((session) => `${session.id}:${session.runtimeSessionId}:${session.piSessionId ?? ""}`)
    .join("\n")}`;
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

  // Track the high-water lastEventSeq per session as sessions update.
  const subscribeLastSeq = useCallback(() => {
    for (const session of sessions) {
      if (typeof session.lastEventSeq === "number") {
        const current = lastSeqBySessionRef.current.get(session.id) ?? 0;
        if (session.lastEventSeq > current)
          lastSeqBySessionRef.current.set(session.id, session.lastEventSeq);
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
      if (typeof seq !== "number") return true;
      const current = lastSeqBySessionRef.current.get(sessionId) ?? 0;
      if (seq <= current) return false;
      lastSeqBySessionRef.current.set(sessionId, seq);
      updateSession(sessionId, (session) =>
        typeof session.lastEventSeq === "number" && seq <= session.lastEventSeq
          ? session
          : { ...session, lastEventSeq: seq },
      );
      return true;
    },
    [updateSession],
  );

  const ownershipVersion = useSyncExternalStore(
    subscribeRuntimePromptStreams,
    runtimePromptStreamsSnapshot,
    runtimePromptStreamsSnapshot,
  );
  const subscriptionKey = useMemo(
    () => runtimeSubscriptionKey(sessions, ownershipVersion),
    [ownershipVersion, sessions],
  );

  // Incremental reconciler: open a resume subscription when a session enters the
  // live-and-unowned set, close it when it leaves, and recreate it only when its
  // connection params (runtime/pi id) change. A transient status flip leaves
  // every existing connection untouched.
  const subscribeResume = useCallback(() => {
    const desired = new Map<SessionId, { runtimeSessionId: string; piSessionId: string | null }>();
    for (const session of sessionsRef.current) {
      if (
        liveSessionStatus(session.status) &&
        session.runtimeSessionId &&
        !hasRuntimePromptStream(session.runtimeSessionId)
      ) {
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
      subs.set(sessionId, { key: resumeConnectionKey(want.runtimeSessionId, want.piSessionId), sub });
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
