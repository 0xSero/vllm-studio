import { appendFileSync } from "node:fs";
import type { OidcIssuerConfig } from "@local-studio/contracts/enterprise-auth";
import { resolveEnterpriseSession } from "../../src/lib/auth/enterprise-session";
import { acquireEnterpriseAccessToken } from "../../src/lib/auth/token-broker";

const [, , sessionId, countPath] = process.argv;
if (!sessionId || !countPath) throw new Error("Session worker arguments are incomplete");

const session = await resolveEnterpriseSession(sessionId);
if (!session) throw new Error("Session worker could not resolve the session");

const issuer: OidcIssuerConfig = {
  id: "issuer",
  kind: "keycloak",
  issuer: "https://issuer.example.test",
  client_id: "local-studio",
  audience: "local-studio-api",
  scopes: ["openid"],
  tenant: "tenant-1",
  role_claim: "roles",
  group_claim: "groups",
  role_mappings: { viewer: ["viewer"] },
  clearance_mappings: {},
};

const result = await acquireEnterpriseAccessToken(session, {
  issuer: () => issuer,
  refresh: async () => {
    appendFileSync(countPath, `${process.pid}\n`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const now = Math.floor(Date.now() / 1000);
    return {
      accessToken: "distributed-access-token",
      refreshToken: "distributed-refresh-token",
      idToken: "distributed-id-token",
      claims: {
        sub: session.principal.subject,
        iss: issuer.issuer,
        tid: issuer.tenant,
        iat: now,
        exp: now + 600,
        roles: ["viewer"],
      },
    };
  },
});

process.stdout.write(
  JSON.stringify({
    accessToken: result.accessToken,
    sessionId: result.session.id,
  }),
);
