import { Schema } from "effect";

export const AgentTargetIdSchema = Schema.Union([
  Schema.Literal("pi"),
  Schema.Literal("opencode"),
  Schema.Literal("droid"),
  Schema.Literal("hermes"),
  Schema.Literal("omp"),
]);

export const AgentExecutionModeSchema = Schema.Union([
  Schema.Literal("local"),
  Schema.Literal("remote-ssh"),
]);

export const AgentCapabilitySchema = Schema.Union([
  Schema.Literal("config.read"),
  Schema.Literal("config.write"),
  Schema.Literal("config.restore"),
  Schema.Literal("inference.invoke"),
]);

export const AgentExecutionTargetSchema = Schema.Struct({
  id: Schema.String,
  agentId: AgentTargetIdSchema,
  machineId: Schema.String,
  accessProfileId: Schema.String,
  mode: AgentExecutionModeSchema,
  executionHome: Schema.String,
  inferenceEndpoint: Schema.String,
  credentialRef: Schema.String,
  modelId: Schema.String,
  contextWindow: Schema.Number,
  capabilities: Schema.Array(AgentCapabilitySchema),
});

export const AgentLifecycleProfileSchema = Schema.Struct({
  version: Schema.Literal(2),
  classification: Schema.Literal("C2"),
  targets: Schema.Array(AgentExecutionTargetSchema),
  updatedAt: Schema.String,
});

export const AgentConfigMutationSchema = Schema.Struct({
  path: Schema.String,
  operation: Schema.Union([Schema.Literal("created"), Schema.Literal("updated")]),
  backupRef: Schema.optional(Schema.String),
  beforeDigest: Schema.optional(Schema.String),
  afterDigest: Schema.String,
});

export const AgentTargetReceiptSchema = Schema.Struct({
  targetId: Schema.String,
  machineId: Schema.String,
  accessProfileId: Schema.String,
  desiredDigest: Schema.String,
  status: Schema.Union([Schema.Literal("applied"), Schema.Literal("unchanged")]),
  mutations: Schema.Array(AgentConfigMutationSchema),
});

export const AgentLifecycleReceiptSchema = Schema.Struct({
  id: Schema.String,
  profileDigest: Schema.String,
  appliedAt: Schema.String,
  targets: Schema.Array(AgentTargetReceiptSchema),
});

export const AgentLifecycleRecoverySchema = Schema.Struct({
  id: Schema.String,
  operation: Schema.Union([Schema.Literal("apply"), Schema.Literal("revoke")]),
  profileDigest: Schema.String,
  failedAt: Schema.String,
  pending: Schema.Array(AgentTargetReceiptSchema),
  failures: Schema.Array(Schema.String),
});

export type AgentTargetId = typeof AgentTargetIdSchema.Type;
export type AgentCapability = typeof AgentCapabilitySchema.Type;
export type AgentExecutionTarget = typeof AgentExecutionTargetSchema.Type;
export type AgentLifecycleProfile = typeof AgentLifecycleProfileSchema.Type;
export type AgentConfigMutation = typeof AgentConfigMutationSchema.Type;
export type AgentTargetReceipt = typeof AgentTargetReceiptSchema.Type;
export type AgentLifecycleReceipt = typeof AgentLifecycleReceiptSchema.Type;
export type AgentLifecycleRecovery = typeof AgentLifecycleRecoverySchema.Type;
