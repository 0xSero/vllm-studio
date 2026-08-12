import { isAgentSettledEvent } from "@shared/agent/pi-events";
import {
  mergeLiveTranscript,
  projectQueue,
  settleOptimisticMessages,
} from "@/features/agent/messages";
import {
  subscribeRuntimeActivity,
  type RuntimeActivityPayload,
  type RuntimeStatus,
} from "@/features/agent/runtime/api";
import { settleTurn } from "@/features/agent/runtime/session-status";
import type { Session, SessionId } from "@/features/agent/runtime/types";

export type RuntimeSessionActivity = "running" | "unseen" | "finished";
export type RuntimeSessionActivitySnapshot = ReadonlyMap<string, RuntimeSessionActivity>;
type Binding = {
  commit: (sessionId: SessionId, patch: (session: Session) => Session) => void;
  getSessions: () => readonly Session[];
};

function matchingSession(
  sessions: readonly Session[],
  runtimeSessionId: string,
  status: RuntimeStatus,
): Session | null {
  const direct = sessions.find((session) => session.id === runtimeSessionId);
  if (direct) return direct;
  const matches = status.piSessionId
    ? sessions.filter((session) => session.piSessionId === status.piSessionId)
    : [];
  return matches.length === 1 ? matches[0]! : null;
}

function projectStatus(session: Session, status: RuntimeStatus): Session {
  if (session.status === "loading") return session;
  const messages = status.messages
    ? mergeLiveTranscript(session.messages, status.messages)
    : session.messages;
  const next: Session = {
    ...session,
    messages,
    ...(status.tokenStats ? { tokenStats: status.tokenStats } : {}),
    ...(status.piSessionId ? { piSessionId: status.piSessionId } : {}),
    ...(status.modelId ? { modelId: status.modelId } : {}),
    ...(status.contextUsage !== undefined ? { contextUsage: status.contextUsage } : {}),
    ...(status.queue ? { queue: projectQueue(status.queue.followUp, session.queue ?? []) } : {}),
    extensionUiRequest: status.extensionUiRequest ?? undefined,
  };
  if (status.active !== true) {
    return session.status === "running" || session.status === "stopping" ? settleTurn(next) : next;
  }
  return {
    ...next,
    status: session.status === "stopping" ? "stopping" : "running",
    activeAssistantId: [...messages].reverse().find((message) => message.role === "assistant")?.id,
  };
}

function sameActivity(
  left: RuntimeSessionActivitySnapshot,
  right: RuntimeSessionActivitySnapshot,
): boolean {
  return left.size === right.size && [...left].every(([id, value]) => right.get(id) === value);
}

export function createSessionRuntimeController(
  deps: {
    subscribe?: typeof subscribeRuntimeActivity;
  } = {},
) {
  const statuses = new Map<string, RuntimeStatus>();
  const listeners = new Set<() => void>();
  let activity: RuntimeSessionActivitySnapshot = new Map();
  let binding: Binding | null = null;
  let close: (() => void) | null = null;

  const publish = () => {
    const active = new Set<string>();
    statuses.forEach((status, id) => {
      if (status.active !== true) return;
      active.add(id);
      if (status.piSessionId) active.add(status.piSessionId);
    });
    const next = new Map(activity);
    next.forEach((value, id) => {
      if (value === "running" && !active.has(id)) next.set(id, "finished");
    });
    active.forEach((id) => next.set(id, "running"));
    if (sameActivity(activity, next)) return;
    activity = next;
    listeners.forEach((listener) => listener());
  };

  const apply = (sessionId: string, status: RuntimeStatus, payload?: RuntimeActivityPayload) => {
    statuses.set(sessionId, status);
    if (!binding) return;
    const target = matchingSession(binding.getSessions(), sessionId, status);
    if (!target) return;
    binding.commit(target.id, (session) => {
      const projected = projectStatus(session, status);
      if (!payload || payload.type !== "pi") return projected;
      const error =
        payload.event.type === "notice" &&
        payload.event.level === "error" &&
        typeof payload.event.message === "string"
          ? { ...projected, error: payload.event.message.slice(0, 4_000) }
          : projected;
      return isAgentSettledEvent(payload.event)
        ? { ...settleTurn(error), messages: settleOptimisticMessages(error.messages) }
        : { ...error, status: session.status === "stopping" ? "stopping" : "running" };
    });
  };

  const receive = (payload: RuntimeActivityPayload) => {
    if (payload.type === "sessions") {
      statuses.clear();
      payload.sessions.forEach(({ sessionId, status }) => apply(sessionId, status));
    } else {
      apply(
        payload.sessionId,
        payload.type === "status" ? payload.session : payload.snapshot,
        payload,
      );
    }
    publish();
  };

  return {
    bind: (next: Binding) => {
      binding = next;
      close ??= (deps.subscribe ?? subscribeRuntimeActivity)(receive).close;
    },
    unbind: () => {
      binding = null;
    },
    reconcile: (_sessions?: readonly Session[]) =>
      statuses.forEach((status, id) => apply(id, status)),
    closeAll: () => {
      close?.();
      close = null;
      statuses.clear();
      publish();
    },
    activitySnapshot: () => activity,
    subscribeActivity: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    markActivitySeen: (ids: readonly (string | null | undefined)[]) => {
      const next = new Map(activity);
      ids.forEach((id) => id && next.delete(id));
      if (sameActivity(activity, next)) return;
      activity = next;
      listeners.forEach((listener) => listener());
    },
  };
}

let singleton: ReturnType<typeof createSessionRuntimeController> | null = null;

export function sessionRuntimeController() {
  singleton ??= createSessionRuntimeController();
  return singleton;
}
