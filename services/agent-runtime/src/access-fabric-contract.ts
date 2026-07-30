import { Schema } from "effect";

export const AccessFabricPortSchema = Schema.Number;

export const AccessFabricProfileSchema = Schema.Struct({
  version: Schema.Literal(1),
  profileId: Schema.optional(Schema.String),
  classification: Schema.Literal("C2"),
  machine: Schema.Struct({
    id: Schema.String,
    sshTarget: Schema.String,
  }),
  netbird: Schema.Struct({
    enabled: Schema.Boolean,
    managementUrl: Schema.String,
    sourceGroupId: Schema.String,
    machineGroupId: Schema.String,
    peerId: Schema.optional(Schema.String),
    ports: Schema.Array(AccessFabricPortSchema),
    credentialRef: Schema.Literal("vault:access:netbird"),
  }),
  boundary: Schema.Struct({
    enabled: Schema.Boolean,
    controllerUrl: Schema.String,
    scopeId: Schema.String,
    targetIds: Schema.Array(Schema.String),
    sessionMaxSeconds: Schema.Number,
    credentialRef: Schema.Literal("vault:access:boundary"),
  }),
  updatedAt: Schema.String,
});

export const AccessFabricProbeSchema = Schema.Struct({
  target: Schema.Union([Schema.Literal("netbird"), Schema.Literal("boundary")]),
  ok: Schema.Boolean,
  status: Schema.String,
  checkedAt: Schema.String,
  profileDigest: Schema.String,
  policySafe: Schema.Boolean,
});

export const AccessFabricPlanSchema = Schema.Struct({
  digest: Schema.String,
  profileDigest: Schema.String,
  operations: Schema.Array(Schema.String),
  requiredProbes: Schema.Array(Schema.String),
});

export const AccessFabricOwnedResourceSchema = Schema.Struct({
  provider: Schema.Union([Schema.Literal("netbird"), Schema.Literal("boundary")]),
  kind: Schema.String,
  id: Schema.String,
  owner: Schema.String,
  lifecycle: Schema.Union([Schema.Literal("created"), Schema.Literal("reference")]),
});

export const AccessFabricReceiptSchema = Schema.Struct({
  id: Schema.String,
  owner: Schema.String,
  profileDigest: Schema.String,
  planDigest: Schema.String,
  appliedAt: Schema.String,
  resources: Schema.Array(AccessFabricOwnedResourceSchema),
});

export const AccessFabricRecoverySchema = Schema.Struct({
  operation: Schema.Union([Schema.Literal("apply"), Schema.Literal("offboard")]),
  failedAt: Schema.String,
  failures: Schema.Array(Schema.String),
});

export const AccessFabricStateSchema = Schema.Struct({
  profile: AccessFabricProfileSchema,
  probes: Schema.Array(AccessFabricProbeSchema),
  plan: Schema.NullOr(AccessFabricPlanSchema),
  receipt: Schema.NullOr(AccessFabricReceiptSchema),
  recovery: Schema.NullOr(AccessFabricRecoverySchema),
});

export const AccessFabricSaveSchema = Schema.Struct({
  profile: AccessFabricProfileSchema,
  credentials: Schema.optional(
    Schema.Array(
      Schema.Struct({
        ref: Schema.Union([
          Schema.Literal("vault:access:netbird"),
          Schema.Literal("vault:access:boundary"),
        ]),
        value: Schema.String,
      }),
    ),
  ),
});

export const AccessFabricProbeInputSchema = Schema.Struct({
  target: Schema.Union([Schema.Literal("netbird"), Schema.Literal("boundary")]),
});

export const AccessFabricCancelSessionSchema = Schema.Struct({
  sessionId: Schema.String,
});

export type AccessFabricProfile = typeof AccessFabricProfileSchema.Type;
export type AccessFabricProbe = typeof AccessFabricProbeSchema.Type;
export type AccessFabricPlan = typeof AccessFabricPlanSchema.Type;
export type AccessFabricOwnedResource = typeof AccessFabricOwnedResourceSchema.Type;
export type AccessFabricReceipt = typeof AccessFabricReceiptSchema.Type;
export type AccessFabricState = typeof AccessFabricStateSchema.Type;
export type AccessFabricSave = typeof AccessFabricSaveSchema.Type;
