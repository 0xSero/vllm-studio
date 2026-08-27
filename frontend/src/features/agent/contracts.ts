import type { AgentImageInput } from "@shared/agent/agent-image-input";

export type { AgentImageInput };
// The turn wire contract + generic body-field helpers live in
// shared/agent/agent-turn.ts and are re-exported here for frontend callers.
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
  stringField,
  type ParseResult,
  type AgentTurnRuntimeStatus,
  type AgentTurnCommandResult,
} from "@shared/agent/agent-turn";

export type GitRef = { name: string; current: boolean; remote: boolean };
export type GitBranch = { name: string; current: boolean; remote: boolean };
export type GitStatusEntry = { code: string; path: string };

export type GitState = {
  isRepo: boolean;
  branch: string | null;
  status: string[];
  entries: GitStatusEntry[];
  diff: string;
  additions: number;
  deletions: number;
  refs: GitRef[];
  hasUpstream: boolean;
  remoteUrl: string | null;
  prUrl: string | null;
  error?: string;
};

export type GitAction =
  | { action: "init" }
  | { action: "checkout"; ref: string }
  | { action: "commit"; message: string; paths: string[] }
  | { action: "push" }
  | { action: "switch_branch"; branch: string }
  | { action: "create_branch"; branch: string }
  | { action: "add_worktree"; branch: string; path: string }
  | { action: "remove_worktree"; path: string };

export type TerminalRunRequest = { command: string };
export type TerminalRunResult = {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
};

export function parseTerminalRunRequest(input: unknown): ParseResult<TerminalRunRequest> {
  const body = objectRecord(input);
  if (!body) return { ok: false, error: "Invalid JSON body" };
  const command = stringField(body, "command", true);
  return command.ok ? { ok: true, value: { command: command.value! } } : command;
}

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
    harness: typeof payload.harness === "string" ? payload.harness : undefined,
    harnessVersion: typeof payload.harnessVersion === "string" ? payload.harnessVersion : null,
    nativeSessionId: typeof payload.nativeSessionId === "string" ? payload.nativeSessionId : null,
    piSessionId: typeof payload.piSessionId === "string" ? payload.piSessionId : null,
    active: payload.active === true,
    status: objectRecord(payload.status) ? (payload.status as AgentTurnRuntimeStatus) : undefined,
    error: typeof payload.error === "string" ? payload.error : undefined,
  };
}
