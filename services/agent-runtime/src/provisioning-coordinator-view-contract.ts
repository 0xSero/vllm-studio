import { Schema } from "effect";

const Digest = Schema.String;
const Reference = Schema.String;

export const ProvisioningTargetSchema = Schema.Struct({
  id: Reference,
  machineId: Reference,
  accessProfileId: Reference,
  desiredDigest: Digest,
});

export const ProvisioningProfileSchema = Schema.Struct({
  version: Schema.Literal(1),
  classification: Schema.Literal("C2"),
  applianceId: Schema.Literal("cortaix-factory"),
  machine: Schema.Struct({
    id: Reference,
    locality: Schema.Literals(["local", "remote"] as const),
    planDigest: Digest,
    accessRefIds: Schema.Array(Reference),
    agentRefIds: Schema.Array(Reference),
  }),
  access: Schema.Struct({
    locality: Schema.optional(Schema.Literals(["local", "remote"] as const)),
    profileId: Reference,
    machineId: Reference,
    profileDigest: Digest,
    planDigest: Digest,
  }),
  agents: Schema.Struct({
    locality: Schema.optional(Schema.Literals(["local", "remote"] as const)),
    profileDigest: Digest,
    targets: Schema.Array(ProvisioningTargetSchema),
  }),
});

export const MachineBindingSchema = Schema.Struct({
  receiptId: Reference,
  machineId: Reference,
  planDigest: Digest,
});
export const AccessBindingSchema = Schema.Struct({
  receiptId: Reference,
  profileId: Reference,
  machineId: Reference,
  profileDigest: Digest,
  planDigest: Digest,
});
export const AgentBindingSchema = Schema.Struct({
  receiptId: Reference,
  profileDigest: Digest,
  targets: Schema.Array(ProvisioningTargetSchema),
});
export const ProvisioningPhaseSchema = Schema.Literals([
  "idle",
  "machine_pending",
  "access_pending",
  "agent_pending",
  "active",
  "agent_offboard_pending",
  "access_offboard_pending",
  "machine_offboard_pending",
  "recovery_required",
  "revoked",
] as const);
export const RecoveryStepSchema = Schema.Struct({
  participant: Schema.Literals(["machine", "access", "agents"] as const),
  action: Schema.Literals(["recover", "offboard"] as const),
});
export const ProvisioningReceiptSchema = Schema.Struct({
  id: Reference,
  profileDigest: Digest,
  status: Schema.Literals(["active", "revoked"] as const),
  machine: MachineBindingSchema,
  access: AccessBindingSchema,
  agents: AgentBindingSchema,
  appliedAt: Schema.String,
  reconciledAt: Schema.NullOr(Schema.String),
  revokedAt: Schema.NullOr(Schema.String),
});
export const ProvisioningStateSchema = Schema.Struct({
  version: Schema.Literal(1),
  operationId: Schema.NullOr(Reference),
  profile: Schema.NullOr(ProvisioningProfileSchema),
  profileDigest: Schema.NullOr(Digest),
  phase: ProvisioningPhaseSchema,
  bindings: Schema.Struct({
    machine: Schema.NullOr(MachineBindingSchema),
    access: Schema.NullOr(AccessBindingSchema),
    agents: Schema.NullOr(AgentBindingSchema),
  }),
  receipt: Schema.NullOr(ProvisioningReceiptSchema),
  recovery: Schema.NullOr(
    Schema.Struct({
      id: Reference,
      operation: Schema.Literals(["setup", "offboard"] as const),
      failedPhase: ProvisioningPhaseSchema,
      failedAt: Schema.String,
      failures: Schema.Array(Schema.String),
      pending: Schema.Array(RecoveryStepSchema),
    }),
  ),
  updatedAt: Schema.String,
});

export type ProvisioningProfile = typeof ProvisioningProfileSchema.Type;
export type ProvisioningMachineSpec = ProvisioningProfile["machine"];
export type ProvisioningAccessSpec = ProvisioningProfile["access"];
export type ProvisioningAgentSpec = ProvisioningProfile["agents"];
export type ProvisioningTarget = typeof ProvisioningTargetSchema.Type;
export type MachineBinding = typeof MachineBindingSchema.Type;
export type AccessBinding = typeof AccessBindingSchema.Type;
export type AgentBinding = typeof AgentBindingSchema.Type;
export type RecoveryStep = typeof RecoveryStepSchema.Type;
export type ProvisioningState = typeof ProvisioningStateSchema.Type;
