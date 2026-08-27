import { Schema } from "effect";
import { RigNodeSchema } from "./rigs";

export const CONTROLLER_MODES = ["head", "worker", "standalone"] as const;
export const ControllerModeSchema = Schema.Literals(CONTROLLER_MODES);
export type ControllerMode = (typeof CONTROLLER_MODES)[number];

export const WORKER_TARGET_HEADER = "x-local-studio-worker-id";
export const FEDERATION_HOP_HEADER = "x-local-studio-federation-hop";

export const WorkerModelSchema = Schema.Struct({
  id: Schema.String,
  object: Schema.optional(Schema.String),
  created: Schema.optional(Schema.Number),
  owned_by: Schema.optional(Schema.String),
  active: Schema.optional(Schema.Boolean),
  max_model_len: Schema.optional(Schema.NullOr(Schema.Number)),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

export type WorkerModel = typeof WorkerModelSchema.Type;

export const WorkerModelListSchema = Schema.Struct({
  object: Schema.optional(Schema.String),
  data: Schema.Array(WorkerModelSchema),
});

export const WorkerStatusSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  address: Schema.String,
  healthy: Schema.Boolean,
  active_streams: Schema.Number,
  models: Schema.Array(WorkerModelSchema),
  hardware: Schema.NullOr(RigNodeSchema),
  checked_at: Schema.String,
  error: Schema.NullOr(Schema.String),
});

export type WorkerStatus = typeof WorkerStatusSchema.Type;

export const WorkersPayloadSchema = Schema.Struct({
  mode: ControllerModeSchema,
  workers: Schema.Array(WorkerStatusSchema),
});

export type WorkersPayload = typeof WorkersPayloadSchema.Type;

export const SessionAttachmentMetadataSchema = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
  size: Schema.Number,
  path: Schema.optional(Schema.String),
});

export const SessionUsageTotalsSchema = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cache_read: Schema.Number,
  cache_write: Schema.Number,
  reasoning: Schema.Number,
  total: Schema.Number,
  calls: Schema.Number,
});

export const SessionMetadataSchema = Schema.Struct({
  session_id: Schema.String,
  pi_session_id: Schema.NullOr(Schema.String),
  desktop_id: Schema.String,
  desktop_name: Schema.String,
  project_id: Schema.NullOr(Schema.String),
  project_name: Schema.NullOr(Schema.String),
  project_path: Schema.NullOr(Schema.String),
  title: Schema.String,
  last_message_preview: Schema.NullOr(Schema.String),
  status: Schema.String,
  model_id: Schema.NullOr(Schema.String),
  started_at: Schema.NullOr(Schema.String),
  updated_at: Schema.String,
  attachment_count: Schema.Number,
  attachments: Schema.Array(SessionAttachmentMetadataSchema),
  usage: Schema.NullOr(SessionUsageTotalsSchema),
});

export type SessionMetadata = typeof SessionMetadataSchema.Type;

export const SessionMetadataPayloadSchema = Schema.Struct({
  sessions: Schema.Array(SessionMetadataSchema),
});

export type SessionMetadataPayload = typeof SessionMetadataPayloadSchema.Type;

export const InferenceUsageEventSchema = Schema.Struct({
  event_id: Schema.String,
  occurred_at: Schema.String,
  origin_controller_id: Schema.String,
  model: Schema.String,
  source: Schema.NullOr(Schema.String),
  session_id: Schema.NullOr(Schema.String),
  provider: Schema.NullOr(Schema.String),
  worker_id: Schema.NullOr(Schema.String),
  prompt_tokens: Schema.Number,
  completion_tokens: Schema.Number,
  reasoning_tokens: Schema.Number,
  cache_read_tokens: Schema.Number,
  cache_write_tokens: Schema.Number,
  ttft_ms: Schema.NullOr(Schema.Number),
  duration_ms: Schema.NullOr(Schema.Number),
  status: Schema.Number,
  streamed: Schema.Boolean,
});

export type InferenceUsageEvent = typeof InferenceUsageEventSchema.Type;

export const InferenceUsageBatchSchema = Schema.Struct({
  events: Schema.Array(InferenceUsageEventSchema),
});

export const InferenceUsageAckSchema = Schema.Struct({
  event_ids: Schema.Array(Schema.String),
});
