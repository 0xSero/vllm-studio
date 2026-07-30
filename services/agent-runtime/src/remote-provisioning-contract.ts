import { createHash } from "node:crypto";
import { Schema } from "effect";

export const RemoteAccessSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("direct-ssh"),
    sshTarget: Schema.String,
    knownHostsPath: Schema.String,
    hostKeyAlias: Schema.String,
    credentialRef: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("boundary"),
    controllerUrl: Schema.String,
    scopeId: Schema.String,
    targetId: Schema.String,
    knownHostsPath: Schema.String,
    hostKeyAlias: Schema.String,
    credentialRef: Schema.String,
  }),
]);

export const RemoteAgentConfigSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.Union([
    Schema.Literal("pi"),
    Schema.Literal("opencode"),
    Schema.Literal("droid"),
    Schema.Literal("hermes"),
    Schema.Literal("omp"),
  ]),
  configPath: Schema.String,
  content: Schema.String,
  credentialRefs: Schema.Array(Schema.String),
});

export const RemoteProvisioningProfileSchema = Schema.Struct({
  version: Schema.Literal(1),
  classification: Schema.Literal("C2"),
  machineId: Schema.String,
  accessProfileId: Schema.String,
  applianceId: Schema.Literal("cortaix-factory"),
  access: RemoteAccessSchema,
  release: Schema.Struct({
    root: Schema.String,
    id: Schema.String,
    manifest: Schema.String,
    checksum: Schema.String,
    services: Schema.Array(Schema.String),
  }),
  agentRoot: Schema.String,
  netbird: Schema.NullOr(
    Schema.Struct({
      managementUrl: Schema.String,
      machineGroupId: Schema.String,
      credentialRef: Schema.String,
      peerId: Schema.optional(Schema.String),
    }),
  ),
  inference: Schema.Struct({
    baseUrl: Schema.String,
    modelId: Schema.String,
    credentialRef: Schema.String,
  }),
  agents: Schema.Array(RemoteAgentConfigSchema),
});

export const RemoteOwnedResourceSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("boundary-session"),
    id: Schema.String,
    ownership: Schema.Literal("created"),
  }),
  Schema.Struct({
    kind: Schema.Literal("netbird-setup-key"),
    id: Schema.String,
    ownership: Schema.Literal("created"),
  }),
  Schema.Struct({
    kind: Schema.Literal("netbird-peer"),
    id: Schema.String,
    ownership: Schema.Literal("created"),
  }),
  Schema.Struct({
    kind: Schema.Literal("release"),
    id: Schema.String,
    path: Schema.String,
    previousRelease: Schema.NullOr(Schema.String),
    ownership: Schema.Literal("created"),
  }),
  Schema.Struct({
    kind: Schema.Literal("agent-config"),
    id: Schema.String,
    path: Schema.String,
    backupRef: Schema.optional(Schema.String),
    beforeDigest: Schema.optional(Schema.String),
    afterDigest: Schema.String,
    ownership: Schema.Union([Schema.Literal("created"), Schema.Literal("updated")]),
  }),
]);

export const RemoteProvisioningReceiptSchema = Schema.Struct({
  id: Schema.String,
  profileDigest: Schema.String,
  appliedAt: Schema.String,
  boundarySessionId: Schema.optional(Schema.String),
  resources: Schema.Array(RemoteOwnedResourceSchema),
  releaseDigest: Schema.String,
  observedModels: Schema.Array(Schema.String),
  inferenceFingerprint: Schema.String,
});

export const RemoteProvisioningRecoverySchema = Schema.Struct({
  id: Schema.String,
  operation: Schema.Union([Schema.Literal("apply"), Schema.Literal("offboard")]),
  profileDigest: Schema.String,
  failedAt: Schema.String,
  pending: Schema.Array(RemoteOwnedResourceSchema),
  failures: Schema.Array(Schema.String),
});

export const RemoteProvisioningStateSchema = Schema.Struct({
  version: Schema.Literal(1),
  profile: Schema.NullOr(RemoteProvisioningProfileSchema),
  receipt: Schema.NullOr(RemoteProvisioningReceiptSchema),
  recovery: Schema.NullOr(RemoteProvisioningRecoverySchema),
  updatedAt: Schema.String,
});

export type RemoteAccess = typeof RemoteAccessSchema.Type;
export type RemoteAgentConfig = typeof RemoteAgentConfigSchema.Type;
export type RemoteProvisioningProfile = typeof RemoteProvisioningProfileSchema.Type;
export type RemoteOwnedResource = typeof RemoteOwnedResourceSchema.Type;
export type RemoteProvisioningReceipt = typeof RemoteProvisioningReceiptSchema.Type;
export type RemoteProvisioningRecovery = typeof RemoteProvisioningRecoverySchema.Type;
export type RemoteProvisioningState = typeof RemoteProvisioningStateSchema.Type;

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export const remoteProvisioningProfileDigest = (profile: RemoteProvisioningProfile): string =>
  `sha256:${createHash("sha256").update(canonical(profile)).digest("hex")}`;
