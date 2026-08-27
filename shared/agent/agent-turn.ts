// The /api/agent/turn wire contract: request parsing, command-result shape,
// and the generic body-field helpers the other agent route parsers reuse.
//
// Moved here from frontend/src/features/agent/contracts.ts so the
// @local-studio/agent-runtime HTTP handlers can share the exact parsing logic
// with the frontend; the frontend module re-exports everything from this file.

import {
  agentImageDataError,
  agentImageLimitError,
  type AgentImageInput,
} from "./agent-image-input";
import { sanitizeComposerPromptTemplates, sanitizeComposerSkills } from "./composer-refs";
import { Schema } from "effect";
import { isRecord, type UnknownRecord, type UnparsedValue } from "./guards";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function objectRecord(value: UnparsedValue): UnknownRecord | null {
  return isRecord(value) ? value : null;
}

const isString = Schema.is(Schema.String);

export function stringField(
  record: UnknownRecord,
  key: string,
  required: true,
): ParseResult<string>;
export function stringField(
  record: UnknownRecord,
  key: string,
  required?: false,
): ParseResult<string | undefined>;
export function stringField(
  record: UnknownRecord,
  key: string,
  required = false,
): ParseResult<string | undefined> {
  const value = record[key];
  if (value == null) {
    return required ? { ok: false, error: `${key} is required` } : { ok: true, value: undefined };
  }
  if (!isString(value)) return { ok: false, error: `${key} must be a string` };
  const trimmed = value.trim();
  if (required && !trimmed) return { ok: false, error: `${key} is required` };
  return { ok: true, value: trimmed || undefined };
}

export function stringArray(value: UnparsedValue): string[] {
  return Array.isArray(value) ? value.filter(isString) : [];
}

export function boolField(record: UnknownRecord, key: string): boolean {
  return record[key] === true;
}

// Which browsers a session arms. "embedded" is the headless sandbox alone;
// "chrome" adds the user's own browser on top of it, so the model can pick
// per task instead of the composer picking for it.
export type AgentBrowserBackend = "embedded" | "chrome";
export type AgentToolAccess = "read_only" | "full";

