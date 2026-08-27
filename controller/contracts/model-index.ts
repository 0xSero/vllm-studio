import { Schema } from "effect";
import compactSource from "./model-index.json";

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
  architecture: Schema.optional(Schema.NullOr(Schema.String)),
  total_params_b: Schema.optional(Schema.NullOr(Schema.Number)),
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

/**
 * A launchable registry entry: a model the operator authored (or that was
 * migrated from the old SQLite recipes table), carrying its full serve
 * configuration. `serve` is the recipe body minus id/name — it is validated by
 * the recipe serializer on read, not here, so the recipe shape stays declared
 * exactly once (in contracts/recipes.ts).
 */
export const ModelIndexEntrySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  serve: Schema.Record(Schema.String, Schema.Unknown),
});

export const ModelIndexSchema = Schema.Struct({
  version: Schema.Number,
  updated: Schema.String,
  intelligence_source: Schema.optional(Schema.String),
  tiers: Schema.Array(ModelIndexTierSchema),
  /** Launchable entries. The catalog tiers describe what exists; entries
   *  describe what this controller can actually serve. */
  entries: Schema.optional(Schema.Array(ModelIndexEntrySchema)),
  /** Set once when the old SQLite recipes table was imported. */
  migrated_from_sqlite: Schema.optional(Schema.String),
});

export type ModelIndexVariant = Schema.Schema.Type<typeof ModelIndexVariantSchema>;
export type ModelIndexModel = Schema.Schema.Type<typeof ModelIndexModelSchema>;
export type ModelIndexTier = Schema.Schema.Type<typeof ModelIndexTierSchema>;
export type ModelIndexResponse = Schema.Schema.Type<typeof ModelIndexSchema>;
export type ModelIndexVariantFormat = ModelIndexVariant["format"];

const NullableNumber = Schema.NullOr(Schema.Number);
const CompactVariantSchema = Schema.Struct({
  f: Schema.Literals(["bf16", "fp8", "nvfp4", "q4"]),
  r: Schema.String,
  o: Schema.Boolean,
  s: Schema.optional(Schema.String),
  a: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  z: NullableNumber,
  c: Schema.NullOr(Schema.String),
});
const CompactModelSchema = Schema.Struct({
  i: Schema.String,
  n: Schema.String,
  r: Schema.NullOr(Schema.Literals(["fast", "smart"])),
  d: Schema.String,
  p: Schema.String,
  a: Schema.optional(Schema.NullOr(Schema.String)),
  t: Schema.optional(NullableNumber),
  v: NullableNumber,
  c: Schema.Number,
  l: Schema.String,
  m: Schema.Boolean,
  n0: Schema.Array(Schema.String),
  x: Schema.optional(NullableNumber),
  g: Schema.optional(NullableNumber),
  q: Schema.Array(CompactVariantSchema),
});
const CompactTierSchema = Schema.Struct({
  i: Schema.String,
  l: Schema.String,
  b: Schema.String,
  m: Schema.Array(CompactModelSchema),
});
const CompactIndexSchema = Schema.Struct({
  v: Schema.Number,
  u: Schema.String,
  s: Schema.optional(Schema.String),
  t: Schema.Array(CompactTierSchema),
});

const compact = Schema.decodeUnknownSync(CompactIndexSchema)(compactSource);
export const bundledModelIndexSource: ModelIndexResponse = Schema.decodeUnknownSync(
  ModelIndexSchema,
)({
  version: compact.v,
  updated: compact.u,
  intelligence_source: compact.s,
  tiers: compact.t.map((tier) => ({
    id: tier.i,
    label: tier.l,
    blurb: tier.b,
    models: tier.m.map((model) => ({
      id: model.i,
      name: model.n,
      role: model.r,
      description: model.d,
      params: model.p,
      architecture: model.a,
      total_params_b: model.t,
      active_params_b: model.v,
      context_tokens: model.c,
      license: model.l,
      multimodal: model.m,
      notes: model.n0,
      intelligence_index: model.x,
      agentic_index: model.g,
      variants: model.q.map((variant) => ({
        format: variant.f,
        repo: variant.r,
        official: variant.o,
        source: variant.s,
        allow_patterns: variant.a,
        size_gb: variant.z,
        caveat: variant.c,
      })),
    })),
  })),
});
export type ModelIndexEntry = Schema.Schema.Type<typeof ModelIndexEntrySchema>;
