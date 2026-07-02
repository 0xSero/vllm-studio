// The /api/agent/turn wire contract: request parsing, command-result shape,
// and the generic body-field helpers the other agent route parsers reuse.
//
// Moved here from frontend/src/features/agent/contracts.ts so the
// @local-studio/agent-runtime HTTP handlers can share the exact parsing logic
// with the frontend; the frontend module re-exports everything from this file.

import type { AgentImageInput } from "./agent-image-input";
import { sanitizeComposerPromptTemplates, sanitizeComposerSkills } from "./composer-refs";

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

export type AgentBrowserBackend = "embedded" | "sitegeist";

export type AgentTurnMode = "prompt" | "steer" | "follow_up";
export type AgentStreamingBehavior = "steer" | "followUp";

export type AgentTurnRequest = {
  sessionId: string;
  modelId: string;
  message: string;
  images: AgentImageInput[];
  cwd?: string;
  piSessionId: string | null;
  browserToolEnabled: boolean;
  browserSessionId?: string;
  browserBackend?: AgentBrowserBackend;
  canvasEnabled: boolean;
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
  // Wire field of the /turn response: the server echoes the opaque runtime key
  // it resolved the command to. The client sends the session id as that key
  // and does not read this back.
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

export function controlTargetHasActiveTurn(
  status: { active?: boolean; running?: boolean } | null | undefined,
): boolean {
  return status?.active === true;
}
