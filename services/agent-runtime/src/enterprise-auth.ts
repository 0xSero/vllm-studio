import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EnterpriseAuthConfigSchema,
  entitlementsForRoles,
  type EnterpriseAuthConfig,
  type EnterpriseRole,
  type NormalizedPrincipal,
  type OidcIssuerConfig,
} from "@local-studio/contracts/enterprise-auth";
import { Schema } from "effect";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import {
  enterpriseOperationDenial,
  enterpriseOperationPolicy,
} from "@local-studio/contracts/enterprise-authorization";
import { loadWorkloadIdentityConfig } from "./spiffe-config";
import { isWorkloadApiUnavailable, validateJwtSvid } from "./spiffe-workload-api";

type KeySetEntry = {
  jwks: URL;
  keySet: ReturnType<typeof createRemoteJWKSet>;
  forcedRefreshAt: number;
};

const keySets = new Map<string, KeySetEntry>();
let cachedConfig: EnterpriseAuthConfig | null | undefined;

const config = (): EnterpriseAuthConfig | null => {
  if (cachedConfig !== undefined) return cachedConfig;
  const path = process.env.LOCAL_STUDIO_ENTERPRISE_AUTH_CONFIG?.trim();
  if (!path) {
    cachedConfig = null;
    return cachedConfig;
  }
  cachedConfig = Schema.decodeUnknownSync(EnterpriseAuthConfigSchema)(
    JSON.parse(readFileSync(resolve(path), "utf8")) as unknown,
  );
  return cachedConfig;
};

const stringValues = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
};

const valuesAt = (payload: JWTPayload, path: string): string[] => {
  let value: unknown = payload;
  for (const segment of path.split(".")) {
    if (!value || typeof value !== "object") return [];
    value = (value as Record<string, unknown>)[segment];
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.values(value as Record<string, unknown>).flatMap(stringValues);
  }
  return stringValues(value);
};

const normalize = (payload: JWTPayload, issuer: OidcIssuerConfig): NormalizedPrincipal => {
  const assignments = [
    ...valuesAt(payload, issuer.role_claim),
    ...valuesAt(payload, issuer.group_claim),
  ];
  const roles = [
    ...new Set(assignments.flatMap((entry) => issuer.role_mappings[entry] ?? [])),
  ] as EnterpriseRole[];
  const subject = typeof payload.sub === "string" ? payload.sub : "";
  const tenant = stringValues(payload["tid"])[0];
  if (
    !subject ||
    !payload.iat ||
    !payload.exp ||
    roles.length === 0 ||
    (issuer.tenant && tenant !== issuer.tenant)
  ) {
    throw new Error("Enterprise identity is not authorized");
  }
  const clearanceRank = { open: 0, internal: 1, C1: 2, C2: 3 } as const;
  const clearance = assignments.reduce<keyof typeof clearanceRank>((current, entry) => {
    const candidate = issuer.clearance_mappings[entry];
    return candidate && clearanceRank[candidate] > clearanceRank[current] ? candidate : current;
  }, "open");
  return {
    subject,
    issuer: issuer.issuer,
    issuer_id: issuer.id,
    tenant: tenant ?? issuer.tenant ?? issuer.realm ?? "",
    display_name: stringValues(payload["name"])[0] ?? subject,
    roles,
    entitlements: entitlementsForRoles(roles),
    clearance,
    issued_at: payload.iat,
    expires_at: payload.exp,
  };
};

