// Pure ordering rules for the runtime /events SSE stream and /status replay
// cursor. Moved from frontend/src/app/api/agent/runtime/events/stream-order.ts
// so the shared HTTP handlers (Next in-process AND the standalone :8081
// service) use one copy.

export type InitialRuntimeStatusPhase = "running" | "idle" | null;

export function initialRuntimeStatusPhase(
  active: boolean,
  replayBacklogCount: number,
): InitialRuntimeStatusPhase {
  if (active) return "running";
  return replayBacklogCount === 0 ? "idle" : null;
}

export function replayAfterCursor(requestedAfter: number, runtimeEventSeq: number): number {
  return requestedAfter > runtimeEventSeq ? 0 : requestedAfter;
}

export function shouldSendTrailingIdleStatus({
  active,
  replayBacklogCount,
  sentTerminalStatus,
}: {
  active: boolean;
  replayBacklogCount: number;
  sentTerminalStatus: boolean;
}): boolean {
  return !active && replayBacklogCount > 0 && !sentTerminalStatus;
}
