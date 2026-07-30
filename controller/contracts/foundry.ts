import { Schema } from "effect";

export const FoundryCatalogItemSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  object: Schema.optional(Schema.String),
});
export type FoundryCatalogItem = typeof FoundryCatalogItemSchema.Type;

export const FoundryCatalogSchema = Schema.Struct({
  data: Schema.Array(FoundryCatalogItemSchema),
});

export const FoundryCatalogViewSchema = Schema.Struct({
  object: Schema.Literal("list"),
  data: Schema.Array(FoundryCatalogItemSchema),
  provider_id: Schema.String,
  correlation_id: Schema.String,
  observed_at: Schema.String,
});
export type FoundryCatalogView = typeof FoundryCatalogViewSchema.Type;

export const FoundryUsageSchema = Schema.Struct({
  input_tokens: Schema.optional(Schema.Number),
  output_tokens: Schema.optional(Schema.Number),
  total_tokens: Schema.optional(Schema.Number),
});
export type FoundryUsage = typeof FoundryUsageSchema.Type;

export const FoundryHealthSchema = Schema.Struct({
  configured: Schema.Boolean,
  required: Schema.Boolean,
  state: Schema.Literals(["claimed", "observed", "contradicted"]),
  detail: Schema.String,
  provider_id: Schema.optional(Schema.String),
  correlation_ids: Schema.Array(Schema.String),
  checked_at: Schema.optional(Schema.String),
  model_count: Schema.Number,
  agent_count: Schema.Number,
});
export type FoundryHealth = typeof FoundryHealthSchema.Type;
