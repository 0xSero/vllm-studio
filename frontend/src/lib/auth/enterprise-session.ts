import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  entitlementsForRoles,
  type EnterpriseAuthConfig,
  type EnterpriseRole,
  type NormalizedPrincipal,
  type OidcIssuerConfig,
} from "@local-studio/contracts/enterprise-auth";
import {
  putEnterpriseState,
  takeEnterpriseState,
  transactEnterpriseState,
  type EnterpriseStateTransaction,
} from "./enterprise-state-store";

export const ENTERPRISE_SESSION_COOKIE = "local_studio_enterprise_session";
export const ENTERPRISE_FLOW_COOKIE = "local_studio_enterprise_flow";
const SESSION_TOUCH_INTERVAL_MS = 30_000;

export type EnterpriseSession = {
  id: string;
  principal: NormalizedPrincipal;
  oidcSessionId?: string;
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  accountId?: string;
  tokenExpiresAt: number;
  createdAt: number;
  lastSeenAt: number;
  absoluteExpiresAt: number;
};

export type AuthorizationFlow = {
  id: string;
  issuerId: string;
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  returnTo: string;
  createdAt: number;
};

type IssuerLogoutTicket = {
  url: string;
  returnTo: string;
};

type SessionAlias = {
  sessionId: string;
};

type SessionIndex = {
  sessions: Record<string, number>;
};

const base64Url = (size: number): string => randomBytes(size).toString("base64url");

const normalizedIssuer = (issuer: string): string => issuer.replace(/\/+$/u, "");

const sessionIndexId = (issuer: string, issuerId: string, value: string): string =>
  createHash("sha256")
    .update(`${normalizedIssuer(issuer)}\u0000${issuerId}\u0000${value}`, "utf8")
    .digest("base64url");

const updateSessionIndex = (input: {
  add: boolean;
  expiresAt: number;
  id: string;
  kind: "session_sid" | "session_subject";
  sessionId: string;
  transaction: EnterpriseStateTransaction;
}): void => {
  const { add, expiresAt, id, kind, sessionId, transaction } = input;
  const current = transaction.get<SessionIndex>(kind, id)?.sessions ?? {};
  const sessions = { ...current };
  if (add) sessions[sessionId] = expiresAt;
  else delete sessions[sessionId];
  const expirations = Object.values(sessions);
  if (expirations.length === 0) {
    transaction.delete(kind, id);
  } else if (
    current[sessionId] !== sessions[sessionId] ||
    Object.keys(current).length !== Object.keys(sessions).length
  ) {
    transaction.put(kind, id, { sessions } satisfies SessionIndex, Math.max(...expirations));
  }
};

const indexSession = (
  transaction: EnterpriseStateTransaction,
  session: EnterpriseSession,
  add: boolean,
): void => {
  updateSessionIndex({
    add,
    expiresAt: session.absoluteExpiresAt,
    id: sessionIndexId(
      session.principal.issuer,
      session.principal.issuer_id,
      session.principal.subject,
    ),
    kind: "session_subject",
    sessionId: session.id,
    transaction,
  });
  if (session.oidcSessionId) {
    updateSessionIndex({
      add,
      expiresAt: session.absoluteExpiresAt,
      id: sessionIndexId(
        session.principal.issuer,
        session.principal.issuer_id,
        session.oidcSessionId,
      ),
      kind: "session_sid",
      sessionId: session.id,
      transaction,
    });
  }
};

const putSession = (transaction: EnterpriseStateTransaction, session: EnterpriseSession): void => {
  transaction.put("session", session.id, session, session.absoluteExpiresAt);
  indexSession(transaction, session, true);
};

const deleteSession = (
  transaction: EnterpriseStateTransaction,
  session: EnterpriseSession,
): void => {
  transaction.delete("session", session.id);
  indexSession(transaction, session, false);
};

const resolveSession = (
  transaction: EnterpriseStateTransaction,
  id: string,
): EnterpriseSession | null => {
  let candidate = id;
  const visited = new Set<string>();
  while (!visited.has(candidate) && visited.size < 8) {
    visited.add(candidate);
    const session = transaction.get<EnterpriseSession>("session", candidate);
    if (session) {
      if (session.id !== candidate) throw new Error("Enterprise session identity is invalid");
      return session;
    }
    const alias = transaction.get<SessionAlias>("session_alias", candidate);
    if (!alias || typeof alias.sessionId !== "string" || !alias.sessionId) return null;
    candidate = alias.sessionId;
  }
  return null;
};

