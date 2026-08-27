import { Schema } from "effect";
import { AgentHarnessSchema } from "./harness-id";

export const AgentSessionKindSchema = Schema.Literals(["chat", "project"]);
export const AgentAttemptPlacementSchema = Schema.Literals(["head", "local", "node", "sandbox"]);
export const AgentExecutionStatusSchema = Schema.Literals([
  "queued",
  "running",
  "waiting",
  "retrying",
  "idle",
  "completed",
  "failed",
  "interrupted",
  "unavailable",
]);

export const ChatSessionSpecSchema = Schema.Struct({
  kind: Schema.Literal("chat"),
  sessionId: Schema.String,
  modelId: Schema.String,
  modelRouteId: Schema.optional(Schema.String),
});

export const ProjectTaskSpecSchema = Schema.Struct({
  kind: Schema.Literal("project"),
  sessionId: Schema.String,
  projectId: Schema.optional(Schema.String),
  workspace: Schema.String,
  harness: AgentHarnessSchema,
  modelId: Schema.String,
  modelRouteId: Schema.optional(Schema.String),
});

export const AgentExecutionSpecSchema = Schema.Union([
  ChatSessionSpecSchema,
  ProjectTaskSpecSchema,
]);

export const AgentToolStartedEventSchema = Schema.Struct({
  type: Schema.Literal("tool_execution_start"),
  toolCallId: Schema.String,
  toolName: Schema.String,
  arguments: Schema.optional(Schema.Unknown),
  kind: Schema.optional(Schema.String),
});

export const AgentToolUpdatedEventSchema = Schema.Struct({
  type: Schema.Literal("tool_execution_update"),
  toolCallId: Schema.String,
  status: Schema.optional(Schema.String),
  result: Schema.optional(Schema.Unknown),
});

export const AgentToolCompletedEventSchema = Schema.Struct({
  type: Schema.Literal("tool_execution_end"),
  toolCallId: Schema.String,
  status: Schema.optional(Schema.String),
  isError: Schema.Boolean,
  result: Schema.optional(Schema.Unknown),
});

export const AgentToolLifecycleEventSchema = Schema.Union([
  AgentToolStartedEventSchema,
  AgentToolUpdatedEventSchema,
  AgentToolCompletedEventSchema,
]);

export const AgentTurnWaitingEventSchema = Schema.Struct({
  type: Schema.Literal("turn_waiting"),
  message: Schema.String,
  pending: Schema.Number,
});

export const AgentTurnRetryEventSchema = Schema.Struct({
  type: Schema.Literal("turn_retry"),
  message: Schema.String,
});

export const AgentTurnFailureEventSchema = Schema.Struct({
  type: Schema.Literal("extension_error"),
  message: Schema.String,
});

export const AgentExecutionLifecycleEventSchema = Schema.Union([
  AgentToolLifecycleEventSchema,
  AgentTurnWaitingEventSchema,
  AgentTurnRetryEventSchema,
  AgentTurnFailureEventSchema,
]);

export const AgentTurnRecordSchema = Schema.Struct({
  turnId: Schema.String,
  sessionId: Schema.String,
  ordinal: Schema.Number,
  status: AgentExecutionStatusSchema,
  failure: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export const AgentAttemptRecordSchema = Schema.Struct({
  attemptId: Schema.String,
  turnId: Schema.String,
  sessionId: Schema.String,
  ordinal: Schema.Number,
  placement: AgentAttemptPlacementSchema,
  placementId: Schema.NullOr(Schema.String),
  status: AgentExecutionStatusSchema,
  failure: Schema.NullOr(Schema.String),
  leaseOwner: Schema.NullOr(Schema.String),
  leaseExpiresAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export const AgentChildRunRecordSchema = Schema.Struct({
  sessionId: Schema.String,
  childId: Schema.String,
  attemptId: Schema.NullOr(Schema.String),
  harness: AgentHarnessSchema,
  title: Schema.NullOr(Schema.String),
  status: AgentExecutionStatusSchema,
  failure: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export const AgentToolCallRecordSchema = Schema.Struct({
  sessionId: Schema.String,
  toolCallId: Schema.String,
  attemptId: Schema.NullOr(Schema.String),
  childId: Schema.NullOr(Schema.String),
  name: Schema.NullOr(Schema.String),
  status: AgentExecutionStatusSchema,
  failure: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type AgentSessionKind = typeof AgentSessionKindSchema.Type;
export type AgentAttemptPlacement = typeof AgentAttemptPlacementSchema.Type;
export type AgentExecutionStatus = typeof AgentExecutionStatusSchema.Type;
export type ChatSessionSpec = typeof ChatSessionSpecSchema.Type;
export type ProjectTaskSpec = typeof ProjectTaskSpecSchema.Type;
export type AgentExecutionSpec = typeof AgentExecutionSpecSchema.Type;
export type AgentToolLifecycleEvent = typeof AgentToolLifecycleEventSchema.Type;
export type AgentExecutionLifecycleEvent = typeof AgentExecutionLifecycleEventSchema.Type;
export type AgentTurnRecord = typeof AgentTurnRecordSchema.Type;
export type AgentAttemptRecord = typeof AgentAttemptRecordSchema.Type;
export type AgentChildRunRecord = typeof AgentChildRunRecordSchema.Type;
export type AgentToolCallRecord = typeof AgentToolCallRecordSchema.Type;
