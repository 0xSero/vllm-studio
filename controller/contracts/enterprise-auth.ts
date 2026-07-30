import { Schema } from "effect";

export const EnterpriseRoleSchema = Schema.Literals([
  "viewer",
  "scientist",
  "operator",
  "agent_admin",
  "platform_admin",
]);
export type EnterpriseRole = typeof EnterpriseRoleSchema.Type;

export const ClearanceSchema = Schema.Literals(["open", "internal", "C1", "C2"]);
export type Clearance = typeof ClearanceSchema.Type;

export const EnterpriseEntitlementSchema = Schema.Literals([
  "notebook:read",
  "notebook:execute",
  "ray:admit",
  "model:invoke",
  "agent:invoke",
  "configuration:write",
  "audit:read",
]);
export type EnterpriseEntitlement = typeof EnterpriseEntitlementSchema.Type;

export const OidcIssuerConfigSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["entra", "keycloak"]),
  issuer: Schema.String,
  client_id: Schema.String,
  audience: Schema.String,
  id_token_signing_algorithm: Schema.optional(Schema.Literals(["RS256", "PS256", "ES256"])),
  scopes: Schema.Array(Schema.String),
  tenant: Schema.optional(Schema.String),
  realm: Schema.optional(Schema.String),
  logout_endpoint: Schema.optional(Schema.String),
  backchannel_logout: Schema.optional(
    Schema.Struct({
      enabled: Schema.Boolean,
      session_required: Schema.Boolean,
    }),
  ),
  role_claim: Schema.String,
  group_claim: Schema.String,
  role_mappings: Schema.Record(Schema.String, Schema.Array(EnterpriseRoleSchema)),
  clearance_mappings: Schema.Record(Schema.String, ClearanceSchema),
});
export type OidcIssuerConfig = typeof OidcIssuerConfigSchema.Type;

export const EnterpriseAuthConfigSchema = Schema.Struct({
  mode: Schema.Literals(["local", "optional_oidc", "required_oidc"]),
  issuers: Schema.Array(OidcIssuerConfigSchema),
  session_idle_seconds: Schema.Number,
  session_absolute_seconds: Schema.Number,
});
export type EnterpriseAuthConfig = typeof EnterpriseAuthConfigSchema.Type;

export const NormalizedPrincipalSchema = Schema.Struct({
  subject: Schema.String,
  issuer: Schema.String,
  issuer_id: Schema.String,
  tenant: Schema.String,
  display_name: Schema.String,
  email: Schema.optional(Schema.String),
  roles: Schema.Array(EnterpriseRoleSchema),
  entitlements: Schema.Array(EnterpriseEntitlementSchema),
  clearance: ClearanceSchema,
  issued_at: Schema.Number,
  expires_at: Schema.Number,
});
export type NormalizedPrincipal = typeof NormalizedPrincipalSchema.Type;

export const EnterprisePrincipalScopeSchema = Schema.Struct({
  subject: Schema.String,
  issuer: Schema.String,
  issuer_id: Schema.String,
  tenant: Schema.String,
  clearance: ClearanceSchema,
});
export type EnterprisePrincipalScope = typeof EnterprisePrincipalScopeSchema.Type;

export const ProviderAuthenticationSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("none"),
  }),
  Schema.Struct({
    type: Schema.Literal("api_key"),
    secret_ref: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("oidc_user"),
    issuer_id: Schema.String,
    audience: Schema.String,
    scopes: Schema.Array(Schema.String),
    token_exchange: Schema.optional(
      Schema.Struct({
        mode: Schema.Literals(["rfc8693", "entra_obo"]),
        token_endpoint: Schema.String,
        client_id: Schema.String,
        client_secret_ref: Schema.optional(Schema.String),
      }),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("managed_identity"),
    resource: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("apim_gateway"),
    issuer_id: Schema.String,
    audience: Schema.String,
    scopes: Schema.Array(Schema.String),
    token_exchange: Schema.optional(
      Schema.Struct({
        mode: Schema.Literals(["rfc8693", "entra_obo"]),
        token_endpoint: Schema.String,
        client_id: Schema.String,
        client_secret_ref: Schema.optional(Schema.String),
      }),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("apim_client"),
    issuer_id: Schema.String,
    audience: Schema.String,
    scopes: Schema.Array(Schema.String),
    token_endpoint: Schema.String,
    client_id: Schema.String,
    client_secret_ref: Schema.optional(Schema.String),
  }),
]);
export type ProviderAuthentication = typeof ProviderAuthenticationSchema.Type;

export const FoundryProjectConnectionSchema = Schema.Struct({
  provider_id: Schema.String,
  gateway_url: Schema.String,
  project_endpoint: Schema.String,
  project_name: Schema.String,
  allowed_models: Schema.Array(Schema.String),
  allowed_agents: Schema.Array(Schema.String),
  authentication: ProviderAuthenticationSchema,
});
export type FoundryProjectConnection = typeof FoundryProjectConnectionSchema.Type;

const ROLE_ENTITLEMENTS: Record<EnterpriseRole, EnterpriseEntitlement[]> = {
  viewer: ["notebook:read"],
  scientist: ["notebook:read", "notebook:execute", "ray:admit", "model:invoke", "agent:invoke"],
  operator: ["notebook:read", "notebook:execute", "model:invoke", "audit:read"],
  agent_admin: ["notebook:read", "model:invoke", "agent:invoke", "configuration:write"],
  platform_admin: [
    "notebook:read",
    "notebook:execute",
    "ray:admit",
    "model:invoke",
    "agent:invoke",
    "configuration:write",
    "audit:read",
  ],
};

export const entitlementsForRoles = (roles: readonly EnterpriseRole[]): EnterpriseEntitlement[] => [
  ...new Set(roles.flatMap((role) => ROLE_ENTITLEMENTS[role])),
];
