import type {
  AssistantTranscriptItem,
  SessionSnapshot,
  ToolTranscriptItem,
  TranscriptItem,
  TranscriptProgress,
  Usage,
  UserTranscriptItem,
} from "@earendil-works/pi-protocol";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

/**
 * Projection from pi's in-process state into pi's own wire shapes
 * (docs/agent-state-plan.md, Stage 0). Two directions, one vocabulary:
 *
 * - `projectTranscript` turns an AgentMessage list (live `session.messages`
 *   or canonical SessionManager entries) into `TranscriptItem[]` — the body
 *   of a `SessionSnapshot`.
 * - `TranscriptProjector.progressFor` turns a live `AgentSessionEvent` into
 *   `TranscriptProgress` deltas.
 *
 * Item ids are derived deterministically from message identity
 * (`role:timestamp:*` / `tool:<toolCallId>`) so a progress item and its later
 * snapshot form agree, and the client reducer
 * (`pi-coding-agent/client/transcript`) needs no reconciliation: snapshots
 * replace, deltas append. pi 0.84.x ships the schemas and the client reducer
 * but not this server-side projector; when the harness grows one, this file
 * is the thing it deletes.
 */

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : null;

const asTimestamp = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;

const messageItemId = (role: string, message: UnknownRecord): string =>
  `${role}:${asTimestamp(message["timestamp"])}`;

const toolItemId = (toolCallId: string): string => `tool:${toolCallId}`;

/* ── content parts ─────────────────────────────────────────────────────────── */

type AssistantContent = AssistantTranscriptItem["content"][number];
type UserContent = UserTranscriptItem["content"][number];
type ToolContent = ToolTranscriptItem["content"][number];

const assistantPart = (part: unknown): AssistantContent | null => {
  const record = asRecord(part);
  if (!record) return null;
  if (record["type"] === "text" && typeof record["text"] === "string") {
    return { type: "text", text: record["text"] };
  }
  if (record["type"] === "thinking" && typeof record["thinking"] === "string") {
    return {
      type: "thinking",
      thinking: record["thinking"],
      ...(record["redacted"] === true ? { redacted: true } : {}),
    };
  }
  if (record["type"] === "toolCall" && typeof record["id"] === "string") {
    return {
      type: "toolCall",
      toolCallId: record["id"],
      toolName: typeof record["name"] === "string" ? record["name"] : "tool",
      input: (record["arguments"] ?? {}) as ToolTranscriptItem["input"],
    };
  }
  return null;
};

const mediaPart = (part: unknown): UserContent | null => {
  const record = asRecord(part);
  if (!record) return null;
  if (record["type"] === "text" && typeof record["text"] === "string") {
    return { type: "text", text: record["text"] };
  }
  if (
    record["type"] === "image" &&
    typeof record["data"] === "string" &&
    typeof record["mimeType"] === "string" &&
    record["mimeType"].length > 0
  ) {
    return { type: "image", data: record["data"], mimeType: record["mimeType"] };
  }
  return null;
};

const projectUsage = (usage: unknown): Usage | undefined => {
  const record = asRecord(usage);
  if (!record) return undefined;
  const cost = asRecord(record["cost"]) ?? {};
  const count = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
  const money = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
  const reasoning = record["reasoning"];
  return {
    input: count(record["input"]),
    output: count(record["output"]),
    cacheRead: count(record["cacheRead"]),
    cacheWrite: count(record["cacheWrite"]),
    ...(typeof reasoning === "number" ? { reasoning: count(reasoning) } : {}),
    totalTokens: count(record["totalTokens"]),
    cost: {
      input: money(cost["input"]),
      output: money(cost["output"]),
      cacheRead: money(cost["cacheRead"]),
      cacheWrite: money(cost["cacheWrite"]),
      total: money(cost["total"]),
    },
  };
};

/* ── items ─────────────────────────────────────────────────────────────────── */

const modelRefFor = (message: UnknownRecord): { provider: string; id: string } => ({
  provider: typeof message["provider"] === "string" && message["provider"] ? message["provider"] : "unknown",
  id: typeof message["model"] === "string" && message["model"] ? message["model"] : "unknown",
});

const userItem = (message: UnknownRecord): UserTranscriptItem => {
  const content = message["content"];
  const parts: UserContent[] =
    typeof content === "string"
      ? [{ type: "text", text: content }]
      : Array.isArray(content)
        ? content.map(mediaPart).filter((part): part is UserContent => part !== null)
        : [];
  return {
    id: messageItemId("user", message),
    role: "user",
    content: parts,
    timestamp: asTimestamp(message["timestamp"]),
  };
};