export const createAuthorizationFlow = async (
  issuerId: string,
  redirectUri: string,
  returnTo: string,
): Promise<AuthorizationFlow> => {
  if (!returnTo.startsWith("/") || returnTo.startsWith("//"))
    throw new Error("Invalid return path");
  const flow: AuthorizationFlow = {
    id: randomUUID(),
    issuerId,
    state: base64Url(32),
    nonce: base64Url(32),
    verifier: base64Url(64),
    redirectUri,
    returnTo,
    createdAt: Date.now(),
  };
  await putEnterpriseState("flow", flow.id, flow, flow.createdAt + 10 * 60_000);
  return flow;
};

const secureEqual = (left: string, right: string): boolean =>
  timingSafeEqual(
    createHash("sha256").update(left, "utf8").digest(),
    createHash("sha256").update(right, "utf8").digest(),
  );

export const consumeAuthorizationFlow = async (
  id: string,
  state: string,
  issuerId: string,
): Promise<AuthorizationFlow> => {
  const flow = await transactEnterpriseState((transaction) => {
    const candidate = transaction.get<AuthorizationFlow>("flow", id);
    if (!candidate) return null;
    if (Date.now() - candidate.createdAt > 10 * 60_000) {
      transaction.delete("flow", id);
      return null;
    }
    if (!secureEqual(candidate.state, state) || candidate.issuerId !== issuerId) return null;
    return transaction.delete<AuthorizationFlow>("flow", id);
  });
  if (!flow) {
    throw new Error("OIDC authorization flow is invalid or expired");
  }
  return flow;
};

export const oidcSessionIdFromClaims = (claims: Record<string, unknown>): string | undefined => {
  const sid = claims["sid"];
  return typeof sid === "string" && sid.length > 0 ? sid : undefined;
};

export const createEnterpriseSession = async (
  principal: NormalizedPrincipal,
  accessToken: string,
  config: EnterpriseAuthConfig,
  tokens: {
    refreshToken?: string;
    idToken?: string;
    accountId?: string;
    oidcSessionId?: string;
  } = {},
): Promise<EnterpriseSession> => {
  const now = Date.now();
  const session: EnterpriseSession = {
    id: base64Url(32),
    principal,
    ...(tokens.oidcSessionId ? { oidcSessionId: tokens.oidcSessionId } : {}),
    accessToken,
    ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
    ...(tokens.idToken ? { idToken: tokens.idToken } : {}),
    ...(tokens.accountId ? { accountId: tokens.accountId } : {}),
    tokenExpiresAt: principal.expires_at * 1000,
    createdAt: now,
    lastSeenAt: now,
    absoluteExpiresAt: now + config.session_absolute_seconds * 1000,
  };
  await transactEnterpriseState((transaction) => putSession(transaction, session));
  return session;
};

export const getEnterpriseSession = async (
  id: string | null | undefined,
  config: EnterpriseAuthConfig | null,
): Promise<EnterpriseSession | null> => {
  if (!id || !config) return null;
  return transactEnterpriseState((transaction) => {
    const session = resolveSession(transaction, id);
    if (!session) return null;
    const now = Date.now();
    const idleDuration = config.session_idle_seconds * 1000;
    if (now >= session.absoluteExpiresAt || now - session.lastSeenAt >= idleDuration) {
      deleteSession(transaction, session);
      return null;
    }
    indexSession(transaction, session, true);
    const touchInterval = Math.min(SESSION_TOUCH_INTERVAL_MS, idleDuration / 2);
    if (now - session.lastSeenAt >= touchInterval) {
      session.lastSeenAt = now;
      transaction.put("session", session.id, session, session.absoluteExpiresAt);
    }
    return session;
  });
};

export const deleteEnterpriseSession = async (
  id: string | null | undefined,
): Promise<EnterpriseSession | null> => {
  if (!id) return null;
  return transactEnterpriseState((transaction) => {
    const session = resolveSession(transaction, id);
    if (!session) return null;
    deleteSession(transaction, session);
    transaction.delete("session_alias", id);
    return session;
  });
};

