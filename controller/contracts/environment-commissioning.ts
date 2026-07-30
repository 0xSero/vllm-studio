import { Schema } from "effect";

export const KubernetesConnectionConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  api_url: Schema.String,
  token_file: Schema.String,
  ca_file: Schema.NullOr(Schema.String),
});
export type KubernetesConnectionConfig = typeof KubernetesConnectionConfigSchema.Type;

export const KubernetesConnectionProbeSchema = Schema.Struct({
  state: Schema.Literals(["unconfigured", "claimed", "observed", "contradicted"]),
  checked_at: Schema.NullOr(Schema.String),
  kubernetes_version: Schema.NullOr(Schema.String),
  ray_api_version: Schema.NullOr(Schema.String),
  detail: Schema.String,
});
export type KubernetesConnectionProbe = typeof KubernetesConnectionProbeSchema.Type;

export const KubernetesConnectionStateSchema = Schema.Struct({
  configuration: KubernetesConnectionConfigSchema,
  probe: KubernetesConnectionProbeSchema,
});
export type KubernetesConnectionState = typeof KubernetesConnectionStateSchema.Type;
