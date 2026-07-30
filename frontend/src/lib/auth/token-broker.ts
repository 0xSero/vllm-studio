import {
  deleteEnterpriseSessionIfCurrent,
  normalizeOidcClaims,
  resolveEnterpriseSession,
  rotateEnterpriseSession,
  type EnterpriseSession,
} from "./enterprise-session";
import { withEnterpriseStateLease } from "./enterprise-state-store";
import { enterpriseIssuer } from "./enterprise-config";
import { refreshOidcToken } from "./oidc-client";
import { emitEnterpriseAudit } from "./enterprise-audit";
import type { OidcIssuerConfig } from "@local-studio/contracts/enterprise-auth";

export type EnterpriseAccessTokenLease = {
  accessToken: string;
  session: EnterpriseSession;
  rotated: boolean;
};

const pendingRefreshes = new Map<string, Promise<EnterpriseAccessTokenLease>>();

export const acquireEnterpriseAccessToken = (
  session: EnterpriseSession,
  dependencies: {
    issuer: (id: string) => OidcIssuerConfig;
    refresh: typeof refreshOidcToken;
  } = { issuer: enterpriseIssuer, refresh: refreshOidcToken },
): Promise<EnterpriseAccessTokenLease> => {
  if (Date.now() < session.tokenExpiresAt - 60_000) {
    return Promise.resolve({ accessToken: session.accessToken, session, rotated: false });
  }
  const existing = pendingRefreshes.get(session.id);
  if (existing) return existing;
  const pending = withEnterpriseStateLease(`refresh:${session.id}`, async () => {
    const current = await resolveEnterpriseSession(session.id);
    if (!current) throw new Error("Enterprise session is no longer active");
    if (current.id !== session.id || Date.now() < current.tokenExpiresAt - 60_000) {
      return {
        accessToken: current.accessToken,
        session: current,
        rotated: current.id !== session.id,
      };
    }
    const issuer = dependencies.issuer(current.principal.issuer_id);
    const tokens = await dependencies.refresh(issuer, {
      ...(current.refreshToken ? { refreshToken: current.refreshToken } : {}),
      ...(current.accountId ? { accountId: current.accountId } : {}),
    });
    const principal = normalizeOidcClaims(tokens.claims, issuer);
    if (
      principal.subject !== current.principal.subject ||
      principal.tenant !== current.principal.tenant
    ) {
      throw new Error("OIDC refresh changed the immutable identity");
    }
    const rotated = await rotateEnterpriseSession(current, principal, {
      accessToken: tokens.accessToken,
      ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
      ...(tokens.idToken ? { idToken: tokens.idToken } : {}),
      ...(tokens.accountId ? { accountId: tokens.accountId } : {}),
      ...(typeof tokens.claims["sid"] === "string" && tokens.claims["sid"]
        ? { oidcSessionId: tokens.claims["sid"] }
        : {}),
      expiresAt: principal.expires_at * 1000,
    });
    if (!rotated) throw new Error("Enterprise session ended during token refresh");
    emitEnterpriseAudit({
      event: "token_refresh",
      subject: rotated.principal.subject,
      issuer_id: rotated.principal.issuer_id,
      tenant: rotated.principal.tenant,
    });
    return { accessToken: rotated.accessToken, session: rotated, rotated: true };
  })
    .catch(async (error) => {
      await withEnterpriseStateLease(`refresh:${session.id}`, async () => {
        await deleteEnterpriseSessionIfCurrent(session.id);
      });
      emitEnterpriseAudit({
        event: "token_refresh_failure",
        subject: session.principal.subject,
        issuer_id: session.principal.issuer_id,
        tenant: session.principal.tenant,
        reason: error instanceof Error ? error.name : "unknown",
      });
      throw error;
    })
    .finally(() => pendingRefreshes.delete(session.id));
  pendingRefreshes.set(session.id, pending);
  return pending;
};
