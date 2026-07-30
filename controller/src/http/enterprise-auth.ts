import type {
  EnterpriseAuthConfig,
  EnterpriseEntitlement,
  EnterpriseRole,
  NormalizedPrincipal,
  OidcIssuerConfig,
} from "@local-studio/contracts/enterprise-auth";
import { entitlementsForRoles } from "@local-studio/contracts/enterprise-auth";
import { Effect } from "effect";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const clearanceRank = { open: 0, internal: 1, C1: 2, C2: 3 } as const;

const stringValues = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
};

const nestedValues = (payload: JWTPayload, path: string): string[] => {
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

export const normalizePrincipal = (
  payload: JWTPayload,
  issuer: OidcIssuerConfig,
): NormalizedPrincipal => {
  const assignments = [
    ...nestedValues(payload, issuer.role_claim),
    ...nestedValues(payload, issuer.group_claim),
  ];
  const roles = [
    ...new Set(
      assignments.flatMap((assignment) => issuer.role_mappings[assignment] ?? []),
    ),
  ] as EnterpriseRole[];
  const clearances = assignments
    .map((assignment) => issuer.clearance_mappings[assignment])
    .filter((value): value is keyof typeof clearanceRank => Boolean(value));
  const clearance = clearances.reduce<keyof typeof clearanceRank>(
    (current, candidate) =>
      clearanceRank[candidate] > clearanceRank[current] ? candidate : current,
    "open",
  );
  const subject = typeof payload.sub === "string" ? payload.sub : "";
  if (!subject || roles.length === 0 || !payload.iat || !payload.exp) {
    throw new Error("OIDC token does not map to an authorized principal");
  }
  return {
    subject,
    issuer: issuer.issuer,
    issuer_id: issuer.id,
    tenant:
      stringValues(payload["tid"])[0] ??
      stringValues(payload["tenant"])[0] ??
      issuer.tenant ??
      issuer.realm ??
      "",
    display_name:
      stringValues(payload["name"])[0] ??
      stringValues(payload["preferred_username"])[0] ??
      subject,
    ...(stringValues(payload["email"])[0]
      ? { email: stringValues(payload["email"])[0] }
      : {}),
    roles,
    entitlements: entitlementsForRoles(roles),
    clearance,
    issued_at: payload.iat,
    expires_at: payload.exp,
  };
};

export class EnterpriseTokenVerifier {
  readonly #issuers: EnterpriseAuthConfig["issuers"];
  readonly #keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

  public constructor(config: EnterpriseAuthConfig) {
    this.#issuers = config.issuers;
  }

  public verify(token: string): Effect.Effect<NormalizedPrincipal, unknown> {
    const parts = token.split(".");
    if (parts.length !== 3) return Effect.fail(new Error("Bearer token is not a signed JWT"));
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as JWTPayload;
    const tokenIssuer = typeof payload.iss === "string" ? payload.iss.replace(/\/+$/u, "") : "";
    const issuer = this.#issuers.find(
      (candidate) => candidate.issuer.replace(/\/+$/u, "") === tokenIssuer,
    );
    if (!issuer) return Effect.fail(new Error("OIDC issuer is not trusted"));
    const keySets = this.#keySets;
    let keySet = keySets.get(issuer.id);
    return Effect.gen(function* () {
      if (!keySet) {
        const metadata = yield* Effect.tryPromise({
          try: () =>
            fetch(`${issuer.issuer.replace(/\/+$/u, "")}/.well-known/openid-configuration`),
          catch: (error) => error,
        });
        if (!metadata.ok) return yield* Effect.fail(new Error("OIDC discovery failed"));
        const document: unknown = yield* Effect.tryPromise({
          try: () => metadata.json(),
          catch: (error) => error,
        });
        if (
          !document ||
          typeof document !== "object" ||
          typeof (document as { jwks_uri?: unknown }).jwks_uri !== "string"
        ) {
          return yield* Effect.fail(new Error("OIDC discovery has no JWKS URI"));
        }
        keySet = createRemoteJWKSet(new URL((document as { jwks_uri: string }).jwks_uri));
        keySets.set(issuer.id, keySet);
      }
      const verified = yield* Effect.tryPromise({
        try: () =>
          jwtVerify(token, keySet!, {
            issuer: issuer.issuer,
            audience: issuer.audience,
            algorithms: ["RS256", "PS256", "ES256"],
          }),
        catch: (error) => error,
      });
      return normalizePrincipal(verified.payload, issuer);
    });
  }
}

export const hasEntitlement = (
  principal: NormalizedPrincipal,
  entitlement: EnterpriseEntitlement,
): boolean => principal.entitlements.includes(entitlement);
