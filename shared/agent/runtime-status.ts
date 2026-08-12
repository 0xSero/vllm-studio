import { Schema } from "effect";
import { RuntimeContextUsageSchema } from "./context-usage";
import { AgentViewMessageSchema, AgentViewTokenStatsSchema } from "./session-view";

const RuntimeQueueSchema = Schema.Struct({
  steering: Schema.Array(Schema.String),
  followUp: Schema.Array(Schema.String),
});

export const RuntimeExtensionUiRequestSchema = Schema.Struct({
  requestId: Schema.String,
  method: Schema.Literals(["select", "confirm", "input", "editor"]),
  title: Schema.String,
  message: Schema.optional(Schema.String),
  placeholder: Schema.optional(Schema.String),
  prefill: Schema.optional(Schema.String),
  options: Schema.optional(Schema.Array(Schema.String)),
});

export const RuntimeStatusSchema = Schema.Struct({
  active: Schema.optional(Schema.Boolean),
  running: Schema.optional(Schema.Boolean),
  piSessionId: Schema.optional(Schema.Union([Schema.Null, Schema.String])),
  modelId: Schema.optional(Schema.Union([Schema.Null, Schema.String])),
  cwd: Schema.optional(Schema.String),
  eventSeq: Schema.optional(Schema.Number),
  contextUsage: Schema.optional(Schema.Union([Schema.Null, RuntimeContextUsageSchema])),
  messages: Schema.optional(Schema.mutable(Schema.Array(AgentViewMessageSchema))),
  tokenStats: Schema.optional(AgentViewTokenStatsSchema),
  queue: Schema.optional(RuntimeQueueSchema),
  extensionUiRequest: Schema.optional(Schema.Union([Schema.Null, RuntimeExtensionUiRequestSchema])),
});

export type RuntimeExtensionUiRequest = Schema.Schema.Type<typeof RuntimeExtensionUiRequestSchema>;
export type RuntimeStatus = Schema.Schema.Type<typeof RuntimeStatusSchema>;
export type { RuntimeContextUsage } from "./context-usage";

export const RuntimeStatusEventSchema = Schema.Struct({
  type: Schema.Literal("status"),
  sessionId: Schema.String,
  phase: Schema.Literals(["running", "idle"]),
  session: RuntimeStatusSchema,
});

export const RuntimePiEventSchema = Schema.Struct({
  type: Schema.Literal("pi"),
  sessionId: Schema.String,
  seq: Schema.Number,
  event: Schema.Record(Schema.String, Schema.Unknown),
  snapshot: RuntimeStatusSchema,
});

export const RuntimeSessionSummarySchema = Schema.Struct({
  sessionId: Schema.String,
  status: RuntimeStatusSchema,
});

export const RuntimeSessionsEventSchema = Schema.Struct({
  type: Schema.Literal("sessions"),
  sessions: Schema.Array(RuntimeSessionSummarySchema),
});

export const RuntimeActivityPayloadSchema = Schema.Union([
  RuntimeSessionsEventSchema,
  RuntimeStatusEventSchema,
  RuntimePiEventSchema,
]);

export const RuntimeStatusResponseSchema = Schema.Struct({
  status: Schema.optional(Schema.Union([Schema.Null, RuntimeStatusSchema])),
});

export type RuntimeActivityPayload = Schema.Schema.Type<typeof RuntimeActivityPayloadSchema>;
export type RuntimeSessionSummary = Schema.Schema.Type<typeof RuntimeSessionSummarySchema>;
