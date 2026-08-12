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
    ? optimisticOverlay(session.messages, status.messages)
    : session.messages;
  const next: Session = {
    ...session,
    messages,
    ...(status.tokenStats ? { tokenStats: status.tokenStats } : {}),
    ...(status.historyCursor !== undefined ? { historyCursor: status.historyCursor } : {}),
    ...(status.title ? { title: status.title } : {}),
    ...(status.startedAt ? { startedAt: status.startedAt } : {}),
    ...(status.usageTotals ? { usageTotals: status.usageTotals } : {}),
    ...(status.error ? { error: status.error } : {}),
    ...(status.piSessionId ? { piSessionId: status.piSessionId } : {}),
    ...(status.modelId ? { modelId: status.modelId } : {}),
    ...(status.contextUsage !== undefined ? { contextUsage: status.contextUsage } : {}),
    ...(status.queue ? { queue: [...status.queue.followUp] } : {}),
    extensionUiRequest: status.extensionUiRequest ?? undefined,
  };
  if (status.active !== true) {
    const settled = {
      ...next,
      messages: messages.map((message) =>
        message.pending || message.awaitingEcho
          ? { ...message, pending: false, awaitingEcho: false }
          : message,
      ),
    };
    return session.status === "running" || session.status === "stopping"
      ? settleTurn(settled)
      : settled;
  }
  return {
    ...next,
    status: session.status === "stopping" ? "stopping" : "running",
    activeAssistantId: [...messages].reverse().find((message) => message.role === "assistant")?.id,
  };
}

function optimisticOverlay(
  current: readonly Session["messages"][number][],
  snapshot: readonly Session["messages"][number][],
): Session["messages"] {
  const pending = current.filter(
    (message) =>
      (message.pending || message.awaitingEcho) &&
      !snapshot.some(
        (candidate) =>
          candidate.role === message.role && candidate.text.trim() === message.text.trim(),
      ),
  );
  return [...snapshot, ...pending];
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

  const apply = (sessionId: string, status: RuntimeStatus) => {
    statuses.set(sessionId, status);
    if (!binding) return;
    const target = matchingSession(binding.getSessions(), sessionId, status);
    if (!target) return;
    binding.commit(target.id, (session) => projectStatus(session, status));
  };

  const receive = (payload: RuntimeActivityPayload) => {
    if (payload.type === "sessions") {
      statuses.clear();
      payload.sessions.forEach(({ sessionId, status }) => apply(sessionId, status));
    } else {
      apply(payload.sessionId, payload.type === "status" ? payload.session : payload.snapshot);
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
