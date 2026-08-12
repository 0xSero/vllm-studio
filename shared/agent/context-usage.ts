import { Schema } from "effect";

export const RuntimeContextUsageSchema = Schema.Struct({
  tokens: Schema.Union([Schema.Null, Schema.Number]),
  contextWindow: Schema.Number,
  percent: Schema.Union([Schema.Null, Schema.Number]),
  shouldCompact: Schema.Boolean,
});

export type RuntimeContextUsage = Schema.Schema.Type<typeof RuntimeContextUsageSchema>;
