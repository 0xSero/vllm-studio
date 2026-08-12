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
  parseAgentTurnCommandResult,
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
export { parseGitAction, parseTerminalRunRequest } from "@shared/agent/workspace";
export type {
  GitAction,
  GitRef,
  GitState,
  GitStatusEntry,
  TerminalRunRequest,
  TerminalRunResult,
} from "@shared/agent/workspace";