const assistantItem = (message: UnknownRecord): AssistantTranscriptItem => {
  const content = Array.isArray(message["content"])
    ? message["content"].map(assistantPart).filter((part): part is AssistantContent => part !== null)
    : [];
  const usage = projectUsage(message["usage"]);
  const base = {
    id: messageItemId("assistant", message),
    role: "assistant" as const,
    content,
    model: modelRefFor(message),
    ...(typeof message["responseModel"] === "string" && message["responseModel"]
      ? { responseModel: message["responseModel"] }
      : {}),
    ...(usage ? { usage } : {}),
    timestamp: asTimestamp(message["timestamp"]),
  };
  const stopReason = message["stopReason"];
  const errorMessage =
    typeof message["errorMessage"] === "string" && message["errorMessage"]
      ? message["errorMessage"]
      : undefined;
  if (stopReason === "error") {
    return { ...base, status: "error", stopReason: "error", ...(errorMessage ? { errorMessage } : {}) };
  }
  if (stopReason === "aborted") {
    return { ...base, status: "aborted", stopReason: "aborted", ...(errorMessage ? { errorMessage } : {}) };
  }
  if (stopReason === "stop" || stopReason === "length" || stopReason === "toolUse") {
    return { ...base, status: "complete", stopReason };
  }
  // "pending" (mid-stream) and anything unexpected: still streaming.
  return { ...base, status: "streaming" };
};

const toolItem = (
  message: UnknownRecord,
  input: ToolTranscriptItem["input"],
  running: boolean,
): ToolTranscriptItem => {
  const content = Array.isArray(message["content"])
    ? message["content"].map(mediaPart).filter((part): part is ToolContent => part !== null)
    : [];
  const usage = projectUsage(message["usage"]);
  const toolCallId = typeof message["toolCallId"] === "string" ? message["toolCallId"] : "unknown";
  const base = {
    id: toolItemId(toolCallId),
    role: "tool" as const,
    toolCallId,
    toolName: typeof message["toolName"] === "string" ? message["toolName"] : "tool",
    input,
    content,
    ...(message["details"] !== undefined
      ? { details: message["details"] as ToolTranscriptItem["details"] }
      : {}),
    ...(usage ? { usage } : {}),
    timestamp: asTimestamp(message["timestamp"]),
  };
  if (running) return { ...base, status: "running", isError: false };
  return message["isError"] === true
    ? { ...base, status: "error", isError: true }
    : { ...base, status: "complete", isError: false };
};

/** Project an AgentMessage list (live or canonical) into transcript items.
 *  Custom message roles (bash executions, extension messages) are skipped —
 *  they never participated in the wire transcript either. */
export const projectTranscript = (messages: readonly unknown[]): TranscriptItem[] => {
  const items: TranscriptItem[] = [];
  const callInputs = new Map<string, ToolTranscriptItem["input"]>();
  for (const raw of messages) {
    const message = asRecord(raw);
    if (!message) continue;
    const role = message["role"];
    if (role === "user") {
      items.push(userItem(message));
      continue;
    }
    if (role === "assistant") {
      const item = assistantItem(message);
      for (const part of item.content) {
        if (part.type === "toolCall") callInputs.set(part.toolCallId, part.input);
      }
      items.push(item);
      continue;
    }
    if (role === "toolResult") {
      const toolCallId = typeof message["toolCallId"] === "string" ? message["toolCallId"] : "";
      items.push(toolItem(message, callInputs.get(toolCallId) ?? {}, false));
    }
  }
  return items;
};

/* ── snapshot ──────────────────────────────────────────────────────────────── */

export interface SnapshotSource {
  sessionId: string;
  sessionName?: string | undefined;
  cwd: string;
  messages: readonly unknown[];
  /** The in-flight assistant message, when a run is streaming. */
  streamingMessage?: unknown;
  phase: SessionSnapshot["phase"];
  model: { provider: string; id: string };
  thinkingLevel: SessionSnapshot["thinkingLevel"];
  queuedSteer: readonly string[];
  revision: number;
}

export const projectSnapshot = (source: SnapshotSource): SessionSnapshot => {
  const transcript = projectTranscript(source.messages);
  const streaming = asRecord(source.streamingMessage);
  if (streaming) {
    const item = assistantItem(streaming);
    if (!transcript.some((existing) => existing.id === item.id)) transcript.push(item);
  }
  const timestamps = transcript.map((item) => item.timestamp).filter((value) => value > 0);
  const now = Date.now();
  const queuedSteer: UserTranscriptItem[] = source.queuedSteer.map((text, index) => ({
    id: `queued:${index}:${text.length}`,
    role: "user",
    content: [{ type: "text", text }],
    timestamp: now,
  }));
  return {
    id: source.sessionId,
    ...(source.sessionName ? { name: source.sessionName } : {}),
    cwd: source.cwd || "/",
    createdAt: timestamps.length ? Math.min(...timestamps) : now,
    updatedAt: timestamps.length ? Math.max(...timestamps) : now,
    phase: source.phase,
    model: source.model,
    thinkingLevel: source.thinkingLevel,
    attached: true,
    locked: false,
    revision: source.revision,
    transcript,
    queuedSteer,
    queuedSteerCount: queuedSteer.length,
  };
};

