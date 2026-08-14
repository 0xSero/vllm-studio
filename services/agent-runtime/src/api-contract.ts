import { Schema } from "effect";

export const ApiErrorResponseSchema = Schema.Struct({ error: Schema.String });

export const RuntimeSessionContextUsageSchema = Schema.Struct({
  tokens: Schema.Union([Schema.Null, Schema.Number]),
  contextWindow: Schema.Number,
  percent: Schema.Union([Schema.Null, Schema.Number]),
  shouldCompact: Schema.Boolean,
});

export const RuntimeSessionStatusSchema = Schema.Struct({
  running: Schema.Boolean,
  active: Schema.Boolean,
  modelId: Schema.String,
  cwd: Schema.String,
  piSessionId: Schema.Union([Schema.Null, Schema.String]),
  agentDir: Schema.String,
  eventSeq: Schema.Number,
  lastError: Schema.Union([Schema.Null, Schema.String]),
  contextUsage: Schema.Union([Schema.Null, RuntimeSessionContextUsageSchema]),
});

export const RuntimeSessionSummarySchema = Schema.Struct({
  sessionId: Schema.String,
  status: RuntimeSessionStatusSchema,
  cwd: Schema.optional(Schema.String),
});

export const RuntimeSessionsResponseSchema = Schema.Struct({
  sessions: Schema.Array(RuntimeSessionSummarySchema),
});

export type RuntimeSessionSummary = Schema.Schema.Type<typeof RuntimeSessionSummarySchema>;
export type RuntimeSessionsResponse = Schema.Schema.Type<typeof RuntimeSessionsResponseSchema>;
