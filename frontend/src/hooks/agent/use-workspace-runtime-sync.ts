import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

import type { WorkspaceDispatch } from "@/lib/agent/workspace/effects";
import type { Session, SessionId } from "@/lib/agent/sessions/types";
import { listRuntimeSessions, type RuntimeStatus } from "@/lib/agent/sessions/api";
import { shouldSubscribeRuntimeEvents } from "@/lib/agent/sessions/runtime-cursor";
import { sessionRuntimeController } from "@/lib/agent/sessions/session-runtime-controller";

type UseWorkspaceRuntimeSyncDeps = {
  dispatch: WorkspaceDispatch;
  sessions: Session[];
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

// React adapter for the session runtime controller: binds the workspace
// dispatcher as the controller's commit boundary, mirrors session cursors,
// reconciles SSE attachments against the live session set, and runs the 5s
// status poll. All ordering decisions live in the controller, not here.
export function useWorkspaceRuntimeSync({ dispatch, sessions }: UseWorkspaceRuntimeSyncDeps): void {
  const sessionsRef = useRef(sessions);

  // Mirror the latest sessions into a ref in the commit phase (never during
  // render) so the long-lived subscriptions below read the current value
  // without re-subscribing on every content update.
  const subscribeSessionsRef = useCallback(() => {
    sessionsRef.current = sessions;
    return () => undefined;
  }, [sessions]);
  useSyncExternalStore(subscribeSessionsRef, getRuntimeSyncSnapshot, getRuntimeSyncSnapshot);

  const updateSession = useCallback(
    (sessionId: SessionId, patch: (session: Session) => Session) => {
      dispatch({ type: "patchSession", sessionId, patch });
    },
    [dispatch],
  );

  // Bind the controller's commit boundary to the workspace dispatcher.
  const subscribeBinding = useCallback(() => {
    sessionRuntimeController().bind({
      commit: updateSession,
      getSession: (sessionId) =>
        sessionsRef.current.find((session) => session.id === sessionId),
    });
    return () => undefined;
  }, [updateSession]);
  useSyncExternalStore(subscribeBinding, getRuntimeSyncSnapshot, getRuntimeSyncSnapshot);

  // Mirror the persisted cursor per session on every change. Pi's per-runtime
  // event sequence can reset when a new prompt starts on the same Pi session,
  // so deliberate lastEventSeq resets must propagate into the gate too.
  const subscribeCursors = useCallback(() => {
    sessionRuntimeController().mirrorCursors(sessions);
    return () => undefined;
  }, [sessions]);
  useSyncExternalStore(subscribeCursors, getRuntimeSyncSnapshot, getRuntimeSyncSnapshot);

  const subscriptionKey = useMemo(() => runtimeSubscriptionKey(sessions), [sessions]);

  // Reconcile SSE attachments when the live membership (not content) changes.
  const subscribeResume = useCallback(() => {
    sessionRuntimeController().reconcile(sessionsRef.current);
    return () => undefined;
  }, [subscriptionKey]);
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

  // Unmount cleanup: flush pending deltas, close every SSE attachment, and
  // release the dispatcher binding.
  const subscribeCleanup = useCallback(
    () => () => {
      sessionRuntimeController().closeAll();
      sessionRuntimeController().unbind();
    },
    [],
  );
  useSyncExternalStore(subscribeCleanup, getRuntimeSyncSnapshot, getRuntimeSyncSnapshot);
}
