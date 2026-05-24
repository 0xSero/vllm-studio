import { isAgentEndEvent } from "./pi-events";
import type { LoggedPiEvent, PiAgentStatus, PiContextUsage } from "./pi-runtime-types";

const TURN_EVENT_TYPES = new Set([
  "agent_start",
  "turn_start",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "turn_end",
  "agent_end",
  "process_exit",
]);

export function piStatusFromEvents(input: {
  running: boolean;
  activePromptCount: number;
  modelId: string;
  cwd: string;
  piSessionId: string | null;
  agentDir: string;
  eventSeq: number;
  lastError: string | null;
  eventLog: LoggedPiEvent[];
  contextUsage?: PiContextUsage | null;
}): PiAgentStatus {
  const lastTurnEvent = [...input.eventLog]
    .reverse()
    .find((entry) => TURN_EVENT_TYPES.has(String(entry.event.type ?? "")));
  const eventLooksActive =
    input.running &&
    lastTurnEvent &&
    !isAgentEndEvent(lastTurnEvent.event) &&
    lastTurnEvent.event.type !== "process_exit";
  return {
    running: input.running,
    active: input.activePromptCount > 0 || Boolean(eventLooksActive),
    modelId: input.modelId,
    cwd: input.cwd,
    piSessionId: input.piSessionId,
    agentDir: input.agentDir,
    eventSeq: input.eventSeq,
    lastError: input.lastError,
    contextUsage: input.contextUsage ?? null,
  };
}

export function piEventsAfter(eventLog: LoggedPiEvent[], seq: number): LoggedPiEvent[] {
  const floor = Number.isFinite(seq) ? Math.max(0, Math.trunc(seq)) : 0;
  return eventLog.filter((entry) => entry.seq > floor);
}
