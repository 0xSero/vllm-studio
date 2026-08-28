import { Schema } from "effect";

/**
 * Contracts for the published local-ai-registry
 * (https://github.com/0xSero/local-ai-registry, schema_version
 * `local-ai-registry/v1`). Discovery reads `registry/index.json`; exact records
 * are loaded progressively per id. Full JSON Schemas for contribution records
 * live in `registry-schema/` and are the validation authority for anything this
 * controller generates.
 */
export const REGISTRY_SCHEMA_VERSION = "local-ai-registry/v1" as const;

export const REGISTRY_REPO = "0xSero/local-ai-registry" as const;
export const REGISTRY_BASE_BRANCH = "main" as const;
export const REGISTRY_DEFAULT_BASE_URL =
  "https://raw.githubusercontent.com/0xSero/local-ai-registry/main/registry" as const;

/** One recipe row inside `index.json`: the discovery surface. */
export const RegistryIndexRowSchema = Schema.Struct({
  id: Schema.String,
  recipe_source: Schema.String,
  status: Schema.Literals(["candidate", "validated"]),
  model_instance_id: Schema.String,
  hardware_id: Schema.String,
  hardware_count: Schema.Number,
  engine: Schema.String,
  launch_kind: Schema.String,
  has_evidence: Schema.Boolean,
  capabilities: Schema.Struct({
    chat: Schema.NullOr(Schema.Boolean),
    reasoning: Schema.NullOr(Schema.Boolean),
    tools: Schema.NullOr(Schema.Boolean),
    vision: Schema.NullOr(Schema.Boolean),
  }),
});

export const RegistryIndexSchema = Schema.Struct({
  schema_version: Schema.String,
  resolver_rule: Schema.optional(Schema.String),
  collections: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  counts: Schema.Record(Schema.String, Schema.Number),
  recipes: Schema.Array(RegistryIndexRowSchema),
});

/** Hardware identity, normalized names, and memory. Matching consumes these. */
export const RegistryHardwareSchema = Schema.Struct({
  schema_version: Schema.String,
  id: Schema.String,
  vendor: Schema.Literals(["nvidia", "amd", "intel", "apple"]),
  name: Schema.String,
  family: Schema.optional(Schema.NullOr(Schema.String)),
  kind: Schema.Literals(["discrete", "integrated", "unified"]),
  accelerator_backend: Schema.Literals(["nvidia", "amd-rocm", "intel-xpu", "metal"]),
  aliases: Schema.optional(Schema.Array(Schema.String)),
  products: Schema.optional(Schema.Array(Schema.String)),
  memory: Schema.Struct({
    vram_gb: Schema.Number,
    vram_type: Schema.NullOr(Schema.String),
    cpu_memory_gb: Schema.NullOr(Schema.Number),
    bandwidth_gb_per_s: Schema.NullOr(
      Schema.Union([Schema.Number, Schema.Struct({ min: Schema.Number, max: Schema.Number })]),
    ),
  }),
});

export const RegistryModelSchema = Schema.Struct({
  schema_version: Schema.String,
  id: Schema.String,
  family: Schema.String,
  name: Schema.String,
  params: Schema.Number,
  active_params: Schema.NullOr(Schema.Number),
  architecture: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
});

/** The exact artifact behind a recipe: repo, revision, quantization, size. */
export const RegistryModelInstanceSchema = Schema.Struct({
  schema_version: Schema.String,
  id: Schema.String,
  model_id: Schema.String,
  repository: Schema.String,
  url: Schema.optional(Schema.NullOr(Schema.String)),
  revision: Schema.NullOr(Schema.String),
  served_name: Schema.NullOr(Schema.String),
  weights: Schema.Struct({
    format: Schema.NullOr(Schema.String),
    precision: Schema.NullOr(Schema.String),
    size_gb: Schema.NullOr(Schema.Number),
  }),
  kind: Schema.Literals(["base", "quant", "fine-tune"]),
});

/** The launch contract: engine, serving envelope, runtime, capabilities. */
export const RegistryRecipeSchema = Schema.Struct({
  schema_version: Schema.String,
  id: Schema.String,
  recipe_source: Schema.String,
  status: Schema.Literals(["candidate", "validated"]),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  model_instance_id: Schema.String,
  hardware_id: Schema.String,
  hardware_count: Schema.Number,
  engine: Schema.Struct({
    name: Schema.String,
    version: Schema.NullOr(Schema.String),
    graph_mode: Schema.NullOr(Schema.String),
  }),
  launch: Schema.Struct({
    kind: Schema.Literals([
      "reference",
      "docker",
      "docker-compose",
      "controller",
      "script",
      "native",
    ]),
  }),
  serving: Schema.Record(Schema.String, Schema.Unknown),
  capabilities: Schema.Struct({
    chat: Schema.NullOr(Schema.Boolean),
    reasoning: Schema.NullOr(Schema.Boolean),
    tools: Schema.NullOr(Schema.Boolean),
    vision: Schema.NullOr(Schema.Boolean),
  }),
  speed_sweeps_ids: Schema.Array(Schema.String),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
});

export const RegistryCollectionSchema = Schema.Literals([
  "hardware",
  "model",
  "model-instance",
  "recipe",
  "speed-sweeps",
]);

export type RegistryIndexRow = Schema.Schema.Type<typeof RegistryIndexRowSchema>;
export type RegistryIndex = Schema.Schema.Type<typeof RegistryIndexSchema>;
export type RegistryHardware = Schema.Schema.Type<typeof RegistryHardwareSchema>;
export type RegistryModel = Schema.Schema.Type<typeof RegistryModelSchema>;
export type RegistryModelInstance = Schema.Schema.Type<typeof RegistryModelInstanceSchema>;
export type RegistryRecipe = Schema.Schema.Type<typeof RegistryRecipeSchema>;
export type RegistryCollection = Schema.Schema.Type<typeof RegistryCollectionSchema>;

/** A recipe row joined with how it relates to this machine's hardware. */
export interface RegistryRecommendation {
  row: RegistryIndexRow;
  fit: {
    state: "match" | "other";
    hardware_match: RegistryHardwareMatch | null;
  };
}

/** One detected accelerator group joined to a registry hardware record. */
export interface RegistryHardwareMatch {
  hardware_id: string;
  registry_name: string;
  detected_name: string;
  vendor: string;
  memory_gb: number | null;
  registry_memory_gb: number | null;
  detected_count: number;
  matched: boolean;
  reason: string;
}