export type AgentTurnMode = "prompt" | "steer" | "follow_up";
const isNonPromptTurnMode = Schema.is(Schema.Literals(["steer", "follow_up"]));
export type AgentStreamingBehavior = "steer" | "followUp";
export type AgentQueueAction = "promote" | "remove" | "replace";
export const AGENT_THINKING_LEVELS = [
  "off",
  "auto",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export const AgentThinkingLevelSchema = Schema.Literals(AGENT_THINKING_LEVELS);
export type AgentThinkingLevel = (typeof AGENT_THINKING_LEVELS)[number];
export const isAgentThinkingLevel = Schema.is(AgentThinkingLevelSchema);

export type AgentTurnRequest = {
  sessionId: string;
  modelId: string;
  thinkingLevel?: AgentThinkingLevel;
  message: string;
  images: AgentImageInput[];
  cwd?: string | undefined;
  piSessionId: string | null;
  toolAccess: AgentToolAccess;
  browserToolEnabled: boolean;
  browserSessionId?: string | undefined;
  browserBackend?: AgentBrowserBackend;
  skills: ReturnType<typeof sanitizeComposerSkills>;
  promptTemplates: ReturnType<typeof sanitizeComposerPromptTemplates>;
  mode: AgentTurnMode;
  queueAction?: AgentQueueAction;
  queueReplacement?: string;
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

type AgentTurnRequiredStrings = {
  message: string;
  modelId: string;
};

type AgentTurnOptionalStrings = {
  sessionId?: string;
  cwd?: string;
  piSessionId?: string;
  browserSessionId?: string;
};

function parseRequiredTurnStrings(body: UnknownRecord): ParseResult<AgentTurnRequiredStrings> {
  const message = stringField(body, "message", true);
  if (!message.ok) return message;
  const modelId = stringField(body, "modelId", true);
  if (!modelId.ok) return modelId;
  return { ok: true, value: { message: message.value, modelId: modelId.value } };
}

function parseOptionalTurnStrings(body: UnknownRecord): ParseResult<AgentTurnOptionalStrings> {
  const sessionId = stringField(body, "sessionId");
  if (!sessionId.ok) return sessionId;
  const cwd = stringField(body, "cwd");
  if (!cwd.ok) return cwd;
  const piSessionId = stringField(body, "piSessionId");
  if (!piSessionId.ok) return piSessionId;
  const browserSessionId = stringField(body, "browserSessionId");
  if (!browserSessionId.ok) return browserSessionId;
  const fields: AgentTurnOptionalStrings = {};
  if (sessionId.value) fields.sessionId = sessionId.value;
  if (cwd.value) fields.cwd = cwd.value;
  if (piSessionId.value) fields.piSessionId = piSessionId.value;
  if (browserSessionId.value) fields.browserSessionId = browserSessionId.value;
  return { ok: true, value: fields };
}

type AgentTurnQueueFields = {
  queueAction?: AgentQueueAction;
  queueReplacement?: string;
};

function parseQueueFields(body: UnknownRecord): ParseResult<AgentTurnQueueFields> {
  const rawAction = body["queueAction"];
  const queueAction =
    rawAction === "promote" || rawAction === "remove" || rawAction === "replace"
      ? rawAction
      : undefined;
  if (rawAction != null && !queueAction) {
    return { ok: false, error: "queueAction must be promote, remove, or replace" };
  }
  const replacement = stringField(body, "queueReplacement");
  if (!replacement.ok) return replacement;
  if (queueAction === "replace" && !replacement.value) {
    return { ok: false, error: "queueReplacement is required when replacing a queued message" };
  }
  const fields: AgentTurnQueueFields = {};
  if (queueAction) fields.queueAction = queueAction;
  if (replacement.value) fields.queueReplacement = replacement.value;
  return { ok: true, value: fields };
}

function addOptionalTurnFields(
  request: AgentTurnRequest,
  queue: AgentTurnQueueFields,
  thinkingLevel: AgentThinkingLevel | null | undefined,
  streamingBehavior: AgentStreamingBehavior | undefined,
): void {
  if (thinkingLevel) request.thinkingLevel = thinkingLevel;
  if (queue.queueAction) request.queueAction = queue.queueAction;
  if (queue.queueReplacement) request.queueReplacement = queue.queueReplacement;
  if (streamingBehavior) request.streamingBehavior = streamingBehavior;
}

export function parseAgentTurnRequest(input: UnparsedValue): ParseResult<AgentTurnRequest> {
  const body = objectRecord(input);
  if (!body) return { ok: false, error: "Invalid JSON body" };
  const requiredStrings = parseRequiredTurnStrings(body);
  if (!requiredStrings.ok) return requiredStrings;
  const thinkingLevel = body["thinkingLevel"];
  if (thinkingLevel != null && !isAgentThinkingLevel(thinkingLevel)) {
    return { ok: false, error: "thinkingLevel must be a supported reasoning level" };
  }
  const optionalStrings = parseOptionalTurnStrings(body);
  if (!optionalStrings.ok) return optionalStrings;
  const queue = parseQueueFields(body);
  if (!queue.ok) return queue;
  const images = parseImages(body["images"]);
  if (!images.ok) return images;
  const browserBackend = body["browserBackend"] === "chrome" ? "chrome" : "embedded";
  const rawMode = body["mode"];
  const mode = isNonPromptTurnMode(rawMode) ? rawMode : "prompt";
  const rawStreamingBehavior = body["streamingBehavior"];
  const streamingBehavior =
    rawStreamingBehavior === "steer" || rawStreamingBehavior === "followUp"
      ? rawStreamingBehavior
      : undefined;
  const request: AgentTurnRequest = {
    sessionId: optionalStrings.value.sessionId ?? "default",
    modelId: requiredStrings.value.modelId,
    message: requiredStrings.value.message,
    images: images.value,
    cwd: optionalStrings.value.cwd,
    piSessionId: optionalStrings.value.piSessionId ?? null,
    toolAccess: body["toolAccess"] === "full" ? "full" : "read_only",
    browserToolEnabled: boolField(body, "browserToolEnabled"),
    browserSessionId: optionalStrings.value.browserSessionId,
    browserBackend,
    skills: sanitizeComposerSkills(body["skills"]),
    promptTemplates: sanitizeComposerPromptTemplates(body["promptTemplates"]),
    mode,
  };
  addOptionalTurnFields(request, queue.value, thinkingLevel, streamingBehavior);
  return { ok: true, value: request };
}

function parseImages(value: UnparsedValue): ParseResult<AgentImageInput[]> {
  if (value == null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, error: "images must be an array" };
  const images: AgentImageInput[] = [];
  for (const entry of value) {
    const record = objectRecord(entry);
    if (!record || record["type"] !== "image") {
      return { ok: false, error: "images must contain image inputs" };
    }
    const rawData = record["data"];
    const data = isString(rawData) ? rawData.trim() : "";
    const dataError = agentImageDataError(data);
    if (dataError) return { ok: false, error: dataError };
    const rawMimeType = record["mimeType"];
    const mimeType = isString(rawMimeType) ? rawMimeType.trim() : "";
    if (!/^image\/[a-z0-9.+-]+$/i.test(mimeType)) {
      return { ok: false, error: "Image mimeType must be an image media type." };
    }
    images.push({ type: "image", data, mimeType });
  }
  const error = agentImageLimitError(images);
  return error ? { ok: false, error } : { ok: true, value: images };
}

export function controlTargetHasActiveTurn(
  status: { active?: boolean; running?: boolean } | null | undefined,
): boolean {
  return status?.active === true;
}
