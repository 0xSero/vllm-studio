import { Schema } from "effect";

export const ScientistResearchFieldSchema = Schema.Literals([
  "biology",
  "chemistry",
  "physics",
  "climate",
  "materials",
  "computer_science",
  "social_science",
  "medicine",
  "engineering",
  "mathematics",
  "other",
]);

export const ScientistDataTypeSchema = Schema.Literals([
  "tabular",
  "images",
  "text",
  "time_series",
  "genomic",
  "spatial",
  "sensor",
  "audio",
  "video",
  "graphs",
  "other",
]);

export const ScientistGoalSchema = Schema.Literals([
  "literature_review",
  "data_analysis",
  "experiment_pipeline",
  "model_training",
  "report_writing",
  "hypothesis_testing",
  "visualization",
  "other",
]);

export const ScientistComputePreferenceSchema = Schema.Literals([
  "local-smolvm",
  "local-jupyter",
  "remote",
]);

export const ScientistExperienceLevelSchema = Schema.Literals([
  "no_code",
  "some_code",
  "expert",
]);

export const ScientistProcessStepSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  description: Schema.optional(Schema.String),
  step_type: Schema.Literals([
    "data_collection",
    "data_cleaning",
    "exploration",
    "analysis",
    "modeling",
    "visualization",
    "interpretation",
    "reporting",
    "custom",
  ]),
  order: Schema.Number,
});

export const ScientistProfileSchema = Schema.Struct({
  research_field: ScientistResearchFieldSchema,
  specialization: Schema.optional(Schema.String),
  data_types: Schema.Array(ScientistDataTypeSchema),
  goals: Schema.Array(ScientistGoalSchema),
  compute_preference: ScientistComputePreferenceSchema,
  experience_level: ScientistExperienceLevelSchema,
  process_steps: Schema.optional(Schema.Array(ScientistProcessStepSchema)),
  preferred_templates: Schema.optional(Schema.Array(Schema.String)),
  created_at: Schema.String,
  updated_at: Schema.String,
});

export const ScientistProfileCreateSchema = Schema.Struct({
  research_field: ScientistResearchFieldSchema,
  specialization: Schema.optional(Schema.String),
  data_types: Schema.Array(ScientistDataTypeSchema),
  goals: Schema.Array(ScientistGoalSchema),
  compute_preference: ScientistComputePreferenceSchema,
  experience_level: ScientistExperienceLevelSchema,
  process_steps: Schema.optional(Schema.Array(ScientistProcessStepSchema)),
  preferred_templates: Schema.optional(Schema.Array(Schema.String)),
});

export type ScientistProfile = typeof ScientistProfileSchema.Type;
export type ScientistProfileCreate = typeof ScientistProfileCreateSchema.Type;
export type ScientistProcessStep = typeof ScientistProcessStepSchema.Type;
export type ScientistResearchField = typeof ScientistResearchFieldSchema.Type;
export type ScientistDataType = typeof ScientistDataTypeSchema.Type;
export type ScientistGoal = typeof ScientistGoalSchema.Type;
export type ScientistComputePreference = typeof ScientistComputePreferenceSchema.Type;
export type ScientistExperienceLevel = typeof ScientistExperienceLevelSchema.Type;
