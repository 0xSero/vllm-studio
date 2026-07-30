import { Schema } from "effect";

export const WorkloadIdentityModeSchema = Schema.Literals(["disabled", "optional", "required"]);
export type WorkloadIdentityMode = typeof WorkloadIdentityModeSchema.Type;

export const WorkloadIdentityConfigSchema = Schema.Struct({
  mode: WorkloadIdentityModeSchema,
  x509_mtls: Schema.optional(WorkloadIdentityModeSchema),
  endpoint: Schema.String,
  trust_domain: Schema.String,
  frontend_id: Schema.String,
  controller_id: Schema.String,
  agent_runtime_id: Schema.String,
  agent_runtime_audience: Schema.String,
  controller_audience: Schema.String,
});
export type WorkloadIdentityConfig = typeof WorkloadIdentityConfigSchema.Type;

export const ControllerWorkloadProbeSchema = Schema.Struct({
  configured: Schema.Boolean,
  observed: Schema.Boolean,
  source: Schema.optional(Schema.String),
  destination: Schema.optional(Schema.String),
  jwt_svid: Schema.optional(Schema.Boolean),
  x509_mtls: Schema.optional(Schema.Boolean),
});
export type ControllerWorkloadProbe = typeof ControllerWorkloadProbeSchema.Type;

export const WorkloadIdentityEvidenceSchema = Schema.Struct({
  configured: Schema.Boolean,
  required: Schema.Boolean,
  state: Schema.Literals(["unconfigured", "claimed", "observed", "contradicted"]),
  spiffe_id: Schema.NullOr(Schema.String),
  trust_domain: Schema.NullOr(Schema.String),
  audience: Schema.NullOr(Schema.String),
  expires_at: Schema.NullOr(Schema.Number),
  checked_at: Schema.NullOr(Schema.String),
  jwt_svid_validated: Schema.Boolean,
  x509_mtls: Schema.Literals(["disabled", "not_verified", "observed", "contradicted"]),
  x509_svid_expires_at: Schema.optional(Schema.NullOr(Schema.String)),
  x509_svid_serial: Schema.optional(Schema.NullOr(Schema.String)),
  rotation_generation: Schema.optional(Schema.Number),
  hops: Schema.optional(
    Schema.Array(
      Schema.Struct({
        source: Schema.String,
        destination: Schema.String,
        jwt_svid: Schema.Boolean,
        x509_mtls: Schema.Boolean,
        peer_id: Schema.NullOr(Schema.String),
      }),
    ),
  ),
  detail: Schema.String,
});
export type WorkloadIdentityEvidence = typeof WorkloadIdentityEvidenceSchema.Type;
