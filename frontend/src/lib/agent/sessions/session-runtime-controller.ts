// THE single owner of live session event ordering. This module — and only
// this module — opens runtime SSE subscriptions, tracks per-session event
// cursors, reconnects, flushes the text-delta coalescer, and reduces runtime
// events into session state. React integrates through a thin binding
// (use-workspace-runtime-sync.ts); nothing else may subscribe to runtime
// events or gate event seqs.

import { isAgentEndEvent } from "@/lib/agent/pi-events";
import { newId, nowLabel, piSessionIdFromEvent } from "@/lib/agent/session";
import {
  loadRuntimeStatus,
  runtimeContextUsage,
  subscribeRuntimeEvents,
  type RuntimeEventPayload,
  type RuntimeEventSubscription,
  type RuntimeStatus,
} from "./api";
import { reduceSessionEvent, type SessionStreamContext } from "./pi-event-applier";
import { drainQueuedTurnAfterAgentEnd } from "./queue-drain";
import {
  acceptRuntimeSeq,
  adoptExternalCursor,
  commitRuntimeSeq,
  reconnectAfter,
  shouldSubscribeRuntimeEvents,
  type RuntimeCursor,
} from "./runtime-cursor";
import { createTextDeltaCoalescer } from "./text-delta-coalescer";
import type { Session, SessionId } from "./types";

const RESUME_IDLE_RECONNECT_MS = 15_000;
const RESUME_RECONNECT_DELAY_MS = 1_000;

type ScheduleFrame = (callback: () => void) => { cancel: () => void };

export type SessionRuntimeBinding = {
  /** Single state commit boundary — one patchSession dispatch per call. */
  commit: (sessionId: SessionId, patch: (session: Session) => Session) => void;
  /** Read the current session snapshot (never cached by the controller). */
  getSession: (sessionId: SessionId) => Session | undefined;
};

export type SessionRuntimeControllerDeps = {
  api?: {
    loadRuntimeStatus: typeof loadRuntimeStatus;
    subscribeRuntimeEvents: typeof subscribeRuntimeEvents;
  };
  scheduleFrame?: ScheduleFrame;
  reconnectDelayMs?: number;
  idleReconnectMs?: number;
};

export type SessionRuntimeController = {
  bind(binding: SessionRuntimeBinding): void;
  unbind(): void;
  /**
   * Reconcile live SSE attachments against the session set: attach sessions
   * entering the live set, detach those leaving, recreate only when the
   * connection params (runtime/pi id) change.
   */
  reconcile(sessions: readonly Session[]): void;
  /**
   * A `/turn` command was accepted: Pi's per-runtime event seq restarts, so
   * reset the cursor to 0, drop any pending deltas from the previous epoch,
   * and persist the reset. The deliberate backwards move — without it the
   * gate silently drops the entire next turn.
   */
  noteTurnAccepted(sessionId: SessionId): void;
  /**
   * loadAndReplay hydrated the transcript from canonical + runtime logs up to
   * `committedSeq` (undefined when the runtime is idle): reattach from there
   * so EventSource does not replay already-rendered content.
   */
  noteReplayHydrated(sessionId: SessionId, committedSeq: number | undefined): void;
  /** Apply any coalesced-but-unflushed deltas for a session right now. */
  flush(sessionId: SessionId): void;
  /** Flush everything and close every SSE attachment (workspace unmount). */
  closeAll(): void;
};

type Attachment = { key: string; close: () => void };

function resumeConnectionKey(runtimeSessionId: string, piSessionId: string | null): string {
  return `${runtimeSessionId}|${piSessionId ?? ""}`;
}

