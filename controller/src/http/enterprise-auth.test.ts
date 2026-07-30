import { describe, expect, test } from "bun:test";
import type { JWTPayload } from "jose";
import type { OidcIssuerConfig } from "@local-studio/contracts/enterprise-auth";
import { normalizePrincipal } from "./enterprise-auth";

const issuer: OidcIssuerConfig = {
  id: "keycloak",
  kind: "keycloak",
  issuer: "https://identity.example.test/realms/science",
  client_id: "local-studio",
  audience: "local-studio-api",
  scopes: ["openid", "profile"],
  realm: "science",
  role_claim: "realm_access.roles",
  group_claim: "groups",
  role_mappings: {
    scientist: ["scientist"],
    administrators: ["platform_admin"],
  },
  clearance_mappings: {
    "c2-science": "C2",
  },
};

describe("enterprise identity normalization", () => {
  test("maps deployment roles and maximum clearance", () => {
    const principal = normalizePrincipal(
      {
        sub: "subject-1",
        iss: issuer.issuer,
        aud: issuer.audience,
        iat: 100,
        exp: 200,
        name: "Scientist",
        realm_access: { roles: ["scientist"] },
        groups: ["c2-science"],
      } as JWTPayload,
      issuer,
    );

    expect(principal.subject).toBe("subject-1");
    expect(principal.roles).toEqual(["scientist"]);
    expect(principal.clearance).toBe("C2");
    expect(principal.entitlements).toContain("ray:admit");
    expect(principal.entitlements).not.toContain("configuration:write");
  });

  test("fails closed when deployment mappings yield no role", () => {
    expect(() =>
      normalizePrincipal(
        {
          sub: "subject-2",
          iat: 100,
          exp: 200,
          realm_access: { roles: ["unmapped"] },
        } as JWTPayload,
        issuer,
      ),
    ).toThrow("authorized principal");
  });
});
