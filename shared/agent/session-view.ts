import { Schema } from "effect";
import { ComposerSkillRefSchema } from "./composer-refs";

const RecordSchema = Schema.Record(Schema.String, Schema.Unknown);

export const AgentViewToolBlockSchema = Schema.Struct({
  kind: Schema.Literal("tool"),
  id: Schema.String,
  name: Schema.String,
  status: Schema.Literals(["running", "done", "error"]),
  argsText: Schema.optional(Schema.String),
  args: Schema.optional(RecordSchema),
  resultText: Schema.optional(Schema.String),
  text: Schema.String,
});

export const AgentViewBlockSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("text"), id: Schema.String, text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("thinking"), id: Schema.String, text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("event"), id: Schema.String, text: Schema.String }),
  AgentViewToolBlockSchema,
]);

export const AgentViewAttachmentSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  type: Schema.String,
  size: Schema.Number,
  path: Schema.optional(Schema.String),
  mode: Schema.Literals(["text", "data-url", "metadata"]),
  content: Schema.String,
  previewKind: Schema.optional(Schema.Literals(["image", "video", "audio", "pdf", "file"])),
  previewUrl: Schema.optional(Schema.String),
});

export const AgentViewMessageSchema = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(["user", "assistant", "system"]),
  text: Schema.String,
  attachments: Schema.optional(Schema.mutable(Schema.Array(AgentViewAttachmentSchema))),
  skills: Schema.optional(Schema.mutable(Schema.Array(ComposerSkillRefSchema))),
  blocks: Schema.optional(Schema.mutable(Schema.Array(AgentViewBlockSchema))),
  streamCalls: Schema.optional(
    Schema.mutable(Schema.Array(Schema.mutable(Schema.Array(RecordSchema)))),
  ),
  pending: Schema.optional(Schema.Boolean),
  awaitingEcho: Schema.optional(Schema.Boolean),
  timestamp: Schema.optional(Schema.String),
});

export const AgentViewTokenStatsSchema = Schema.Struct({
  read: Schema.Number,
  write: Schema.Number,
  current: Schema.Number,
});

export const AgentViewQueuedMessageSchema = Schema.Struct({
  id: Schema.String,
  mode: Schema.Literals(["steer", "follow_up"]),
  text: Schema.String,
  sent: Schema.optional(Schema.Boolean),
});

export type AssistantBlock = Schema.Schema.Type<typeof AgentViewBlockSchema>;
export type ToolBlock = Schema.Schema.Type<typeof AgentViewToolBlockSchema>;
export type TextBlock = Extract<AssistantBlock, { kind: "text" }>;
export type ThinkingBlock = Extract<AssistantBlock, { kind: "thinking" }>;
export type EventBlock = Extract<AssistantBlock, { kind: "event" }>;
export type ChatMessageAttachment = Schema.Schema.Type<typeof AgentViewAttachmentSchema>;
export type TokenStats = Schema.Schema.Type<typeof AgentViewTokenStatsSchema>;
export type QueuedMessage = Schema.Schema.Type<typeof AgentViewQueuedMessageSchema>;
export type ChatMessage = Schema.Schema.Type<typeof AgentViewMessageSchema>;

const sameMessage = (left: ChatMessage, right: ChatMessage): boolean =>
  left.role === right.role && left.text.trim() === right.text.trim();

export function mergeAgentViewMessages(
  current: readonly ChatMessage[],
  live: readonly ChatMessage[],
): ChatMessage[] {
  if (live.length === 0) return [...current];
  let currentStart = -1;
  let liveStart = -1;
  for (let right = live.length - 1; right >= 0 && currentStart < 0; right -= 1) {
    if (live[right].role !== "user") continue;
    for (let left = current.length - 1; left >= 0; left -= 1) {
      if (sameMessage(current[left], live[right])) {
        currentStart = left;
        liveStart = right;
        break;
      }
    }
  }
  const merged =
    currentStart < 0
      ? [...current, ...live]
      : [...current.slice(0, currentStart), ...live.slice(liveStart)];
  for (const message of current) {
    if (
      message.role === "user" &&
      (message.pending || message.awaitingEcho) &&
      !merged.some((candidate) => sameMessage(candidate, message))
    ) {
      merged.push(message);
    }
  }
  return merged;
}