export const deleteEnterpriseSessionIfCurrent = (id: string): Promise<EnterpriseSession | null> =>
  transactEnterpriseState((transaction) => {
    const session = transaction.get<EnterpriseSession>("session", id);
    if (!session) return null;
    deleteSession(transaction, session);
    return session;
  });

export const resolveEnterpriseSession = (id: string): Promise<EnterpriseSession | null> =>
  transactEnterpriseState((transaction) => resolveSession(transaction, id));

export const createIssuerLogoutTicket = async (url: string, returnTo: string): Promise<string> => {
  const id = base64Url(32);
  await putEnterpriseState(
    "logout",
    id,
    { url, returnTo } satisfies IssuerLogoutTicket,
    Date.now() + 120_000,
  );
  return id;
};

export const consumeIssuerLogoutTicket = (id: string): Promise<IssuerLogoutTicket | null> =>
  takeEnterpriseState<IssuerLogoutTicket>("logout", id);

export const rotateEnterpriseSession = (
  session: EnterpriseSession,
  principal: NormalizedPrincipal,
  tokens: {
    accessToken: string;
    refreshToken?: string;
    idToken?: string;
    accountId?: string;
    oidcSessionId?: string;
    expiresAt: number;
  },
): Promise<EnterpriseSession | null> => {
  const rotated: EnterpriseSession = {
    ...session,
    id: base64Url(32),
    principal,
    oidcSessionId: tokens.oidcSessionId ?? session.oidcSessionId,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? session.refreshToken,
    idToken: tokens.idToken ?? session.idToken,
    accountId: tokens.accountId ?? session.accountId,
    tokenExpiresAt: tokens.expiresAt,
    lastSeenAt: Date.now(),
  };
  return transactEnterpriseState((transaction) => {
    const current = transaction.get<EnterpriseSession>("session", session.id);
    if (!current) return resolveSession(transaction, session.id);
    deleteSession(transaction, current);
    putSession(transaction, rotated);
    transaction.put(
      "session_alias",
      session.id,
      { sessionId: rotated.id } satisfies SessionAlias,
      Math.min(rotated.absoluteExpiresAt, Date.now() + 60_000),
    );
    return rotated;
  });
};

export type BackchannelLogoutResult = {
  deleted: number;
  replayed: boolean;
};

export const takeEnterpriseSessionsForLogout = (
  issuer: string,
  issuerId: string,
  jti: string,
  replayExpiresAt: number,
  identity: { sid?: string; subject?: string },
): Promise<{ result: BackchannelLogoutResult; sessions: EnterpriseSession[] }> =>
  transactEnterpriseState((transaction) => {
    const replayId = sessionIndexId(issuer, issuerId, jti);
    if (transaction.get("logout_replay", replayId)) {
      return { result: { deleted: 0, replayed: true }, sessions: [] };
    }
    transaction.put("logout_replay", replayId, { receivedAt: Date.now() }, replayExpiresAt);
    const index = identity.sid
      ? transaction.get<SessionIndex>("session_sid", sessionIndexId(issuer, issuerId, identity.sid))
      : identity.subject
        ? transaction.get<SessionIndex>(
            "session_subject",
            sessionIndexId(issuer, issuerId, identity.subject),
          )
        : undefined;
    const candidateIds = [
      ...(index ? Object.keys(index.sessions) : []),
      ...transaction.entries<EnterpriseSession>("session").map(([id]) => id),
    ];
    let deleted = 0;
    const sessions: EnterpriseSession[] = [];
    for (const id of new Set(candidateIds)) {
      const session = transaction.get<EnterpriseSession>("session", id);
      if (
        !session ||
        normalizedIssuer(session.principal.issuer) !== normalizedIssuer(issuer) ||
        session.principal.issuer_id !== issuerId ||
        (identity.sid && session.oidcSessionId !== identity.sid) ||
        (identity.subject && session.principal.subject !== identity.subject)
      ) {
        continue;
      }
      deleteSession(transaction, session);
      sessions.push(session);
      deleted += 1;
    }
    return { result: { deleted, replayed: false }, sessions };
  });

