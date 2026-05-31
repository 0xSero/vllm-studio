import { traceAgentReasoning } from "@/lib/agent/trace-reasoning";
import type { SessionId } from "./types";

type ApplyPiEvent = (
  sessionId: SessionId,
  assistantId: string,
  event: Record<string, unknown>,
) => void;

type FrameToken = {
  cancel: () => void;
};

type ScheduleFrame = (callback: () => void) => FrameToken;

export type TextDeltaCoalescer = {
  enqueuePiEvent: (
    sessionId: SessionId,
    assistantId: string,
    event: Record<string, unknown>,
    options?: { flushNow?: boolean },
  ) => boolean;
  flushNow: (sessionId: SessionId) => void;
  flushAll: () => void;
  dispose: () => void;
};

type PendingSnapshot = {
  assistantId: string;
  event: Record<string, unknown>;
  frame: FrameToken | null;
};

// Coalesces assistant streaming updates to at most one render per animation
// frame. Each pi `message_update` carries the FULL accumulated message snapshot,
// so superseded snapshots can be dropped losslessly — we keep only the latest
// per session and apply it on the next frame. Every non-`message_update` event
// (call boundaries, tool execution, agent_end) is left for the caller to flush
// the pending snapshot and apply immediately, preserving event order.
export function createTextDeltaCoalescer({
  applyPiEvent,
  scheduleFrame = defaultScheduleFrame,
}: {
  applyPiEvent: ApplyPiEvent;
  scheduleFrame?: ScheduleFrame;
}): TextDeltaCoalescer {
  const pending = new Map<SessionId, PendingSnapshot>();

  const flushNow = (sessionId: SessionId) => {
    const snapshot = pending.get(sessionId);
    if (!snapshot) return;
    snapshot.frame?.cancel();
    pending.delete(sessionId);
    applyPiEvent(sessionId, snapshot.assistantId, snapshot.event);
  };

  const scheduleSessionFlush = (sessionId: SessionId) => {
    const snapshot = pending.get(sessionId);
    if (!snapshot || snapshot.frame) return;
    snapshot.frame = scheduleFrame(() => flushNow(sessionId));
  };

  const enqueuePiEvent: TextDeltaCoalescer["enqueuePiEvent"] = (
    sessionId,
    assistantId,
    event,
    options = {},
  ) => {
    if (event.type !== "message_update") return false;
    const existing = pending.get(sessionId);
    if (existing && existing.assistantId !== assistantId) flushNow(sessionId);
    const carriedFrame = pending.get(sessionId)?.frame ?? null;
    pending.set(sessionId, { assistantId, event, frame: carriedFrame });
    traceAgentReasoning("coalescer.snapshot", { sessionId, assistantId, type: event.type });
    if (options.flushNow) {
      flushNow(sessionId);
    } else {
      scheduleSessionFlush(sessionId);
    }
    return true;
  };

  const flushAll = () => {
    for (const sessionId of Array.from(pending.keys())) flushNow(sessionId);
  };

  return {
    enqueuePiEvent,
    flushNow,
    flushAll,
    dispose: () => {
      for (const snapshot of pending.values()) snapshot.frame?.cancel();
      pending.clear();
    },
  };
}

function defaultScheduleFrame(callback: () => void): FrameToken {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    const requestAnimationFrame = window.requestAnimationFrame.bind(window);
    const cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    const frame = requestAnimationFrame(() => callback());
    return { cancel: () => cancelAnimationFrame(frame) };
  }

  const timer = setTimeout(callback, 0);
  return { cancel: () => clearTimeout(timer) };
}
