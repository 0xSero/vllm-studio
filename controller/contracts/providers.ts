import { Schema } from "effect";

export const ProviderCreateSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  base_url: Schema.String,
  api_key: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
});

export const ProviderUpdateSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  base_url: Schema.optional(Schema.String),
  api_key: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
});

export const ProviderModelsSchema = Schema.Struct({
  data: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.optional(Schema.String) }))),
});