export const deleteEnterpriseSessionsForLogout = async (
  issuer: string,
  issuerId: string,
  jti: string,
  replayExpiresAt: number,
  identity: { sid?: string; subject?: string },
): Promise<BackchannelLogoutResult> =>
  (await takeEnterpriseSessionsForLogout(issuer, issuerId, jti, replayExpiresAt, identity)).result;

const clearanceRank = { open: 0, internal: 1, C1: 2, C2: 3 } as const;

const valuesAt = (claims: Record<string, unknown>, path: string): string[] => {
  let value: unknown = claims;
  for (const segment of path.split(".")) {
    if (!value || typeof value !== "object") return [];
    value = (value as Record<string, unknown>)[segment];
  }
  if (typeof value === "string") return [value];
  if (Array.isArray(value))
    return value.filter((entry): entry is string => typeof entry === "string");
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((entry) =>
      typeof entry === "string"
        ? [entry]
        : Array.isArray(entry)
          ? entry.filter((item): item is string => typeof item === "string")
          : [],
    );
  }
  return [];
};

const validateNormalizedClaims = (input: {
  subject: string;
  issuedAt: number;
  expiresAt: number;
  roles: readonly EnterpriseRole[];
  claimedIssuer: string;
  expectedIssuer: string;
  claimedTenant: string | undefined;
  expectedTenant: string | undefined;
}): void => {
  const invalid =
    !input.subject ||
    !Number.isFinite(input.issuedAt) ||
    input.issuedAt <= 0 ||
    input.issuedAt > Date.now() / 1000 + 60 ||
    !Number.isFinite(input.expiresAt) ||
    input.expiresAt <= Date.now() / 1000 ||
    input.roles.length === 0 ||
    input.claimedIssuer !== input.expectedIssuer ||
    (input.expectedTenant !== undefined && input.claimedTenant !== input.expectedTenant);
  if (invalid) throw new Error("OIDC identity has no authorized role mapping");
};

const identityEmail = (claims: Record<string, unknown>): string | undefined =>
  typeof claims["email"] === "string"
    ? claims["email"]
    : typeof claims["preferred_username"] === "string"
      ? claims["preferred_username"]
      : undefined;

export const normalizeOidcClaims = (
  claims: Record<string, unknown>,
  issuer: OidcIssuerConfig,
): NormalizedPrincipal => {
  const assignments = [
    ...valuesAt(claims, issuer.role_claim),
    ...valuesAt(claims, issuer.group_claim),
  ];
  const roles = [
    ...new Set(assignments.flatMap((entry) => issuer.role_mappings[entry] ?? [])),
  ] as EnterpriseRole[];
  const clearance = assignments.reduce<keyof typeof clearanceRank>((current, entry) => {
    const candidate = issuer.clearance_mappings[entry];
    return candidate && clearanceRank[candidate] > clearanceRank[current] ? candidate : current;
  }, "open");
  const subject = typeof claims["sub"] === "string" ? claims["sub"] : "";
  const issuedAt = typeof claims["iat"] === "number" ? claims["iat"] : 0;
  const expiresAt = typeof claims["exp"] === "number" ? claims["exp"] : 0;
  const claimedIssuer = typeof claims["iss"] === "string" ? claims["iss"].replace(/\/+$/u, "") : "";
  const expectedIssuer = issuer.issuer.replace(/\/+$/u, "");
  const claimedTenant = typeof claims["tid"] === "string" ? claims["tid"] : undefined;
  validateNormalizedClaims({
    subject,
    issuedAt,
    expiresAt,
    roles,
    claimedIssuer,
    expectedIssuer,
    claimedTenant,
    expectedTenant: issuer.tenant,
  });
  const email = identityEmail(claims);
  return {
    subject,
    issuer: issuer.issuer,
    issuer_id: issuer.id,
    tenant: claimedTenant ?? issuer.tenant ?? issuer.realm ?? "",
    display_name:
      (typeof claims["name"] === "string" ? claims["name"] : undefined) ?? email ?? subject,
    ...(email ? { email } : {}),
    roles,
    entitlements: entitlementsForRoles(roles),
    clearance,
    issued_at: issuedAt,
    expires_at: expiresAt,
  };
};
