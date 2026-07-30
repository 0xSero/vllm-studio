import { Schema } from "effect";

export const MachineLifecycleStates = [
  "draft",
  "probed",
  "admitted",
  "configured",
  "active",
  "draining",
  "revoked",
  "failed",
] as const;

export const MachineLifecycleStateSchema = Schema.Literals(MachineLifecycleStates);
export type MachineLifecycleState = typeof MachineLifecycleStateSchema.Type;

export const MachineLocalitySchema = Schema.Literals(["local", "remote"] as const);
export type MachineLocality = typeof MachineLocalitySchema.Type;

export const MachineAccessKindSchema = Schema.Literals([
  "ssh",
  "netbird",
  "boundary",
] as const);
export type MachineAccessKind = typeof MachineAccessKindSchema.Type;

export const MachineReferenceSchema = Schema.Struct({
  id: Schema.String,
});
export type MachineReference = typeof MachineReferenceSchema.Type;

export const MachineAccessReferenceSchema = Schema.Struct({
  id: Schema.String,
  kind: MachineAccessKindSchema,
  endpoint: Schema.String,
  credential_ref: Schema.optional(Schema.String),
});
export type MachineAccessReference = typeof MachineAccessReferenceSchema.Type;

export const MachineEnrollmentProfileSchema = Schema.Struct({
  machine_id: Schema.String,
  display_name: Schema.String,
  locality: MachineLocalitySchema,
  appliance_id: Schema.String,
  classification: Schema.Literal("C2"),
  rig_id: Schema.optional(Schema.String),
  rig_node_id: Schema.optional(Schema.String),
  runtime_refs: Schema.Array(MachineReferenceSchema),
  access_refs: Schema.Array(MachineAccessReferenceSchema),
  agent_refs: Schema.Array(MachineReferenceSchema),
});
export type MachineEnrollmentProfile = typeof MachineEnrollmentProfileSchema.Type;

export const MachineOwnedResourceSchema = Schema.Struct({
  resource_id: Schema.String,
  kind: Schema.String,
  external_ref: Schema.String,
  ownership: Schema.Literal("local-studio"),
  apply_action: Schema.Literals(["create", "update"] as const),
  rollback_action: Schema.Literals(["remove", "restore"] as const),
  previous_digest: Schema.optional(Schema.String),
});
export type MachineOwnedResource = typeof MachineOwnedResourceSchema.Type;

export const MachineRollbackEntrySchema = Schema.Struct({
  resource_id: Schema.String,
  status: Schema.Literals(["pending", "rolled_back", "failed"] as const),
  attempted_at: Schema.optional(Schema.String),
});
export type MachineRollbackEntry = typeof MachineRollbackEntrySchema.Type;

export const MachineLifecycleEventSchema = Schema.Struct({
  from: MachineLifecycleStateSchema,
  to: MachineLifecycleStateSchema,
  at: Schema.String,
  reason: Schema.String,
});
export type MachineLifecycleEvent = typeof MachineLifecycleEventSchema.Type;

export const MachineEnrollmentReceiptSchema = Schema.Struct({
  receipt_id: Schema.String,
  machine_id: Schema.String,
  plan_digest: Schema.String,
  applied_at: Schema.String,
  classification: Schema.Literal("C2"),
  owned_resources: Schema.Array(MachineOwnedResourceSchema),
  rollback_journal: Schema.Array(MachineRollbackEntrySchema),
});
export type MachineEnrollmentReceipt = typeof MachineEnrollmentReceiptSchema.Type;

export const MachineEnrollmentRecordSchema = Schema.Struct({
  profile: MachineEnrollmentProfileSchema,
  state: MachineLifecycleStateSchema,
  plan_digest: Schema.String,
  created_at: Schema.String,
  updated_at: Schema.String,
  events: Schema.Array(MachineLifecycleEventSchema),
  receipt: Schema.NullOr(MachineEnrollmentReceiptSchema),
  recovery_required: Schema.Boolean,
});
export type MachineEnrollmentRecord = typeof MachineEnrollmentRecordSchema.Type;

export const MachineEnrollmentFileSchema = Schema.Struct({
  version: Schema.Literal(1),
  machines: Schema.Array(MachineEnrollmentRecordSchema),
});
export type MachineEnrollmentFile = typeof MachineEnrollmentFileSchema.Type;
