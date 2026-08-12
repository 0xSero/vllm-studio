import { Schema } from "effect";
import { RuntimeContextUsageSchema } from "./context-usage";

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
  eventSeq: Schema.optional(Schema.Number),
  contextUsage: Schema.optional(Schema.Union([Schema.Null, RuntimeContextUsageSchema])),
  messages: Schema.optional(Schema.Array(Schema.Record(Schema.String, Schema.Unknown))),
  queue: Schema.optional(RuntimeQueueSchema),
  extensionUiRequest: Schema.optional(Schema.Union([Schema.Null, RuntimeExtensionUiRequestSchema])),
});

export type RuntimeExtensionUiRequest = Schema.Schema.Type<
  typeof RuntimeExtensionUiRequestSchema
>;
export type RuntimeStatus = Schema.Schema.Type<typeof RuntimeStatusSchema>;
