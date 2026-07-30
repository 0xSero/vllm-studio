import { createHash } from "node:crypto";
import { ConfidentialClientApplication } from "@azure/msal-node";
import type { OidcIssuerConfig } from "@local-studio/contracts/enterprise-auth";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { issuerSecret } from "./enterprise-config";
import type { AuthorizationFlow } from "./enterprise-session";
import { createEnterpriseMsalCache } from "./enterprise-msal-cache";
import {
  authenticatedOidcForm,
  decodeOidcClientAuthMethods,
  type OidcClientAuthMethod,
} from "./oidc-client-auth";

type SigningAlgorithm = (typeof SUPPORTED_SIGNING_ALGORITHMS)[number];

type OidcMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
  revocation_endpoint?: string;
  backchannel_logout_supported?: boolean;
  backchannel_logout_session_supported?: boolean;
  id_token_signing_alg_values_supported: SigningAlgorithm[];
  token_endpoint_auth_methods_supported: OidcClientAuthMethod[];
  revocation_endpoint_auth_methods_supported?: OidcClientAuthMethod[];
};

export type OidcTokenResult = {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  accountId?: string;
  claims: Record<string, unknown>;
};

const metadataCache = new Map<string, Promise<OidcMetadata>>();
const entraClients = new Map<string, ConfidentialClientApplication>();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";
const SUPPORTED_SIGNING_ALGORITHMS = ["RS256", "PS256", "ES256"] as const;

const trustedIssuerUrl = (issuer: OidcIssuerConfig): URL => {
  const url = new URL(issuer.issuer);
  const loopback =
    url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" && !loopback)
  ) {
    throw new Error("OIDC issuer URL is untrusted");
  }
  return url;
};

const entraClient = (issuer: OidcIssuerConfig): ConfidentialClientApplication => {
  const clientKey = `${issuer.id}:${issuer.client_id}:${normalizedIssuer(issuer.issuer)}`;
  const existing = entraClients.get(clientKey);
  if (existing) return existing;
  trustedIssuerUrl(issuer);
  const client = new ConfidentialClientApplication({
    auth: {
      clientId: issuer.client_id,
      authority: issuer.issuer,
      clientSecret: issuerSecret(issuer.id),
    },
    cache: {
      cachePlugin: createEnterpriseMsalCache(clientKey),
    },
  });
  entraClients.set(clientKey, client);
  return client;
};

const normalizedIssuer = (value: string): string => value.replace(/\/+$/u, "");

const boundedEndpoint = (value: string, issuer: OidcIssuerConfig): string => {
  const endpoint = new URL(value);
  const trusted = trustedIssuerUrl(issuer);
  const loopback =
    endpoint.protocol === "http:" &&
    (endpoint.hostname === "127.0.0.1" || endpoint.hostname === "localhost");
  if ((endpoint.protocol !== "https:" && !loopback) || endpoint.origin !== trusted.origin) {
    throw new Error("OIDC metadata contains an untrusted endpoint");
  }
  return endpoint.toString();
};

const decodeMetadata = (value: unknown, issuer: OidcIssuerConfig): OidcMetadata => {
  if (!value || typeof value !== "object") throw new Error("OIDC discovery document is invalid");
  const document = value as Partial<OidcMetadata>;
  if (
    normalizedIssuer(document.issuer ?? "") !== normalizedIssuer(issuer.issuer) ||
    !document.authorization_endpoint ||
    !document.token_endpoint ||
    !document.jwks_uri
  ) {
    throw new Error("OIDC discovery document is incomplete or mismatched");
  }
  return {
    issuer: issuer.issuer,
    authorization_endpoint: boundedEndpoint(document.authorization_endpoint, issuer),
    token_endpoint: boundedEndpoint(document.token_endpoint, issuer),
    jwks_uri: boundedEndpoint(document.jwks_uri, issuer),
    id_token_signing_alg_values_supported: Array.isArray(
      document.id_token_signing_alg_values_supported,
    )
      ? document.id_token_signing_alg_values_supported.filter(
          (algorithm): algorithm is (typeof SUPPORTED_SIGNING_ALGORITHMS)[number] =>
            typeof algorithm === "string" &&
            SUPPORTED_SIGNING_ALGORITHMS.includes(
              algorithm as (typeof SUPPORTED_SIGNING_ALGORITHMS)[number],
            ),
        )
      : ["RS256"],
    token_endpoint_auth_methods_supported: decodeOidcClientAuthMethods(
      document.token_endpoint_auth_methods_supported,
      ["client_secret_basic"],
    ),
    ...(document.end_session_endpoint
      ? { end_session_endpoint: boundedEndpoint(document.end_session_endpoint, issuer) }
      : {}),
    ...(document.revocation_endpoint
      ? { revocation_endpoint: boundedEndpoint(document.revocation_endpoint, issuer) }
      : {}),
    ...(document.revocation_endpoint_auth_methods_supported
      ? {
          revocation_endpoint_auth_methods_supported: decodeOidcClientAuthMethods(
            document.revocation_endpoint_auth_methods_supported,
            [],
          ),
        }
      : {}),
    ...(document.backchannel_logout_supported === true
      ? { backchannel_logout_supported: true }
      : {}),
    ...(document.backchannel_logout_session_supported === true
      ? { backchannel_logout_session_supported: true }
      : {}),
  };
};

