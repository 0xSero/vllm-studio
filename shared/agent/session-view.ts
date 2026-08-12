import { Schema } from "effect";
import type { ComposerSkillRef } from "./composer-refs";

const RecordSchema = Schema.Record(Schema.String, Schema.Unknown);
const ComposerSkillRefSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  source: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  instructions: Schema.optional(Schema.String),
});

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

export type ToolBlock = {
  kind: "tool";
  id: string;
  name: string;
  status: "running" | "done" | "error";
  argsText?: string;
  args?: Record<string, unknown>;
  resultText?: string;
  text: string;
};
export type TextBlock = { kind: "text"; id: string; text: string };
export type ThinkingBlock = { kind: "thinking"; id: string; text: string };
export type EventBlock = { kind: "event"; id: string; text: string };
export type AssistantBlock = TextBlock | ThinkingBlock | ToolBlock | EventBlock;
export type ChatMessageAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  path?: string;
  mode: "text" | "data-url" | "metadata";
  content: string;
  previewKind?: "image" | "video" | "audio" | "pdf" | "file";
  previewUrl?: string;
};
export type TokenStats = { read: number; write: number; current: number };
export type QueuedMessage = {
  id: string;
  mode: "steer" | "follow_up";
  text: string;
  sent?: boolean;
};
export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  attachments?: ChatMessageAttachment[];
  skills?: ComposerSkillRef[];
  blocks?: AssistantBlock[];
  streamCalls?: Array<Array<Record<string, unknown>>>;
  pending?: boolean;
  awaitingEcho?: boolean;
  timestamp?: string;
};
