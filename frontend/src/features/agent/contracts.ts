import {
  sanitizeComposerPlugins,
  sanitizeComposerPromptTemplates,
  sanitizeComposerSkills,
} from "@/features/agent/composer-context";
import type { BrowserBackend } from "@/features/agent/tools/types";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function stringField(
  record: Record<string, unknown>,
  key: string,
  required = false,
): ParseResult<string | undefined> {
  const value = record[key];
  if (value == null) {
    return required ? { ok: false, error: `${key} is required` } : { ok: true, value: undefined };
  }
  if (typeof value !== "string") return { ok: false, error: `${key} must be a string` };
  const trimmed = value.trim();
  if (required && !trimmed) return { ok: false, error: `${key} is required` };
  return { ok: true, value: trimmed || undefined };
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function boolField(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

export type GitRef = { name: string; current: boolean; remote: boolean };
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
  | { action: "createBranch"; branch: string }
  | { action: "commit"; message: string; paths: string[] }
  | { action: "push" };

export function parseGitAction(input: unknown): ParseResult<GitAction> {
  const body = objectRecord(input);
  if (!body || typeof body.action !== "string") {
    return { ok: false, error: "action is required" };
  }
  if (body.action === "init") return { ok: true, value: { action: "init" } };
  if (body.action === "push") return { ok: true, value: { action: "push" } };
  if (body.action === "checkout") {
    const ref = stringField(body, "ref", true);
    return ref.ok ? { ok: true, value: { action: "checkout", ref: ref.value! } } : ref;
  }
  if (body.action === "createBranch") {
    const branch = stringField(body, "branch", true);
    return branch.ok
      ? { ok: true, value: { action: "createBranch", branch: branch.value! } }
      : branch;
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

export function parseTerminalRunRequest(input: unknown): ParseResult<TerminalRunRequest> {
  const body = objectRecord(input);
  if (!body) return { ok: false, error: "Invalid JSON body" };
  const command = stringField(body, "command", true);
  return command.ok ? { ok: true, value: { command: command.value! } } : command;
}

export type AgentTurnMode = "prompt" | "steer" | "follow_up";
export type AgentStreamingBehavior = "steer" | "followUp";

export type AgentImageInput = {
  type: "image";
  data: string;
  mimeType: string;
};

export type AgentTurnRequest = {
  sessionId: string;
  modelId: string;
  message: string;
  images: AgentImageInput[];
  cwd?: string;
  piSessionId: string | null;
  browserToolEnabled: boolean;
  browserSessionId?: string;
  browserBackend?: BrowserBackend;
  canvasEnabled: boolean;
  plugins: ReturnType<typeof sanitizeComposerPlugins>;
  skills: ReturnType<typeof sanitizeComposerSkills>;
  promptTemplates: ReturnType<typeof sanitizeComposerPromptTemplates>;
  mode: AgentTurnMode;
  streamingBehavior?: AgentStreamingBehavior;
};

export type AgentTurnRuntimeStatus = {
  active?: boolean;
  running?: boolean;
  piSessionId?: string | null;
  modelId?: string | null;
  eventSeq?: number;
  contextUsage?: {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
    shouldCompact: boolean;
  } | null;
};

export type AgentTurnCommandResult = {
  type: "command";
  outcome: "accepted" | "queued" | "rejected";
  runtimeSessionId: string;
  piSessionId?: string | null;
  active: boolean;
  status?: AgentTurnRuntimeStatus;
  error?: string;
};

export function parseAgentTurnRequest(input: unknown): ParseResult<AgentTurnRequest> {
  const body = objectRecord(input);
  if (!body) return { ok: false, error: "Invalid JSON body" };
  const message = stringField(body, "message", true);
  if (!message.ok) return message;
  const modelId = stringField(body, "modelId", true);
  if (!modelId.ok) return modelId;
  const sessionId = stringField(body, "sessionId");
  if (!sessionId.ok) return sessionId;
  const cwd = stringField(body, "cwd");
  if (!cwd.ok) return cwd;
  const piSessionId = stringField(body, "piSessionId");
  if (!piSessionId.ok) return piSessionId;
  const browserSessionId = stringField(body, "browserSessionId");
  if (!browserSessionId.ok) return browserSessionId;
  const browserBackend = body.browserBackend === "sitegeist" ? "sitegeist" : "embedded";
  const mode = body.mode === "steer" || body.mode === "follow_up" ? body.mode : "prompt";
  const streamingBehavior =
    body.streamingBehavior === "steer" || body.streamingBehavior === "followUp"
      ? body.streamingBehavior
      : undefined;
  return {
    ok: true,
    value: {
      sessionId: sessionId.value ?? "default",
      modelId: modelId.value!,
      message: message.value!,
      images: sanitizeImages(body.images),
      cwd: cwd.value,
      piSessionId: piSessionId.value ?? null,
      browserToolEnabled: boolField(body, "browserToolEnabled"),
      browserSessionId: browserSessionId.value,
      browserBackend,
      canvasEnabled: boolField(body, "canvasEnabled"),
      plugins: sanitizeComposerPlugins(body.plugins),
      skills: sanitizeComposerSkills(body.skills),
      promptTemplates: sanitizeComposerPromptTemplates(body.promptTemplates),
      mode,
      ...(streamingBehavior ? { streamingBehavior } : {}),
    },
  };
}

function sanitizeImages(value: unknown): AgentImageInput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): AgentImageInput[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const data = typeof record.data === "string" ? record.data.replace(/\s+/g, "") : "";
    const mimeType = typeof record.mimeType === "string" ? record.mimeType.trim() : "";
    if (!data || !/^image\/[a-z0-9.+-]+$/i.test(mimeType)) return [];
    return [{ type: "image", data, mimeType }];
  });
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
    piSessionId: typeof payload.piSessionId === "string" ? payload.piSessionId : null,
    active: payload.active === true,
    status: objectRecord(payload.status) ? (payload.status as AgentTurnRuntimeStatus) : undefined,
    error: typeof payload.error === "string" ? payload.error : undefined,
  };
}
