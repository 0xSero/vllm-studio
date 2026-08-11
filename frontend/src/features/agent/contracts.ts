import type { AgentImageInput } from "@shared/agent/agent-image-input";

export type { AgentImageInput };
// The turn wire contract + generic body-field helpers live in
// shared/agent/agent-turn.ts so the @local-studio/agent-runtime HTTP handlers
// can share them; re-exported here for frontend callers.
export {
  objectRecord,
  stringField,
  stringArray,
  boolField,
  parseAgentTurnRequest,
  AGENT_THINKING_LEVELS,
  AgentThinkingLevelSchema,
  isAgentThinkingLevel,
} from "@shared/agent/agent-turn";
export type {
  ParseResult,
  AgentQueueAction,
  AgentTurnMode,
  AgentStreamingBehavior,
  AgentTurnRequest,
  AgentTurnRuntimeStatus,
  AgentTurnCommandResult,
  AgentThinkingLevel,
  AgentToolAccess,
} from "@shared/agent/agent-turn";
import {
  objectRecord,
  type AgentTurnRuntimeStatus,
  type AgentTurnCommandResult,
} from "@shared/agent/agent-turn";
export { parseGitAction, parseTerminalRunRequest } from "@shared/agent/workspace";
export type {
  GitAction,
  GitRef,
  GitState,
  GitStatusEntry,
  TerminalRunRequest,
  TerminalRunResult,
} from "@shared/agent/workspace";

export function parseAgentTurnCommandResult(input: unknown): AgentTurnCommandResult | null {
  const payload = objectRecord(input);
  if (!payload || payload.type !== "command") return null;
  const outcome =
    payload.outcome === "accepted" || payload.outcome === "queued" || payload.outcome === "rejected"
      ? payload.outcome
      : null;
  const runtimeSessionId =
    typeof payload.runtimeSessionId === "string" && payload.runtimeSessionId.trim()
      ? payload.runtimeSessionId.trim()
      : "";
  if (!outcome || !runtimeSessionId) return null;
  return {
    type: "command",
    outcome,
    runtimeSessionId,
    piSessionId: typeof payload.piSessionId === "string" ? payload.piSessionId : null,
    active: payload.active === true,
    status: objectRecord(payload.status) ? (payload.status as AgentTurnRuntimeStatus) : undefined,
    error: typeof payload.error === "string" ? payload.error : undefined,
  };
}
