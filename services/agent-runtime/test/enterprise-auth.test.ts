import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from "jose";
import {
  agentRequestRequiresEnterpriseIdentity,
  authenticateEnterpriseAgentRequest,
  authorizeEnterpriseAgentRequest,
} from "../src/enterprise-auth";
import { emitEnterpriseAgentEvidence } from "../src/enterprise-evidence";

const directory = mkdtempSync(join(tmpdir(), "agent-enterprise-auth-"));
let server: Server;
let issuer = "";
let privateKey: KeyLike;

const token = (roles: string[], audience = "local-studio-api"): Promise<string> =>
  new SignJWT({ roles })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("subject-1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

before(async () => {
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  const publicJwk = await exportJWK(keys.publicKey);
  server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/.well-known/openid-configuration") {
      response.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
      return;
    }
    response.end(JSON.stringify({ keys: [{ ...publicJwk, kid: "test-key", alg: "RS256" }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("OIDC fixture did not bind");
  issuer = `http://127.0.0.1:${address.port}`;
  const configPath = join(directory, "enterprise-auth.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      mode: "required_oidc",
      issuers: [
        {
          id: "fixture",
          kind: "keycloak",
          issuer,
          client_id: "local-studio",
          audience: "local-studio-api",
          scopes: ["openid"],
          realm: "science",
          role_claim: "roles",
          group_claim: "groups",
          role_mappings: {
            scientist: ["scientist"],
            viewer: ["viewer"],
            agent_admin: ["agent_admin"],
            platform_admin: ["platform_admin"],
          },
          clearance_mappings: {
            scientist: "C2",
            agent_admin: "C1",
            platform_admin: "C2",
          },
        },
      ],
      session_idle_seconds: 900,
      session_absolute_seconds: 3600,
    }),
  );
  process.env.LOCAL_STUDIO_ENTERPRISE_AUTH_CONFIG = configPath;
});

after(() => {
  server.close();
  rmSync(directory, { recursive: true, force: true });
  delete process.env.LOCAL_STUDIO_ENTERPRISE_AUTH_CONFIG;
});

describe("agent runtime enterprise boundary", () => {
  test("requires identity for privileged operations in optional OIDC mode", () => {
    assert.equal(
      agentRequestRequiresEnterpriseIdentity("optional_oidc", "POST", "/api/agent/turn"),
      true,
    );
    assert.equal(
      agentRequestRequiresEnterpriseIdentity("optional_oidc", "GET", "/unprivileged"),
      false,
    );
  });

  test("requires enterprise identity in shared mode", async () => {
    const denied = await authorizeEnterpriseAgentRequest(
      new Request("http://runtime/api/agent/turn", { method: "POST" }),
    );
    assert.equal(denied?.status, 401);
    const spoofed = await authorizeEnterpriseAgentRequest(
      new Request("http://runtime/api/agent/turn", {
        method: "POST",
        headers: {
          "x-local-studio-enterprise-subject": "subject-1",
          "x-local-studio-enterprise-tenant": "science",
          "x-local-studio-enterprise-clearance": "C2",
        },
      }),
    );
    assert.equal(spoofed?.status, 401);
  });

  test("validates issuer, audience, signature, and agent entitlement", async () => {
    const headers = { "x-local-studio-enterprise-token": await token(["scientist"]) };
    assert.equal(
      await authorizeEnterpriseAgentRequest(
        new Request("http://runtime/api/agent/turn", { method: "POST", headers }),
      ),
      null,
    );
    const viewerDenied = await authorizeEnterpriseAgentRequest(
      new Request("http://runtime/api/agent/turn", {
        method: "POST",
        headers: { "x-local-studio-enterprise-token": await token(["viewer"]) },
      }),
    );
    assert.equal(viewerDenied?.status, 403);
  });

  test("returns normalized identity context without exposing the bearer token", async () => {
    const value = await authenticateEnterpriseAgentRequest(
      new Request("http://runtime/api/agent/turn", {
        method: "POST",
        headers: { "x-local-studio-enterprise-token": await token(["scientist"]) },
      }),
    );
    assert.equal(value.denied, null);
    assert.deepEqual(
      value.principal && {
        subject: value.principal.subject,
        issuer: value.principal.issuer,
        issuer_id: value.principal.issuer_id,
        tenant: value.principal.tenant,
        clearance: value.principal.clearance,
      },
      {
        subject: "subject-1",
        issuer,
        issuer_id: "fixture",
        tenant: "science",
        clearance: "C2",
      },
    );
    assert.equal(JSON.stringify(value.principal).includes("enterprise-token"), false);
  });

  test("emits token-free runtime evidence from validated principal context", () => {
    const lines: string[] = [];
    const original = console.info;
    console.info = (line?: unknown) => lines.push(String(line));
    try {
      emitEnterpriseAgentEvidence(
        {
          subject: "subject-1",
          issuer,
          issuer_id: "fixture",
          tenant: "science",
          display_name: "Scientist",
          roles: ["scientist"],
          entitlements: ["agent:invoke"],
          clearance: "C2",
          issued_at: 1,
          expires_at: 2,
        },
        {
          operation: "agent.turn.prompt",
          session_id: "session-1",
          model_id: "model-1",
        },
      );
    } finally {
      console.info = original;
    }
    const evidence = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.deepEqual(
      {
        subject: evidence["subject"],
        issuer: evidence["issuer"],
        tenant: evidence["tenant"],
        clearance: evidence["clearance"],
        session_id: evidence["session_id"],
      },
      {
        subject: "subject-1",
        issuer,
        tenant: "science",
        clearance: "C2",
        session_id: "session-1",
      },
    );
    assert.equal(JSON.stringify(evidence).includes("token"), false);
  });

  test("rejects a valid signature with the wrong audience", async () => {
    const denied = await authorizeEnterpriseAgentRequest(
      new Request("http://runtime/api/agent/turn", {
        method: "POST",
        headers: { "x-local-studio-enterprise-token": await token(["scientist"], "wrong-api") },
      }),
    );
    assert.equal(denied?.status, 401);
  });

  test("requires configuration authority and C2 clearance for onboarding", async () => {
    const scientistDenied = await authorizeEnterpriseAgentRequest(
      new Request("http://runtime/api/agent/onboarding", {
        headers: { "x-local-studio-enterprise-token": await token(["scientist"]) },
      }),
    );
    assert.equal(scientistDenied?.status, 403);
    const clearanceDenied = await authorizeEnterpriseAgentRequest(
      new Request("http://runtime/api/agent/onboarding", {
        headers: { "x-local-studio-enterprise-token": await token(["agent_admin"]) },
      }),
    );
    assert.equal(clearanceDenied?.status, 403);
    assert.equal(
      await authorizeEnterpriseAgentRequest(
        new Request("http://runtime/api/agent/onboarding", {
          headers: { "x-local-studio-enterprise-token": await token(["platform_admin"]) },
        }),
      ),
      null,
    );
  });
});