/* ── live progress ─────────────────────────────────────────────────────────── */

/**
 * Stateful only in that it remembers which assistant message is currently
 * streaming (to address `assistant_delta` frames). Everything else is a pure
 * event→progress mapping. The client applies deltas by content index, so any
 * event that can change the content-part *count* re-sends the whole item
 * (`item_updated`) instead of a delta.
 */
export class TranscriptProjector {
  progressFor(event: AgentSessionEvent): TranscriptProgress[] {
    const record = event as unknown as UnknownRecord;
    switch (event.type) {
      case "message_start": {
        const message = asRecord(record["message"]);
        if (!message || message["role"] !== "assistant") return [];
        return [{ type: "item_started", item: assistantItem(message) }];
      }
      case "message_update": {
        const message = asRecord(record["message"]);
        if (!message) return [];
        const item = assistantItem(message);
        const streamEvent = asRecord(record["assistantMessageEvent"]);
        const kindMap: Record<string, "text" | "thinking" | "toolCall"> = {
          text_delta: "text",
          thinking_delta: "thinking",
          toolcall_delta: "toolCall",
        };
        const type = typeof streamEvent?.["type"] === "string" ? streamEvent["type"] : "";
        const kind = kindMap[type];
        if (
          kind &&
          typeof streamEvent?.["delta"] === "string" &&
          typeof streamEvent?.["contentIndex"] === "number"
        ) {
          return [
            {
              type: "assistant_delta",
              messageId: item.id,
              contentIndex: streamEvent["contentIndex"],
              kind,
              delta: streamEvent["delta"],
            },
          ];
        }
        // Part boundaries (text/thinking/toolcall start+end) change the
        // content shape: re-send the authoritative item.
        return [{ type: "item_updated", item }];
      }
      case "message_end": {
        const message = asRecord(record["message"]);
        if (!message || message["role"] !== "assistant") return [];
        const item = assistantItem(message);
        if (item.status === "streaming") return [{ type: "item_updated", item }];
        return [{ type: "item_finished", item }];
      }
      case "tool_execution_start": {
        const toolCallId = typeof record["toolCallId"] === "string" ? record["toolCallId"] : "";
        if (!toolCallId) return [];
        return [
          {
            type: "item_started",
            item: toolItem(
              {
                toolCallId,
                toolName: record["toolName"],
                content: [],
                timestamp: Date.now(),
              },
              (record["args"] ?? {}) as ToolTranscriptItem["input"],
              true,
            ),
          },
        ];
      }
      case "tool_execution_update": {
        // Long-running tools stream partial results (terminal output, subagent
        // progress details). The partial rides as an item_updated of the still
        // running tool item — the client reducer replaces it in place.
        const toolCallId = typeof record["toolCallId"] === "string" ? record["toolCallId"] : "";
        const partial = asRecord(record["partialResult"]) ?? asRecord(record["result"]);
        if (!toolCallId) return [];
        return [
          {
            type: "item_updated",
            item: toolItem(
              {
                toolCallId,
                toolName: record["toolName"],
                content: partial?.["content"] ?? [],
                details: partial?.["details"],
                timestamp: Date.now(),
              },
              (record["args"] ?? {}) as ToolTranscriptItem["input"],
              true,
            ),
          },
        ];
      }
      case "tool_execution_end": {
        const toolCallId = typeof record["toolCallId"] === "string" ? record["toolCallId"] : "";
        const result = asRecord(record["result"]);
        if (!toolCallId) return [];
        const item = toolItem(
          {
            toolCallId,
            toolName: record["toolName"],
            content: result?.["content"] ?? [],
            details: result?.["details"],
            usage: result?.["usage"],
            isError: record["isError"] === true || result?.["isError"] === true,
            timestamp: Date.now(),
          },
          (record["args"] ?? {}) as ToolTranscriptItem["input"],
          false,
        );
        if (item.status === "running") return [];
        return [{ type: "item_finished", item }];
      }
      case "entry_appended": {
        const entry = asRecord(record["entry"]);
        const message = asRecord(entry?.["message"]);
        if (entry?.["type"] !== "message" || !message) return [];
        // Assistant and tool messages already flow through message_* and
        // tool_execution_*; the entry log is where user messages surface.
        if (message["role"] !== "user") return [];
        return [{ type: "item_started", item: userItem(message) }];
      }
      default:
        return [];
    }
  }
}
