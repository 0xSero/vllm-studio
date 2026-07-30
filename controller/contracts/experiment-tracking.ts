import { Schema } from "effect";

export const ExperimentArtifactSchema = Schema.Struct({
  name: Schema.String,
  path: Schema.optional(Schema.String),
  digest: Schema.optional(Schema.String),
  size_bytes: Schema.optional(Schema.Number),
  kind: Schema.Literals(["model", "data", "plot", "report", "log", "other"]),
});

export const ExperimentRecordSchema = Schema.Struct({
  id: Schema.String,
  project_id: Schema.String,
  name: Schema.String,
  parameters: Schema.Record(Schema.String, Schema.Unknown),
  metrics: Schema.Record(Schema.String, Schema.Unknown),
  notes: Schema.optional(Schema.String),
  artifacts: Schema.Array(ExperimentArtifactSchema),
  parent_experiment_id: Schema.optional(Schema.String),
  status: Schema.Literals(["running", "succeeded", "failed", "cancelled"]),
  created_at: Schema.String,
  updated_at: Schema.String,
  completed_at: Schema.optional(Schema.String),
});

export const ExperimentRecordCreateSchema = Schema.Struct({
  project_id: Schema.String,
  name: Schema.String,
  parameters: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  notes: Schema.optional(Schema.String),
  parent_experiment_id: Schema.optional(Schema.String),
});

export const ExperimentRecordUpdateSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  parameters: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  metrics: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  notes: Schema.optional(Schema.String),
  artifacts: Schema.optional(Schema.Array(ExperimentArtifactSchema)),
  status: Schema.optional(Schema.Literals(["running", "succeeded", "failed", "cancelled"])),
  completed_at: Schema.optional(Schema.String),
});

export type ExperimentRecord = typeof ExperimentRecordSchema.Type;
export type ExperimentRecordCreate = typeof ExperimentRecordCreateSchema.Type;
export type ExperimentRecordUpdate = typeof ExperimentRecordUpdateSchema.Type;
export type ExperimentArtifact = typeof ExperimentArtifactSchema.Type;
