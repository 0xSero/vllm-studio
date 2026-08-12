import { isAgentSettledEvent } from "@shared/agent/pi-events";
import {
  mergeLiveTranscript,
  projectQueue,
  projectTranscript,
  settleOptimisticMessages,
} from "@/features/agent/messages";
import {
  subscribeRuntimeActivity,
  type RuntimeActivityPayload,
  type RuntimeSessionSummary,
  type RuntimeStatus,
} from "@/features/agent/runtime/api";
import type { Session, SessionId } from "@/features/agent/runtime/types";
import { publishRuntimeActivity } from "@/features/agent/session-index";
import { settleTurn } from "@/features/agent/runtime/session-status";

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
};

function projectRuntimeStatus(session: Session, status: RuntimeStatus): Session {
  if (session.status === "loading") return session;
  const projection = status.messages ? projectTranscript(status.messages, session.messages) : null;
  const messages = projection
    ? mergeLiveTranscript(session.messages, projection.messages)
    : session.messages;
  const next: Session = {
    ...session,
    messages,
    ...(projection?.tokenStats ? { tokenStats: projection.tokenStats } : {}),
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
  let binding: SessionRuntimeBinding | null = null;
  let closeSubscription: (() => void) | null = null;

  const summaries = (): RuntimeSessionSummary[] =>
    [...runtimeStatuses].map(([sessionId, status]) => ({ sessionId, status }));

  const applyStatus = (runtimeSessionId: string, status: RuntimeStatus) => {
    if (!binding) return;
    const target = matchingSession(binding.getSessions(), runtimeSessionId, status);
    if (!target) return;
    binding.commit(target.id, (session) => projectRuntimeStatus(session, status));
  };

  const publish = () => publishRuntimeActivity(summaries());

  const applyPayload = (payload: RuntimeActivityPayload) => {
    if (payload.type === "sessions") {
      runtimeStatuses.clear();
      payload.sessions.forEach(({ sessionId, status }) => runtimeStatuses.set(sessionId, status));
      publish();
      runtimeStatuses.forEach((status, sessionId) => applyStatus(sessionId, status));
      return;
    }
    const status = payload.type === "status" ? payload.session : payload.snapshot;
    runtimeStatuses.set(payload.sessionId, status);
    publish();
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
      publishRuntimeActivity([]);
    },
  };
}

let singleton: SessionRuntimeController | null = null;

export function sessionRuntimeController(): SessionRuntimeController {
  singleton ??= createSessionRuntimeController();
  return singleton;
}
