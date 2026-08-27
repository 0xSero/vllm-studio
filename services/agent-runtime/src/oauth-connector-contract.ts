import { Schema } from "effect";

export const OAUTH_CONNECTOR_PROVIDER_IDS = ["github"] as const;
export type OAuthConnectorProviderId = (typeof OAUTH_CONNECTOR_PROVIDER_IDS)[number];

export type OAuthConnectorFlowKind = "oauth-device" | "oauth-pkce";

export type OAuthConnectorAuthDefinition = {
  kind: OAuthConnectorFlowKind;

  clientId?: string;

  clientIdEnv: string;

  authorizeUrl?: string;

  deviceUrl?: string;
  tokenUrl: string;
  scopes: readonly string[];

  tokenEnv: string;

  identityUrl: string;
  identityField: "login" | "name" | "email" | "sub";

  createClientUrl: string;

  setupHint: string;
};

export type OAuthConnectorProvider = {
  id: OAuthConnectorProviderId;
  name: string;
  auth: OAuthConnectorAuthDefinition;

  connector: { command: string; args: readonly string[] };
};

export const OAUTH_CONNECTOR_PROVIDERS = {
  github: {
    id: "github",
    name: "GitHub",
    auth: {
      kind: "oauth-device",
      clientIdEnv: "LOCAL_STUDIO_GITHUB_CLIENT_ID",
      deviceUrl: "https://github.com/login/device/code",
      tokenUrl: "https://github.com/login/oauth/access_token",
      scopes: ["repo", "read:org"],
      tokenEnv: "GITHUB_PERSONAL_ACCESS_TOKEN",
      identityUrl: "https://api.github.com/user",
      identityField: "login",
      createClientUrl:
        "https://github.com/settings/applications/new" +
        "?oauth_application[name]=Local%20Studio" +
        "&oauth_application[url]=https%3A%2F%2Fgithub.com%2F0xsero%2Fvllm-studio" +
        "&oauth_application[callback_url]=http%3A%2F%2F127.0.0.1%2Fcallback",
      setupHint:
        "Register the pre-filled OAuth app, tick “Enable Device Flow” on its settings page, " +
        "then paste its Client ID here. The Client ID is a public identifier, not a secret, " +
        "and no client secret is needed.",
    },
    connector: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github@2025.4.8"],
    },
  },
} satisfies Record<OAuthConnectorProviderId, OAuthConnectorProvider>;

export function oauthConnectorProvider(connectorId: string): OAuthConnectorProvider | null {
  switch (connectorId) {
    case "github":
      return OAUTH_CONNECTOR_PROVIDERS.github;
    default:
      return null;
  }
}

const PendingDeviceSchema = Schema.Struct({
  userCode: Schema.String,
  verificationUri: Schema.String,
  expiresAt: Schema.Number,
});

export const OAuthAuthorizeResponseSchema = Schema.Union([
  Schema.Struct({
    flow: Schema.Literal("device"),
    userCode: Schema.String,
    verificationUri: Schema.String,
    expiresAt: Schema.Number,
  }),
  Schema.Struct({
    flow: Schema.Literal("pkce"),
    authorizeUrl: Schema.String,
  }),
]);

export const OAuthStatusResponseSchema = Schema.Struct({
  connectorId: Schema.String,

  configured: Schema.Boolean,
  clientId: Schema.NullOr(Schema.String),
  connected: Schema.Boolean,
  account: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.Number),
  scopes: Schema.Array(Schema.String),

  pending: Schema.NullOr(PendingDeviceSchema),

  error: Schema.NullOr(Schema.String),
});

export const OAuthClientInputSchema = Schema.Struct({
  connectorId: Schema.String,
  clientId: Schema.String,
});

export const OAuthConnectorInputSchema = Schema.Struct({
  connectorId: Schema.String,
});

export type OAuthAuthorizeResponse = typeof OAuthAuthorizeResponseSchema.Type;
export type OAuthStatusResponse = typeof OAuthStatusResponseSchema.Type;
