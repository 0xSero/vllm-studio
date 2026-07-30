import { Schema } from "effect";

export const TensorPrimeServiceKindSchema = Schema.Literals([
  "ray-client",
  "ray-dashboard",
  "ray-serve",
  "vllm",
  "litellm",
  "embedding-http",
  "embedding-grpc",
  "asr",
  "unified-api",
]);
export type TensorPrimeServiceKind = typeof TensorPrimeServiceKindSchema.Type;

export const TensorPrimeEndpointScopeSchema = Schema.Literals(["in-cluster", "external"]);
export type TensorPrimeEndpointScope = typeof TensorPrimeEndpointScopeSchema.Type;

export const TensorPrimeProtocolSchema = Schema.Literals(["http", "grpc"]);
export type TensorPrimeProtocol = typeof TensorPrimeProtocolSchema.Type;

export const TensorPrimeServiceEndpointSchema = Schema.Struct({
  id: Schema.String,
  kind: TensorPrimeServiceKindSchema,
  scope: TensorPrimeEndpointScopeSchema,
  protocol: TensorPrimeProtocolSchema,
  url: Schema.String,
  host_header: Schema.NullOr(Schema.String),
  openai_compatible: Schema.Boolean,
  transport_security: Schema.Literal("plaintext"),
  server_mtls_enforced: Schema.Literal(false),
});
export type TensorPrimeServiceEndpoint = typeof TensorPrimeServiceEndpointSchema.Type;

export const TensorPrimeWorkloadIdentitySchema = Schema.Struct({
  component: Schema.Literals(["frontend", "controller", "agent-runtime"]),
  namespace: Schema.String,
  service_account: Schema.String,
  spiffe_id: Schema.String,
});
export type TensorPrimeWorkloadIdentity = typeof TensorPrimeWorkloadIdentitySchema.Type;

export const TensorPrimeConnectionProfileSchema = Schema.Struct({
  version: Schema.Literal(1),
  id: Schema.String,
  phase: Schema.Literal("phase0"),
  trust_domain: Schema.String,
  spiffe_id_template: Schema.String,
  workload_api: Schema.Struct({
    csi_driver: Schema.Literal("csi.spiffe.io"),
    mount_path: Schema.String,
    socket_path: Schema.String,
    endpoint: Schema.String,
  }),
  x509_svid: Schema.Struct({
    ttl_seconds: Schema.Number,
    rotation: Schema.Literal("workload-api-stream"),
    persistence: Schema.Literal("memory-only"),
  }),
  capabilities: Schema.Struct({
    svid_issuance: Schema.Literal("available"),
    svid_rotation: Schema.Literal("available"),
    service_mtls_enforcement: Schema.Literal("not-configured"),
    ray_tls: Schema.Literal("not-configured"),
  }),
  identities: Schema.Array(TensorPrimeWorkloadIdentitySchema),
  services: Schema.Array(TensorPrimeServiceEndpointSchema),
});
export type TensorPrimeConnectionProfile = typeof TensorPrimeConnectionProfileSchema.Type;

export const TensorPrimeSvidReadinessEvidenceSchema = Schema.Struct({
  state: Schema.Literals(["claimed", "observed", "contradicted"]),
  checked_at: Schema.String,
  expected_spiffe_id: Schema.String,
  observed_spiffe_id: Schema.NullOr(Schema.String),
  workload_api_endpoint: Schema.String,
  x509_svid_expires_at: Schema.NullOr(Schema.String),
  rotation_generation: Schema.Number,
  svid_available: Schema.Boolean,
  rotation_observed: Schema.Boolean,
  service_mtls_enforced: Schema.Literal(false),
  ray_tls_configured: Schema.Literal(false),
  detail: Schema.String,
});
export type TensorPrimeSvidReadinessEvidence = typeof TensorPrimeSvidReadinessEvidenceSchema.Type;
