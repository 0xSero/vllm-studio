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
import type { Session, SessionId } from "@/features/agent/runtime/types";
import { settleTurn } from "@/features/agent/runtime/session-status";

export type RuntimeSessionActivity = "running" | "unseen" | "finished";
export type RuntimeSessionActivitySnapshot = ReadonlyMap<string, RuntimeSessionActivity>;

export type SessionRuntimeBinding = {
  commit: (sessionId: SessionId, patch: (session: Session) => Session) => void;
  getSessions: () => readonly Session[];
};

export type SessionRuntimeControllerDeps = {
  subscribe?: typeof subscribeRuntimeActivity;
};

export type SessionRuntimeController = {
  bind(binding: SessionRuntimeBinding): void;
  unbind(): void;
  reconcile(sessions: readonly Session[]): void;
  closeAll(): void;
  activitySnapshot(): RuntimeSessionActivitySnapshot;
  subscribeActivity(listener: () => void): () => void;
  markActivitySeen(ids: readonly (string | null | undefined)[]): void;
};

function sameActivity(
  left: RuntimeSessionActivitySnapshot,
  right: RuntimeSessionActivitySnapshot,
): boolean {
  return left.size === right.size && [...left].every(([id, state]) => right.get(id) === state);
}

function projectRuntimeStatus(session: Session, status: RuntimeStatus): Session {
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
  if (status.active === true) {
    return {
      ...next,
      status: session.status === "stopping" ? "stopping" : "running",
      activeAssistantId: [...messages].reverse().find((message) => message.role === "assistant")
        ?.id,
    };
  }
  return session.status === "running" || session.status === "stopping" ? settleTurn(next) : next;
}

function matchingSession(
  sessions: readonly Session[],
  runtimeSessionId: string,
  status: RuntimeStatus,
): Session | null {
  const direct = sessions.find((session) => session.id === runtimeSessionId);
  if (direct) return direct;
  if (!status.piSessionId) return null;
  const matches = sessions.filter((session) => session.piSessionId === status.piSessionId);
  return matches.length === 1 ? matches[0]! : null;
}

export function createSessionRuntimeController(
  deps: SessionRuntimeControllerDeps = {},
): SessionRuntimeController {
  const subscribe = deps.subscribe ?? subscribeRuntimeActivity;
  const runtimeStatuses = new Map<string, RuntimeStatus>();
  const activityListeners = new Set<() => void>();
  let activity: RuntimeSessionActivitySnapshot = new Map();
  let binding: SessionRuntimeBinding | null = null;
  let closeSubscription: (() => void) | null = null;

  const applyStatus = (runtimeSessionId: string, status: RuntimeStatus) => {
    if (!binding) return;
    const target = matchingSession(binding.getSessions(), runtimeSessionId, status);
    if (!target) return;
    binding.commit(target.id, (session) => projectRuntimeStatus(session, status));
  };

  const publishActivity = () => {
    const active = new Set<string>();
    for (const [sessionId, status] of runtimeStatuses) {
      if (status.active !== true) continue;
      active.add(sessionId);
      if (status.piSessionId) active.add(status.piSessionId);
    }
    const next = new Map(activity);
    for (const [id, state] of next) {
      if (state === "running" && !active.has(id)) next.set(id, "finished");
    }
    for (const id of active) next.set(id, "running");
    if (sameActivity(activity, next)) return;
    activity = next;
    activityListeners.forEach((listener) => listener());
  };

  const applyPayload = (payload: RuntimeActivityPayload) => {
    if (payload.type === "sessions") {
      runtimeStatuses.clear();
      payload.sessions.forEach(({ sessionId, status }) => runtimeStatuses.set(sessionId, status));
      publishActivity();
      runtimeStatuses.forEach((status, sessionId) => applyStatus(sessionId, status));
      return;
    }
    const status = payload.type === "status" ? payload.session : payload.snapshot;
    runtimeStatuses.set(payload.sessionId, status);
    publishActivity();
    if (payload.type === "status") {
      applyStatus(payload.sessionId, status);
      return;
    }
    if (!binding) return;
    const target = matchingSession(binding.getSessions(), payload.sessionId, status);
    if (!target) return;
    binding.commit(target.id, (session) => {
      const projected = projectRuntimeStatus(session, status);
      const withError =
        payload.event.type === "notice" &&
        payload.event.level === "error" &&
        typeof payload.event.message === "string"
          ? { ...projected, error: payload.event.message.slice(0, 4_000) }
          : projected;
      if (isAgentSettledEvent(payload.event)) {
        return {
          ...settleTurn(withError),
          messages: settleOptimisticMessages(withError.messages),
        };
      }
      return {
        ...withError,
        status: session.status === "stopping" ? "stopping" : "running",
      };
    });
  };

  return {
    bind: (next) => {
      binding = next;
      closeSubscription ??= subscribe(applyPayload).close;
    },
    unbind: () => {
      binding = null;
    },
    reconcile: () => {
      runtimeStatuses.forEach((status, sessionId) => applyStatus(sessionId, status));
    },
    closeAll: () => {
      closeSubscription?.();
      closeSubscription = null;
      runtimeStatuses.clear();
      publishActivity();
    },
    activitySnapshot: () => activity,
    subscribeActivity: (listener) => {
      activityListeners.add(listener);
      return () => activityListeners.delete(listener);
    },
    markActivitySeen: (ids) => {
      const next = new Map(activity);
      for (const id of ids) {
        if (id) next.delete(id);
      }
      if (sameActivity(activity, next)) return;
      activity = next;
      activityListeners.forEach((listener) => listener());
    },
  };
}

let singleton: SessionRuntimeController | null = null;

export function sessionRuntimeController(): SessionRuntimeController {
  singleton ??= createSessionRuntimeController();
  return singleton;
}
