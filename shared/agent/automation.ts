import { Schema } from "effect";

export const AutomationScheduleSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("interval"),
    minutes: Schema.Number,
  }),
  Schema.Struct({
    kind: Schema.Literal("daily"),
    time: Schema.String,
    weekdaysOnly: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    kind: Schema.Literal("weekly"),
    day: Schema.Number,
    time: Schema.String,
  }),
]);

export const AutomationTargetSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("global") }),
  Schema.Struct({
    kind: Schema.Literal("thread"),
    threadId: Schema.String,
    piSessionId: Schema.NullOr(Schema.String),
  }),
]);

export const AutomationFallbackReasonSchema = Schema.Literals([
  "requested_model_inactive",
  "requested_model_unavailable",
]);

export const AutomationRunSchema = Schema.Struct({
  at: Schema.String,
  piSessionId: Schema.NullOr(Schema.String),
  cwd: Schema.String,
  projectId: Schema.NullOr(Schema.String),
  target: Schema.optional(AutomationTargetSchema),
  outcome: Schema.Literals(["ok", "error"]),
  summary: Schema.String,
  error: Schema.optional(Schema.String),
  requestedModelId: Schema.optional(Schema.String),
  actualModelId: Schema.optional(Schema.String),
  fallbackUsed: Schema.optional(Schema.Boolean),
  fallbackReason: Schema.optional(AutomationFallbackReasonSchema),
});

export const AutomationSchema = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String,
  name: Schema.String,
  prompt: Schema.String,
  modelId: Schema.String,
  cwd: Schema.String,
  target: Schema.optional(AutomationTargetSchema),
  schedule: AutomationScheduleSchema,
  status: Schema.Literals(["active", "paused"]),
  nextRunAt: Schema.NullOr(Schema.String),
  lastRun: Schema.NullOr(AutomationRunSchema),
  runs: Schema.Array(AutomationRunSchema),
  unread: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export const AutomationsResponseSchema = Schema.Struct({
  automations: Schema.Array(AutomationSchema),
});

export const AutomationResponseSchema = Schema.Struct({
  automation: AutomationSchema,
});

export type AutomationSchedule = typeof AutomationScheduleSchema.Type;
export type AutomationTarget = typeof AutomationTargetSchema.Type;
export type AutomationFallbackReason = typeof AutomationFallbackReasonSchema.Type;
export type AutomationRun = typeof AutomationRunSchema.Type;
export type Automation = typeof AutomationSchema.Type;