const verify = async (
  token: string,
  enterpriseConfig: EnterpriseAuthConfig,
): Promise<NormalizedPrincipal> => {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Enterprise token is not a signed JWT");
  const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as JWTPayload;
  const tokenIssuer = typeof payload.iss === "string" ? payload.iss.replace(/\/+$/u, "") : "";
  const issuer = enterpriseConfig.issuers.find(
    (candidate) => candidate.issuer.replace(/\/+$/u, "") === tokenIssuer,
  );
  if (!issuer) throw new Error("Enterprise issuer is not trusted");
  const discovery = new URL(
    `${issuer.issuer.replace(/\/+$/u, "")}/.well-known/openid-configuration`,
  );
  const discoveryLoopback =
    discovery.protocol === "http:" &&
    (discovery.hostname === "127.0.0.1" || discovery.hostname === "localhost");
  if (
    discovery.username ||
    discovery.password ||
    (discovery.protocol !== "https:" && !discoveryLoopback)
  ) {
    throw new Error("Enterprise issuer endpoint is untrusted");
  }
  const keySetId = `${issuer.id}:${issuer.issuer}`;
  let keySetEntry = keySets.get(keySetId);
  if (!keySetEntry) {
    const response = await fetch(discovery);
    if (!response.ok) throw new Error("Enterprise discovery failed");
    const document = (await response.json()) as { issuer?: unknown; jwks_uri?: unknown };
    if (document.issuer !== issuer.issuer || typeof document.jwks_uri !== "string") {
      throw new Error("Enterprise discovery is invalid");
    }
    const jwks = new URL(document.jwks_uri);
    const trusted = new URL(issuer.issuer);
    const loopback =
      jwks.protocol === "http:" && (jwks.hostname === "127.0.0.1" || jwks.hostname === "localhost");
    if ((jwks.protocol !== "https:" && !loopback) || jwks.origin !== trusted.origin) {
      throw new Error("Enterprise JWKS endpoint is untrusted");
    }
    keySetEntry = {
      jwks,
      keySet: createRemoteJWKSet(jwks),
      forcedRefreshAt: 0,
    };
    keySets.set(keySetId, keySetEntry);
  }
  const options = {
    issuer: issuer.issuer,
    audience: issuer.audience,
    algorithms: ["RS256", "PS256", "ES256"],
  };
  let verified;
  try {
    verified = await jwtVerify(token, keySetEntry.keySet, options);
  } catch (error) {
    const noMatchingKey =
      error instanceof Error &&
      (error.name === "JWKSNoMatchingKey" ||
        (error as Error & { code?: string }).code === "ERR_JWKS_NO_MATCHING_KEY");
    const now = Date.now();
    if (!noMatchingKey || now - keySetEntry.forcedRefreshAt < 1_000) throw error;
    keySetEntry = {
      jwks: keySetEntry.jwks,
      keySet: createRemoteJWKSet(keySetEntry.jwks),
      forcedRefreshAt: now,
    };
    keySets.set(keySetId, keySetEntry);
    verified = await jwtVerify(token, keySetEntry.keySet, options);
  }
  return normalize(verified.payload, issuer);
};

export const agentRequestRequiresEnterpriseIdentity = (
  mode: EnterpriseAuthConfig["mode"],
  method: string,
  pathname: string,
): boolean => mode === "required_oidc" || Boolean(enterpriseOperationPolicy(method, pathname));

export type EnterpriseAgentAuthentication = {
  principal: NormalizedPrincipal | null;
  denied: Response | null;
};

export const authenticateEnterpriseAgentRequest = async (
  request: Request,
): Promise<EnterpriseAgentAuthentication> => {
  const enterpriseConfig = config();
  const pathname = new URL(request.url).pathname;
  if (
    !enterpriseConfig ||
    enterpriseConfig.mode === "local" ||
    pathname === "/health" ||
    pathname === "/ready"
  ) {
    return { principal: null, denied: null };
  }
  const policy = enterpriseOperationPolicy(request.method, pathname);
  const token = request.headers.get("x-local-studio-enterprise-token")?.trim();
  if (!token) {
    return {
      principal: null,
      denied: agentRequestRequiresEnterpriseIdentity(
        enterpriseConfig.mode,
        request.method,
        pathname,
      )
        ? Response.json({ error: "Enterprise identity required" }, { status: 401 })
        : null,
    };
  }
  try {
    const principal = await verify(token, enterpriseConfig);
    if (policy && enterpriseOperationDenial(principal, policy)) {
      return {
        principal: null,
        denied: Response.json({ error: "Enterprise authorization denied" }, { status: 403 }),
      };
    }
    return { principal, denied: null };
  } catch {
    return {
      principal: null,
      denied: Response.json({ error: "Invalid enterprise identity" }, { status: 401 }),
    };
  }
};

export const authorizeEnterpriseAgentRequest = async (request: Request): Promise<Response | null> =>
  (await authenticateEnterpriseAgentRequest(request)).denied;

export const authorizeSpiffeAgentRequest = async (
  request: Request,
  x509PeerId?: string,
): Promise<Response | null> => {
  const workload = loadWorkloadIdentityConfig();
  const pathname = new URL(request.url).pathname;
  if (!workload || workload.mode === "disabled" || pathname === "/health") return null;
  const token = request.headers.get("x-spiffe-jwt-svid")?.trim();
  if (!token) {
    return workload.mode === "required"
      ? Response.json({ error: "Workload identity required" }, { status: 401 })
      : null;
  }
  try {
    const validated = await validateJwtSvid(
      workload,
      workload.agent_runtime_audience,
      token,
      [workload.frontend_id, workload.controller_id],
      request.signal,
    );
    if (workload.x509_mtls === "required" && validated.spiffeId !== x509PeerId) {
      return Response.json({ error: "mTLS workload identity required" }, { status: 401 });
    }
    if (x509PeerId && validated.spiffeId !== x509PeerId) {
      return Response.json({ error: "Workload identities do not match" }, { status: 401 });
    }
    return null;
  } catch (error) {
    return isWorkloadApiUnavailable(error)
      ? Response.json({ error: "Workload identity service unavailable" }, { status: 503 })
      : Response.json({ error: "Invalid workload identity" }, { status: 401 });
  }
};