export const discoverIssuer = (issuer: OidcIssuerConfig): Promise<OidcMetadata> => {
  trustedIssuerUrl(issuer);
  const cacheKey = `${issuer.id}:${normalizedIssuer(issuer.issuer)}`;
  const existing = metadataCache.get(cacheKey);
  if (existing) return existing;
  const pending = fetch(`${issuer.issuer.replace(/\/+$/u, "")}/.well-known/openid-configuration`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`OIDC discovery returned ${response.status}`);
      return decodeMetadata(await response.json(), issuer);
    })
    .catch((error) => {
      metadataCache.delete(cacheKey);
      throw error;
    });
  metadataCache.set(cacheKey, pending);
  return pending;
};

const challengeFor = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");

const remoteJwks = (uri: string): ReturnType<typeof createRemoteJWKSet> => {
  const existing = jwksCache.get(uri);
  if (existing) return existing;
  const created = createRemoteJWKSet(new URL(uri), {
    cooldownDuration: 1_000,
    timeoutDuration: 5_000,
  });
  jwksCache.set(uri, created);
  return created;
};

const signingAlgorithm = (issuer: OidcIssuerConfig, metadata: OidcMetadata): SigningAlgorithm => {
  const selected = issuer.id_token_signing_algorithm ?? "RS256";
  if (!metadata.id_token_signing_alg_values_supported.includes(selected)) {
    throw new Error("OIDC issuer does not advertise the configured signing algorithm");
  }
  return selected;
};

const verifyIdentityToken = async (
  token: string,
  metadata: OidcMetadata,
  issuer: OidcIssuerConfig,
): Promise<Record<string, unknown>> => {
  const verified = await jwtVerify(token, remoteJwks(metadata.jwks_uri), {
    issuer: issuer.issuer,
    audience: issuer.client_id,
    algorithms: [signingAlgorithm(issuer, metadata)],
  });
  return verified.payload as Record<string, unknown>;
};

export type BackchannelLogoutToken = {
  issuer: string;
  jti: string;
  expiresAt: number;
  sid?: string;
  subject?: string;
};

const assertBackchannelProfile = (issuer: OidcIssuerConfig, metadata: OidcMetadata): void => {
  if (
    metadata.backchannel_logout_supported !== true ||
    (issuer.backchannel_logout?.session_required &&
      metadata.backchannel_logout_session_supported !== true)
  ) {
    throw new Error("OIDC issuer does not advertise the required back-channel logout profile");
  }
  if (metadata.id_token_signing_alg_values_supported.length === 0) {
    throw new Error("OIDC issuer has no supported logout-token signing algorithm");
  }
};

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const assertLogoutEvent = (payload: Record<string, unknown>): void => {
  const events = payload["events"];
  const logoutEvent =
    events && typeof events === "object" && !Array.isArray(events)
      ? (events as Record<string, unknown>)[LOGOUT_EVENT]
      : undefined;
  if (
    logoutEvent === undefined ||
    logoutEvent === null ||
    typeof logoutEvent !== "object" ||
    Array.isArray(logoutEvent)
  ) {
    throw new Error("OIDC logout token claims are invalid");
  }
};

