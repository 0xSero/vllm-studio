import { Schema } from "effect";
import { TensorPrimeServiceKindSchema } from "./tensorprime";

export const SetupEvidenceStateSchema = Schema.Literals([
  "claimed",
  "observed",
  "attested",
  "contradicted",
]);
export type SetupEvidenceState = typeof SetupEvidenceStateSchema.Type;

export const SetupConnectionProbeSchema = Schema.Struct({
  state: SetupEvidenceStateSchema,
  checked_at: Schema.NullOr(Schema.String),
  status: Schema.NullOr(Schema.Number),
  detail: Schema.String,
});
export type SetupConnectionProbe = typeof SetupConnectionProbeSchema.Type;

export const SetupOidcConnectionSchema = Schema.Struct({
  enabled: Schema.Boolean,
  kind: Schema.Literals(["entra", "keycloak"]),
  issuer: Schema.String,
  client_id: Schema.String,
  audience: Schema.String,
  tenant_or_realm: Schema.String,
  probe: SetupConnectionProbeSchema,
});
export type SetupOidcConnection = typeof SetupOidcConnectionSchema.Type;

export const SetupRemoteServiceSchema = Schema.Struct({
  id: Schema.Literals(["api", "embed", "audio", "ray"]),
  label: Schema.String,
  kind: TensorPrimeServiceKindSchema,
  catalog_service_id: Schema.NullOr(Schema.String),
  enabled: Schema.Boolean,
  base_url: Schema.String,
  host_header: Schema.String,
  probe_path: Schema.String,
  probe: SetupConnectionProbeSchema,
});
export type SetupRemoteService = typeof SetupRemoteServiceSchema.Type;

export const SetupCommissioningRequirementsSchema = Schema.Struct({
  controller_credential: Schema.Boolean,
  oidc: Schema.Boolean,
  kubernetes: Schema.Boolean,
  tensorprime: Schema.Boolean,
  agents: Schema.Boolean,
  workload_svid: Schema.Boolean,
});
export type SetupCommissioningRequirements = typeof SetupCommissioningRequirementsSchema.Type;

export const SetupSpiffePhaseSchema = Schema.Struct({
  trust_domain: Schema.String,
  identity_plane: SetupEvidenceStateSchema,
  workload_svid: SetupEvidenceStateSchema,
  service_mtls: Schema.Literals(["not_enforced", "observed", "contradicted"]),
  detail: Schema.String,
});
export type SetupSpiffePhase = typeof SetupSpiffePhaseSchema.Type;

export const SetupCommissioningProfileSchema = Schema.Struct({
  version: Schema.Literal(1),
  revision: Schema.Number,
  classification: Schema.Literal("C2"),
  updated_at: Schema.String,
  requirements: SetupCommissioningRequirementsSchema,
  oidc: SetupOidcConnectionSchema,
  tensorprime_probes: Schema.Array(SetupRemoteServiceSchema),
  spiffe: SetupSpiffePhaseSchema,
});
export type SetupCommissioningProfile = typeof SetupCommissioningProfileSchema.Type;

export const SetupCommissioningSaveSchema = Schema.Struct({
  revision: Schema.Number,
  requirements: SetupCommissioningRequirementsSchema,
  oidc: Schema.Struct({
    enabled: Schema.Boolean,
    kind: Schema.Literals(["entra", "keycloak"]),
    issuer: Schema.String,
    client_id: Schema.String,
    audience: Schema.String,
    tenant_or_realm: Schema.String,
  }),
  tensorprime_probes: Schema.Array(
    Schema.Struct({
      id: Schema.Literals(["api", "embed", "audio", "ray"]),
      label: Schema.String,
      kind: TensorPrimeServiceKindSchema,
      catalog_service_id: Schema.NullOr(Schema.String),
      enabled: Schema.Boolean,
      base_url: Schema.String,
      host_header: Schema.String,
      probe_path: Schema.String,
    }),
  ),
});
export type SetupCommissioningSave = typeof SetupCommissioningSaveSchema.Type;

export const SetupCommissioningProbeInputSchema = Schema.Struct({
  target: Schema.Union([
    Schema.Literal("oidc"),
    Schema.Literal("api"),
    Schema.Literal("embed"),
    Schema.Literal("audio"),
    Schema.Literal("ray"),
  ]),
});
export type SetupCommissioningProbeInput = typeof SetupCommissioningProbeInputSchema.Type;
