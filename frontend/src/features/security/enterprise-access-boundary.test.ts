import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import type {
  EnterpriseAuthConfig,
  NormalizedPrincipal,
} from "@local-studio/contracts/enterprise-auth";
import { resolveAccessPosture } from "@/lib/auth/access";
import { createEnterpriseSession, ENTERPRISE_SESSION_COOKIE } from "@/lib/auth/enterprise-session";
import { requestUsesHttps } from "@/lib/auth/request-context";
import { config as proxyConfig, enforceAccess } from "@/proxy";
import { enterpriseOperationPolicy } from "@local-studio/contracts/enterprise-authorization";

const dataDir = mkdtempSync(join(tmpdir(), "enterprise-access-boundary-"));
process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEY = "test-only-access-boundary-key-32";

const config: EnterpriseAuthConfig = {
  mode: "required_oidc",
  issuers: [],
  session_idle_seconds: 900,
  session_absolute_seconds: 3600,
};

const configured: EnterpriseAuthConfig = {
  ...config,
  issuers: [
    {
      id: "corporate-keycloak",
      kind: "keycloak",
      issuer: "https://identity.example.test/realms/science",
      client_id: "local-studio",
      audience: "local-studio-api",
      scopes: ["openid"],
      realm: "science",
      role_claim: "realm_access.roles",
      group_claim: "groups",
      role_mappings: { scientist: ["scientist"] },
      clearance_mappings: { scientists: "C2" },
    },
  ],
};

const principal: NormalizedPrincipal = {
  subject: "subject-1",
  issuer: "https://issuer.example.test",
  issuer_id: "issuer",
  tenant: "tenant-1",
  display_name: "Scientist",
  roles: ["scientist"],
  entitlements: ["notebook:read", "model:invoke", "agent:invoke"],
  clearance: "C2",
  issued_at: Math.floor(Date.now() / 1000),
  expires_at: Math.floor(Date.now() / 1000) + 600,
};

const request = (path: string, sessionId?: string): NextRequest =>
  new NextRequest(`https://studio.example.test${path}`, {
    headers: sessionId ? { cookie: `${ENTERPRISE_SESSION_COOKIE}=${sessionId}` } : {},
  });

after(() => rmSync(dataDir, { recursive: true, force: true }));

describe("enterprise access boundary", () => {
  test("gives required and optional OIDC precedence over a desktop data directory", async () => {
    const shared = {
      desktop: "",
      nodeEnv: "production",
      enterpriseConfigPath: "/deployment/enterprise-auth.json",
    };
    assert.deepEqual(resolveAccessPosture({ ...shared, enterpriseMode: "required_oidc" }), {
      kind: "require-oidc",
    });
    assert.deepEqual(resolveAccessPosture({ ...shared, enterpriseMode: "optional_oidc" }), {
      kind: "optional-oidc",
    });
  });

  test("preserves loopback desktop local mode", async () => {
    assert.deepEqual(
      resolveAccessPosture({
        enterpriseMode: "local",
        enterpriseConfigPath: "/deployment/enterprise-auth.json",
        desktop: "1",
        nodeEnv: "production",
      }),
      { kind: "allow", reason: "desktop" },
    );
  });

  test("requires OIDC for production shared deployment even when a legacy token exists", async () => {
    assert.deepEqual(
      resolveAccessPosture({
        desktop: "",
        nodeEnv: "production",
        frontendToken: "legacy-shared-token",
        enterpriseConfigPath: "",
      }),
      { kind: "misconfigured" },
    );
  });

  test("covers every API path with the authoritative proxy", async () => {
    assert.equal(proxyConfig.matcher[0], "/api/:path*");
  });

  test("keeps controller proxy authorization aligned with notebook and Ray semantics", async () => {
    assert.deepEqual(enterpriseOperationPolicy("GET", "/api/proxy/workbench/notebooks"), {
      entitlement: "notebook:read",
    });
    assert.deepEqual(
      enterpriseOperationPolicy("POST", "/api/proxy/workbench/notebooks/session-1/execute"),
      { entitlement: "notebook:execute" },
    );
    assert.deepEqual(enterpriseOperationPolicy("POST", "/api/proxy/workbench/ray-jobs"), {
      entitlement: "ray:admit",
      clearance: "C2",
      role: "scientist",
    });
  });

  test("rejects a forged cookie on a previously unguarded agent API", async () => {
    const response = await enforceAccess(request("/api/agent/projects", "forged-session"), config);
    assert.equal(response?.status, 401);
    assert.deepEqual(await response?.json(), { error: "Enterprise sign-in required" });
    assert.match(
      response?.headers.get("set-cookie") ?? "",
      /Expires=Thu, 01 Jan 1970 00:00:00 GMT/iu,
    );
  });

  test("accepts an authoritative server-side session", async () => {
    const session = await createEnterpriseSession(principal, "access-token", config);
    assert.equal(await enforceAccess(request("/api/agent/projects", session.id), config), null);
  });

  test("denies a mapped viewer access to privileged agent APIs", async () => {
    const session = await createEnterpriseSession(
      {
        ...principal,
        roles: ["viewer"],
        entitlements: ["notebook:read"],
      },
      "access-token",
      config,
    );
    assert.equal(
      (await enforceAccess(request("/api/agent/projects", session.id), config))?.status,
      403,
    );
  });

  test("redirects to a configured issuer with an internal return path", async () => {
    const response = await enforceAccess(
      request("/science?experiment=one", "expired-session"),
      configured,
    );
    assert.equal(response?.status, 307);
    const location = new URL(response?.headers.get("location") ?? "");
    assert.equal(location.pathname, "/api/auth/login/corporate-keycloak");
    assert.equal(location.searchParams.get("returnTo"), "/science?experiment=one");
  });

  test("fails closed when required OIDC has no issuer", async () => {
    const response = await enforceAccess(request("/science"), config);
    assert.equal(response?.status, 503);
  });

  test("allows anonymous optional OIDC but rejects a forged optional session", async () => {
    const optional = { ...configured, mode: "optional_oidc" as const };
    assert.equal(await enforceAccess(request("/science"), optional), null);
    assert.equal((await enforceAccess(request("/api/agent/projects"), optional))?.status, 401);
    assert.equal(
      (await enforceAccess(request("/api/agent/projects", "forged-session"), optional))?.status,
      401,
    );
  });

  test("marks OIDC cookies secure behind an HTTPS reverse proxy", async () => {
    assert.equal(
      requestUsesHttps(
        new NextRequest("http://127.0.0.1/api/auth/callback/entra", {
          headers: { "x-forwarded-proto": "https" },
        }),
      ),
      true,
    );
    assert.equal(
      requestUsesHttps(new NextRequest("http://127.0.0.1/api/auth/callback/entra")),
      false,
    );
  });
});
