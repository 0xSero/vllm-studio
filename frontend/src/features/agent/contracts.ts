import type { AgentImageInput } from "@shared/agent/agent-image-input";
import { Schema } from "effect";

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
  stringField,
  stringArray,
  type ParseResult,
  type AgentTurnCommandResult,
} from "@shared/agent/agent-turn";

export type GitRef = { name: string; current: boolean; remote: boolean };
export type GitBranch = { name: string; current: boolean; remote: boolean };
export type GitWorktree = { path: string; branch: string | null; current: boolean };
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

type AgentContractInput = typeof Schema.Unknown.Encoded;

const isString = Schema.is(Schema.String);
const AgentTurnRuntimeStatusSchema = Schema.Struct({
  active: Schema.optional(Schema.Boolean),
  running: Schema.optional(Schema.Boolean),
  piSessionId: Schema.optional(Schema.NullOr(Schema.String)),
  modelId: Schema.optional(Schema.NullOr(Schema.String)),
  eventSeq: Schema.optional(Schema.Number),
  contextUsage: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        tokens: Schema.NullOr(Schema.Number),
        contextWindow: Schema.Number,
        percent: Schema.NullOr(Schema.Number),
        shouldCompact: Schema.Boolean,
      }),
    ),
  ),
});
const AgentTurnCommandResultSchema = Schema.Struct({
  type: Schema.Literal("command"),
  outcome: Schema.Literals(["accepted", "queued", "rejected"]),
  runtimeSessionId: Schema.String,
  piSessionId: Schema.optional(Schema.NullOr(Schema.String)),
  active: Schema.Boolean,
  status: Schema.optional(AgentTurnRuntimeStatusSchema),
  error: Schema.optional(Schema.String),
});
const isAgentTurnCommandResult = Schema.is(AgentTurnCommandResultSchema);

export function parseGitAction(input: AgentContractInput): ParseResult<GitAction> {
  const body = objectRecord(input);
  if (!body || !isString(body.action)) {
    return { ok: false, error: "action is required" };
  }
  if (body.action === "init") return { ok: true, value: { action: "init" } };
  if (body.action === "push") return { ok: true, value: { action: "push" } };
  if (body.action === "checkout") {
    const ref = stringField(body, "ref", true);
    return ref.ok ? { ok: true, value: { action: "checkout", ref: ref.value! } } : ref;
  }
  if (body.action === "switch_branch" || body.action === "create_branch") {
    const branch = stringField(body, "branch", true);
    if (!branch.ok) return branch;
    return { ok: true, value: { action: body.action, branch: branch.value! } };
  }
  if (body.action === "add_worktree") {
    const branch = stringField(body, "branch", true);
    if (!branch.ok) return branch;
    const path = stringField(body, "path", true);
    if (!path.ok) return path;
    return {
      ok: true,
      value: { action: "add_worktree", branch: branch.value!, path: path.value! },
    };
  }
  if (body.action === "remove_worktree") {
    const path = stringField(body, "path", true);
    return path.ok ? { ok: true, value: { action: "remove_worktree", path: path.value! } } : path;
  }
  if (body.action === "commit") {
    const message = stringField(body, "message", true);
    if (!message.ok) return message;
    return {
      ok: true,
      value: { action: "commit", message: message.value!, paths: stringArray(body.paths) },
    };
  }
  return { ok: false, error: `Unsupported git action: ${body.action}` };
}

export type TerminalRunRequest = { command: string };
export type TerminalRunResult = {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error?: string;
};

export function parseTerminalRunRequest(
  input: AgentContractInput,
): ParseResult<TerminalRunRequest> {
  const body = objectRecord(input);
  if (!body) return { ok: false, error: "Invalid JSON body" };
  const command = stringField(body, "command", true);
  return command.ok ? { ok: true, value: { command: command.value! } } : command;
}

export function parseAgentTurnCommandResult(
  input: AgentContractInput,
): AgentTurnCommandResult | null {
  if (!isAgentTurnCommandResult(input)) return null;
  const runtimeSessionId = input.runtimeSessionId.trim();
  if (!runtimeSessionId) return null;
  return { ...input, runtimeSessionId };
}