const decodeLogoutIdentity = (
  payload: Record<string, unknown>,
  sessionRequired: boolean,
): {
  expiresAt: number;
  jti: string;
  sid?: string;
  subject?: string;
} => {
  assertLogoutEvent(payload);
  const sid = nonEmptyString(payload["sid"]);
  const subject = nonEmptyString(payload["sub"]);
  const jti = nonEmptyString(payload["jti"]);
  const issuedAt = typeof payload["iat"] === "number" ? payload["iat"] : undefined;
  const expiresAt = typeof payload["exp"] === "number" ? payload["exp"] : undefined;
  if (
    "nonce" in payload ||
    (!sid && !subject) ||
    !jti ||
    issuedAt === undefined ||
    expiresAt === undefined ||
    issuedAt > Date.now() / 1000 + 60 ||
    (sessionRequired && !sid)
  ) {
    throw new Error("OIDC logout token claims are invalid");
  }
  return {
    expiresAt: Math.min(expiresAt, issuedAt + 305) * 1000,
    jti,
    ...(sid ? { sid } : {}),
    ...(subject ? { subject } : {}),
  };
};

export const verifyBackchannelLogoutToken = async (
  issuer: OidcIssuerConfig,
  token: string,
): Promise<BackchannelLogoutToken> => {
  if (!issuer.backchannel_logout?.enabled || issuer.kind !== "keycloak") {
    throw new Error("OIDC back-channel logout is not enabled");
  }
  const metadata = await discoverIssuer(issuer);
  assertBackchannelProfile(issuer, metadata);
  const verified = await jwtVerify(token, remoteJwks(metadata.jwks_uri), {
    issuer: issuer.issuer,
    audience: issuer.client_id,
    algorithms: [signingAlgorithm(issuer, metadata)],
    requiredClaims: ["iss", "aud", "iat", "exp", "jti"],
    maxTokenAge: "5 minutes",
    clockTolerance: 5,
  });
  if (verified.protectedHeader.typ && verified.protectedHeader.typ !== "logout+jwt") {
    throw new Error("OIDC logout token type is invalid");
  }
  const identity = decodeLogoutIdentity(
    verified.payload as Record<string, unknown>,
    issuer.backchannel_logout.session_required,
  );
  return {
    issuer: issuer.issuer,
    ...identity,
  };
};

export const authorizationUrl = async (
  issuer: OidcIssuerConfig,
  flow: AuthorizationFlow,
): Promise<string> => {
  if (issuer.kind === "entra") {
    const client = entraClient(issuer);
    return client.getAuthCodeUrl({
      redirectUri: flow.redirectUri,
      scopes: [...issuer.scopes],
      state: flow.state,
      nonce: flow.nonce,
      codeChallenge: challengeFor(flow.verifier),
      codeChallengeMethod: "S256",
      prompt: "select_account",
    });
  }
  const metadata = await discoverIssuer(issuer);
  const url = new URL(metadata.authorization_endpoint);
  url.searchParams.set("client_id", issuer.client_id);
  url.searchParams.set("redirect_uri", flow.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", ["openid", "profile", "email", ...issuer.scopes].join(" "));
  url.searchParams.set("state", flow.state);
  url.searchParams.set("nonce", flow.nonce);
  url.searchParams.set("code_challenge", challengeFor(flow.verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
};

export const redeemAuthorizationCode = async (
  issuer: OidcIssuerConfig,
  flow: AuthorizationFlow,
  code: string,
): Promise<OidcTokenResult> => {
  if (issuer.kind === "entra") {
    const client = entraClient(issuer);
    const result = await client.acquireTokenByCode({
      code,
      redirectUri: flow.redirectUri,
      scopes: [...issuer.scopes],
      codeVerifier: flow.verifier,
    });
    const claims = (result?.idTokenClaims ?? {}) as Record<string, unknown>;
    if (!result?.accessToken || !result.idToken || claims["nonce"] !== flow.nonce) {
      throw new Error("Entra token response failed nonce or token validation");
    }
    return {
      accessToken: result.accessToken,
      idToken: result.idToken,
      ...(result.account?.homeAccountId ? { accountId: result.account.homeAccountId } : {}),
      claims,
    };
  }
  const metadata = await discoverIssuer(issuer);
  const authentication = authenticatedOidcForm(
    issuer,
    metadata.token_endpoint_auth_methods_supported,
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: flow.redirectUri,
      code_verifier: flow.verifier,
    }),
  );
  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: authentication.headers,
    body: authentication.body,
  });
  if (!response.ok) throw new Error(`Keycloak token exchange returned ${response.status}`);
  const tokens = (await response.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    id_token?: unknown;
  };
  if (typeof tokens.access_token !== "string" || typeof tokens.id_token !== "string") {
    throw new Error("Keycloak token response is incomplete");
  }
  const claims = await verifyIdentityToken(tokens.id_token, metadata, issuer);
  if (claims["nonce"] !== flow.nonce) throw new Error("Keycloak nonce validation failed");
  return {
    accessToken: tokens.access_token,
    ...(typeof tokens.refresh_token === "string" ? { refreshToken: tokens.refresh_token } : {}),
    idToken: tokens.id_token,
    claims,
  };
};

