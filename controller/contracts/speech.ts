import { Schema } from "effect";

export const CHATTERBOX_BACKEND = "chatterbox-turbo";
export const CHATTERBOX_PACKAGE_VERSION = "0.1.7";
export const CHATTERBOX_MODEL_REVISION = "749d1c1a46eb10492095d68fbcf55691ccf137cd";

export const SpeechInstallPhaseSchema = Schema.Literals([
  "missing",
  "installing",
  "ready",
  "failed",
]);
export const SpeechWorkerPhaseSchema = Schema.Literals([
  "stopped",
  "starting",
  "ready",
  "busy",
  "failed",
]);
export const SpeechGpuTargetSchema = Schema.Struct({
  uuid: Schema.String,
  name: Schema.String,
  pci_bus_id: Schema.optional(Schema.String),
});
export const SpeechVoiceProfileSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  duration_ms: Schema.Number,
  created_at: Schema.String,
});
export const SpeechStatusSchema = Schema.Struct({
  backend: Schema.Literal(CHATTERBOX_BACKEND),
  package_version: Schema.Literal(CHATTERBOX_PACKAGE_VERSION),
  model_revision: Schema.Literal(CHATTERBOX_MODEL_REVISION),
  install: Schema.Struct({
    phase: SpeechInstallPhaseSchema,
    progress: Schema.Number,
    message: Schema.String,
    error: Schema.NullOr(Schema.String),
  }),
  worker: Schema.Struct({
    phase: SpeechWorkerPhaseSchema,
    queue_depth: Schema.Number,
    error: Schema.NullOr(Schema.String),
  }),
  gpu: Schema.NullOr(SpeechGpuTargetSchema),
  prerequisites: Schema.Struct({
    ffmpeg: Schema.Boolean,
    python_311: Schema.Boolean,
    storage: Schema.Struct({
      available_bytes: Schema.NullOr(Schema.Number),
      required_bytes: Schema.Number,
      ready: Schema.Boolean,
    }),
  }),
  voice_count: Schema.Number,
});
export const SpeechStatusResponseSchema = Schema.Struct({ status: SpeechStatusSchema });
export const SpeechVoicesResponseSchema = Schema.Struct({
  voices: Schema.Array(SpeechVoiceProfileSchema),
});
export const SpeechVoiceResponseSchema = Schema.Struct({ voice: SpeechVoiceProfileSchema });

export type SpeechInstallPhase = Schema.Schema.Type<typeof SpeechInstallPhaseSchema>;
export type SpeechWorkerPhase = Schema.Schema.Type<typeof SpeechWorkerPhaseSchema>;
export type SpeechGpuTarget = Schema.Schema.Type<typeof SpeechGpuTargetSchema>;
export type SpeechVoiceProfile = Schema.Schema.Type<typeof SpeechVoiceProfileSchema>;
export type SpeechStatus = Schema.Schema.Type<typeof SpeechStatusSchema>;