export function createSessionRuntimeController(
  deps: SessionRuntimeControllerDeps = {},
): SessionRuntimeController {
  const api = deps.api ?? { loadRuntimeStatus, subscribeRuntimeEvents };
  const reconnectDelayMs = deps.reconnectDelayMs ?? RESUME_RECONNECT_DELAY_MS;
  const idleReconnectMs = deps.idleReconnectMs ?? RESUME_IDLE_RECONNECT_MS;

  let binding: SessionRuntimeBinding | null = null;
  const cursors = new Map<SessionId, RuntimeCursor>();
  const streamContext: SessionStreamContext = { liveAssistantIds: new Map() };
  const attachments = new Map<SessionId, Attachment>();

  const commit = (sessionId: SessionId, patch: (session: Session) => Session) => {
    binding?.commit(sessionId, patch);
  };
  const getSession = (sessionId: SessionId) => binding?.getSession(sessionId);

  // Stamp the committed cursor onto the session in the SAME commit that
  // applies the event's effects — content and cursor land atomically, so a
  // teardown can never persist a cursor ahead of rendered content.
  const stampSeq = (session: Session, seq: number | undefined): Session => {
    if (typeof seq !== "number") return session;
    if (typeof session.lastEventSeq === "number" && seq <= session.lastEventSeq) return session;
    return { ...session, lastEventSeq: seq };
  };

  const applyEvent = (
    sessionId: SessionId,
    assistantId: string,
    event: Record<string, unknown>,
    seq?: number,
    decorate: (session: Session) => Session = (session) => session,
  ) => {
    commit(sessionId, (session) =>
      decorate(stampSeq(reduceSessionEvent(session, streamContext, assistantId, event), seq)),
    );
    cursors.set(
      sessionId,
      commitRuntimeSeq(cursors.get(sessionId) ?? adoptExternalCursor(undefined), seq),
    );
  };

  const coalescer = createTextDeltaCoalescer({
    applyPiEvent: applyEvent,
    scheduleFrame: deps.scheduleFrame,
  });

  const enqueueEvent = (
    sessionId: SessionId,
    assistantId: string,
    event: Record<string, unknown>,
    seq: number | undefined,
  ) => {
    if (coalescer.enqueuePiEvent(sessionId, assistantId, event, { seq })) return;
    // Non-delta events flush any pending merge first so ordering is preserved.
    coalescer.flushNow(sessionId);
    applyEvent(sessionId, assistantId, event, seq);
  };

  // Receive gate: advance receivedSeq immediately (dedup + reconnect cursor);
  // committedSeq — and the persisted lastEventSeq — only advance when the
  // event's effects are actually committed (see applyEvent).
  const acceptSeq = (sessionId: SessionId, seq?: number): boolean => {
    const current = cursors.get(sessionId) ?? adoptExternalCursor(undefined);
    const decision = acceptRuntimeSeq(current, seq);
    if (decision.accept) cursors.set(sessionId, decision.cursor);
    return decision.accept;
  };

  const adoptCursor = (sessionId: SessionId, committedSeq: number | undefined) => {
    coalescer.discard(sessionId);
    cursors.set(sessionId, adoptExternalCursor(committedSeq));
    commit(sessionId, (session) =>
      session.lastEventSeq === committedSeq ? session : { ...session, lastEventSeq: committedSeq },
    );
  };

  // Resolve (or create) the assistant bubble that live events should target.
  const ensureAssistantId = (sessionId: SessionId): string => {
    const current = getSession(sessionId);
    const existing =
      (current?.activeAssistantId &&
        current.messages.some((message) => message.id === current.activeAssistantId) &&
        current.activeAssistantId) ||
      [...(current?.messages ?? [])].reverse().find((message) => message.role === "assistant")?.id;
    if (existing) {
      commit(sessionId, (session) =>
        session.activeAssistantId === existing ? session : { ...session, activeAssistantId: existing },
      );
      return existing;
    }

    const assistantId = newId("assistant");
    commit(sessionId, (session) => ({
      ...session,
      activeAssistantId: assistantId,
      messages: [
        ...session.messages,
        { id: assistantId, role: "assistant", text: "", blocks: [], timestamp: nowLabel() },
      ],
    }));
    return assistantId;
  };

  const applyStatusPayload = (
    sessionId: SessionId,
    payload: Extract<RuntimeEventPayload, { type: "status" }>,
  ) => {
    const idle = payload.phase === "done" || payload.phase === "idle";
    commit(sessionId, (session) => ({
      ...session,
      piSessionId: payload.session?.piSessionId || session.piSessionId,
      contextUsage: runtimeContextUsage(payload.session, session.contextUsage),
      status: idle ? "idle" : "running",
      activeAssistantId: idle ? undefined : session.activeAssistantId,
    }));
  };

  const applyPiPayload = (
    sessionId: SessionId,
    payload: Extract<RuntimeEventPayload, { type: "pi" }>,
  ) => {
    const eventId = piSessionIdFromEvent(payload.event);
    if (!acceptSeq(sessionId, payload.seq)) return;
    const assistantId = ensureAssistantId(sessionId);

    if (isAgentEndEvent(payload.event)) {
      // Flush pending deltas first, then settle the turn in ONE commit:
      // finalize tool blocks, stamp the cursor, and clear the live status
      // together.
      coalescer.flushNow(sessionId);
      applyEvent(sessionId, assistantId, payload.event, payload.seq, (session) => ({
        ...session,
        piSessionId: eventId || session.piSessionId,
        status: "idle",
        activeAssistantId: undefined,
      }));
      // Queue display reconciliation only: Pi drains its own follow_up queue
      // server-side, so the local submit is deliberately inert.
      drainQueuedTurnAfterAgentEnd(
        {
          submitPromptRef: { current: async () => undefined },
          tabsRef: {
            get current() {
              const session = getSession(sessionId);
              return session ? [session] : [];
            },
          },
          updateSession: commit,
        },
        sessionId,
      );
      return;
    }

    commit(sessionId, (session) =>
      session.status === "running" &&
      session.activeAssistantId === assistantId &&
      (!eventId || session.piSessionId === eventId)
        ? session
        : {
            ...session,
            piSessionId: eventId || session.piSessionId,
            status: "running",
            activeAssistantId: assistantId,
          },
    );
    enqueueEvent(sessionId, assistantId, payload.event, payload.seq);
  };

  // One SSE attachment per live session: connect, reconnect with a fixed
  // delay, watchdog the stream, and probe runtime liveness on errors.
  const openAttachment = (
    sessionId: SessionId,
    runtime: string,
    piSessionId: string | null,
  ): Attachment => {
    let closed = false;
    let reconnecting = false;
    let sub: RuntimeEventSubscription | null = null;
    let lastPayloadAt = Date.now();

    const reconnect = () => {
      if (closed || reconnecting) return;
      reconnecting = true;
      sub?.close();
      setTimeout(() => {
        reconnecting = false;
        if (!closed) connect();
      }, reconnectDelayMs);
    };

    const reconcileLiveness = async () => {
      const status = await api.loadRuntimeStatus(runtime, piSessionId);
      if (closed) return;
      // Inconclusive probe (network blip / proxy idle-timeout / transient
      // 5xx): loadRuntimeStatus returns null only on error. Do NOT tear down
      // or mark the session idle — pi is almost certainly still running.
      if (!status) {
        reconnect();
        return;
      }
      if (status.active) {
        commit(sessionId, (session) => ({
          ...session,
          piSessionId: status.piSessionId || session.piSessionId,
          contextUsage: runtimeContextUsage(status, session.contextUsage),
          status: "running",
        }));
        reconnect();
        return;
      }
      // Definitively idle — close the stream, flush pending deltas, then
      // settle the session. Order matters: the last coalesced delta must land
      // before the idle patch.
      sub?.close();
      coalescer.flushNow(sessionId);
      commit(sessionId, (session) =>
        session.status === "running" || session.status === "starting"
          ? {
              ...session,
              status: "idle",
              activeAssistantId: undefined,
              contextUsage: runtimeContextUsage(status, session.contextUsage),
            }
          : session,
      );
    };

    const connect = () => {
      // (Re)connect from the highest RECEIVED seq — an unflushed coalesced
      // delta is still in memory, so replaying it would double-apply.
      const after = reconnectAfter(cursors.get(sessionId) ?? adoptExternalCursor(undefined));
      sub = api.subscribeRuntimeEvents(runtime, after, piSessionId, {
        onPayload: (payload) => {
          if (closed) return;
          lastPayloadAt = Date.now();
          if (payload.type === "status") applyStatusPayload(sessionId, payload);
          else applyPiPayload(sessionId, payload);
        },
        onError: () => {
          if (closed) return;
          void reconcileLiveness();
        },
      });
    };

    connect();

    const watchdog = setInterval(() => {
      if (closed || Date.now() - lastPayloadAt < idleReconnectMs) return;
      void reconcileLiveness();
    }, idleReconnectMs);

    return {
      key: resumeConnectionKey(runtime, piSessionId),
      close: () => {
        closed = true;
        clearInterval(watchdog);
        coalescer.flushNow(sessionId);
        sub?.close();
      },
    };
  };

  return {
    bind: (next) => {
      binding = next;
    },
    unbind: () => {
      binding = null;
    },
    noteTurnAccepted: (sessionId) => adoptCursor(sessionId, 0),
    noteReplayHydrated: (sessionId, committedSeq) => adoptCursor(sessionId, committedSeq),
    reconcile: (sessions) => {
      const desired = new Map<
        SessionId,
        { runtimeSessionId: string; piSessionId: string | null; lastEventSeq: number | undefined }
      >();
      for (const session of sessions) {
        if (shouldSubscribeRuntimeEvents(session.status) && session.runtimeSessionId) {
          desired.set(session.id, {
            runtimeSessionId: session.runtimeSessionId,
            piSessionId: session.piSessionId ?? null,
            lastEventSeq: session.lastEventSeq,
          });
        }
      }

      for (const [sessionId, attachment] of [...attachments]) {
        const want = desired.get(sessionId);
        const key = want ? resumeConnectionKey(want.runtimeSessionId, want.piSessionId) : "";
        if (!want || attachment.key !== key) {
          attachment.close();
          attachments.delete(sessionId);
        }
      }

      for (const [sessionId, want] of desired) {
        if (attachments.has(sessionId)) continue;
        // Seed the gate from the persisted cursor when a session (re)enters
        // the live set — e.g. restored from storage as "running".
        cursors.set(sessionId, adoptExternalCursor(want.lastEventSeq));
        attachments.set(
          sessionId,
          openAttachment(sessionId, want.runtimeSessionId, want.piSessionId),
        );
      }
    },
    flush: (sessionId) => coalescer.flushNow(sessionId),
    closeAll: () => {
      for (const attachment of attachments.values()) attachment.close();
      attachments.clear();
      coalescer.flushAll();
    },
  };
}

let singleton: SessionRuntimeController | null = null;

/** Lazy app-wide controller instance (one per page lifetime). */
export function sessionRuntimeController(): SessionRuntimeController {
  singleton ??= createSessionRuntimeController();
  return singleton;
}
