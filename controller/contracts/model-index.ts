import { Schema } from "effect";
export { default as bundledModelIndexSource } from "./model-index.json";

export const ModelIndexVariantSchema = Schema.Struct({
  format: Schema.Literals(["bf16", "fp8", "nvfp4", "q4"]),
  repo: Schema.String,
  official: Schema.Boolean,
  source: Schema.optional(Schema.String),
  allow_patterns: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  size_gb: Schema.NullOr(Schema.Number),
  caveat: Schema.NullOr(Schema.String),
});

export const ModelIndexModelSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  role: Schema.NullOr(Schema.Literals(["fast", "smart"])),
  description: Schema.String,
  params: Schema.String,
  // Short architecture phrase for the card's spec line ("MoE · 384 experts,
  // top-8"). Optional so an operator's hand-written data/model-index.json
  // override from an older build still validates.
  architecture: Schema.optional(Schema.NullOr(Schema.String)),
  total_params_b: Schema.optional(Schema.NullOr(Schema.Number)),
  // Artificial Analysis Intelligence Index (0-100) and its agentic subscore,
  // taken from the reasoning-enabled entry where a model ships thinking on by
  // default. Null means AA has not benchmarked the model, not that it scored 0.
  intelligence_index: Schema.optional(Schema.NullOr(Schema.Number)),
  agentic_index: Schema.optional(Schema.NullOr(Schema.Number)),
  active_params_b: Schema.NullOr(Schema.Number),
  context_tokens: Schema.Number,
  license: Schema.String,
  multimodal: Schema.Boolean,
  notes: Schema.Array(Schema.String),
  variants: Schema.Array(ModelIndexVariantSchema),
});

export const ModelIndexTierSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  blurb: Schema.String,
  models: Schema.Array(ModelIndexModelSchema),
});

export const ModelIndexSchema = Schema.Struct({
  version: Schema.Number,
  updated: Schema.String,
  /** Attribution for the intelligence scores, shown under the catalog table. */
  intelligence_source: Schema.optional(Schema.String),
  tiers: Schema.Array(ModelIndexTierSchema),
});

export type ModelIndexVariant = Schema.Schema.Type<typeof ModelIndexVariantSchema>;
export type ModelIndexModel = Schema.Schema.Type<typeof ModelIndexModelSchema>;
export type ModelIndexTier = Schema.Schema.Type<typeof ModelIndexTierSchema>;
export type ModelIndexResponse = Schema.Schema.Type<typeof ModelIndexSchema>;
export type ModelIndexVariantFormat = ModelIndexVariant["format"];