export const refreshOidcToken = async (
  issuer: OidcIssuerConfig,
  tokens: { refreshToken?: string; accountId?: string },
): Promise<OidcTokenResult> => {
  if (issuer.kind === "entra") {
    if (!tokens.accountId) throw new Error("Entra session has no account binding");
    const client = entraClient(issuer);
    const account = await client.getTokenCache().getAccountByHomeId(tokens.accountId);
    if (!account) throw new Error("Entra token cache no longer contains the session account");
    const result = await client.acquireTokenSilent({ account, scopes: [...issuer.scopes] });
    if (!result?.accessToken) throw new Error("Entra silent token acquisition failed");
    return {
      accessToken: result.accessToken,
      ...(result.idToken ? { idToken: result.idToken } : {}),
      accountId: tokens.accountId,
      claims: (result.idTokenClaims ?? {}) as Record<string, unknown>,
    };
  }
  if (!tokens.refreshToken) throw new Error("Keycloak session has no refresh token");
  const metadata = await discoverIssuer(issuer);
  const authentication = authenticatedOidcForm(
    issuer,
    metadata.token_endpoint_auth_methods_supported,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    }),
  );
  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: authentication.headers,
    body: authentication.body,
  });
  if (!response.ok) throw new Error(`Keycloak token refresh returned ${response.status}`);
  const result = (await response.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    id_token?: unknown;
  };
  if (typeof result.access_token !== "string" || typeof result.id_token !== "string")
    throw new Error("Keycloak refresh response is incomplete");
  const claims = await verifyIdentityToken(result.id_token, metadata, issuer);
  return {
    accessToken: result.access_token,
    ...(typeof result.refresh_token === "string" ? { refreshToken: result.refresh_token } : {}),
    idToken: result.id_token,
    claims,
  };
};

export const revokeOidcSession = async (
  issuer: OidcIssuerConfig,
  refreshToken: string | undefined,
): Promise<boolean> => {
  if (!refreshToken) return false;
  const metadata = await discoverIssuer(issuer);
  if (!metadata.revocation_endpoint) return false;
  const authentication = authenticatedOidcForm(
    issuer,
    metadata.revocation_endpoint_auth_methods_supported ??
      metadata.token_endpoint_auth_methods_supported,
    new URLSearchParams({
      token: refreshToken,
      token_type_hint: "refresh_token",
    }),
  );
  const response = await fetch(metadata.revocation_endpoint, {
    method: "POST",
    headers: authentication.headers,
    body: authentication.body,
  });
  if (!response.ok) throw new Error(`OIDC revocation returned ${response.status}`);
  return true;
};

export const removeOidcSessionAccount = async (
  issuer: OidcIssuerConfig,
  accountId: string | undefined,
): Promise<boolean> => {
  if (issuer.kind !== "entra" || !accountId) return false;
  const cache = entraClient(issuer).getTokenCache();
  const account = await cache.getAccountByHomeId(accountId);
  if (!account) return false;
  await cache.removeAccount(account);
  return true;
};

export const issuerLogoutUrl = async (
  issuer: OidcIssuerConfig,
  idToken: string | undefined,
  returnTo: string,
): Promise<string | null> => {
  const metadata = await discoverIssuer(issuer);
  const endpoint = issuer.logout_endpoint
    ? boundedEndpoint(issuer.logout_endpoint, issuer)
    : metadata.end_session_endpoint;
  if (!endpoint) return null;
  const url = new URL(endpoint);
  if (idToken) url.searchParams.set("id_token_hint", idToken);
  url.searchParams.set("client_id", issuer.client_id);
  url.searchParams.set("post_logout_redirect_uri", returnTo);
  return url.toString();
};
