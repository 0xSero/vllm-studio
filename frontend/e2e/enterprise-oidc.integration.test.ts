import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { NextRequest } from "next/server";
import { GET as login } from "@/app/api/auth/login/[issuer]/route";
import { GET as callback } from "@/app/api/auth/callback/[issuer]/route";
import { POST as backchannelLogout } from "@/app/api/auth/backchannel-logout/[issuer]/route";
import { GET as session } from "@/app/api/auth/session/route";
import { GET as finishLogout, POST as logout } from "@/app/api/auth/logout/route";
import { ENTERPRISE_FLOW_COOKIE, ENTERPRISE_SESSION_COOKIE } from "@/lib/auth/enterprise-session";
import { discoverIssuer } from "@/lib/auth/oidc-client";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/security/request-boundary";
import { authorizeEnterpriseAgentRequest } from "@local-studio/agent-runtime/enterprise-auth";

type TokenMode = "valid" | "nonce" | "issuer" | "audience" | "tenant" | "expired";

type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

type FixtureKey = {
  kid: string;
  privateKey: SigningKey;
  publicJwk: JWK;
};

const directory = mkdtempSync(join(tmpdir(), "enterprise-oidc-integration-"));
const applicationOrigin = "http://127.0.0.1:39000";
const originalEnvironment = {
  dataDir: process.env.LOCAL_STUDIO_DATA_DIR,
  authConfig: process.env.LOCAL_STUDIO_ENTERPRISE_AUTH_CONFIG,
  sessionKey: process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEY,
  sessionKeys: process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS,
  keycloakSecret: process.env.LOCAL_STUDIO_OIDC_SECRET_KEYCLOAK,
  entraSecret: process.env.LOCAL_STUDIO_OIDC_SECRET_ENTRA,
};
let issuerOrigin = "";
let keycloakIssuer = "";
let entraIssuer = "";
let server: ReturnType<typeof createServer>;
let primaryKey: FixtureKey;
let rotatedKey: FixtureKey;
let rogueKey: FixtureKey;
let psKey: FixtureKey;
let activeKey: FixtureKey;
let tokenMode: TokenMode = "valid";
let refreshes = 0;
let revocations = 0;
let endSessions = 0;
const csrfToken = "enterprise-logout-csrf-proof";
const basicAuthorization = `Basic ${Buffer.from("local-studio:fixture-secret", "utf8").toString("base64")}`;

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
};

const sendJson = (response: ServerResponse, status: number, value: unknown): void => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
};

const publicKey = (key: FixtureKey): JWK => ({
  ...key.publicJwk,
  kid: key.kid,
  alg: "RS256",
  use: "sig",
});

const identityToken = async (input: {
  key: FixtureKey;
  issuer: string;
  nonce: string | undefined;
  roles: string[];
  clearanceGroup: string | undefined;
  mode: TokenMode;
  sid?: string;
  expirationSeconds?: number;
}): Promise<string> => {
  const now = Math.floor(Date.now() / 1000);
  const token = new SignJWT({
    roles: input.roles,
    groups: input.clearanceGroup ? [input.clearanceGroup] : [],
    tid: input.mode === "tenant" ? "other-tenant" : "tenant-1",
    name: "Fixture Scientist",
    ...(input.sid ? { sid: input.sid } : {}),
    ...(input.nonce ? { nonce: input.mode === "nonce" ? "wrong-nonce" : input.nonce } : {}),
  })
    .setProtectedHeader({ alg: "RS256", kid: input.key.kid })
    .setIssuer(input.mode === "issuer" ? `${input.issuer}/wrong` : input.issuer)
    .setAudience(input.mode === "audience" ? "wrong-client" : "local-studio")
    .setSubject("subject-1")
    .setIssuedAt(input.mode === "expired" ? now - 120 : now)
    .setExpirationTime(input.mode === "expired" ? now - 60 : now + (input.expirationSeconds ?? 30));
  return token.sign(input.key.privateKey);
};

const runtimeToken = (
  key: FixtureKey,
  issuer: string,
  audience = "local-studio-api",
): Promise<string> =>
  new SignJWT({ roles: ["scientist"], groups: ["c2"], tid: "tenant-1" })
    .setProtectedHeader({ alg: "RS256", kid: key.kid })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject("subject-1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key.privateKey);

const cookieValue = (response: Response, name: string): string => {
  const value = response.headers.get("set-cookie") ?? "";
  const match = value.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`, "u"));
  if (!match?.[1]) throw new Error(`Response did not set ${name}`);
  return match[1];
};

const loginFlow = async (issuerId = "keycloak") => {
  const response = await login(
    new NextRequest(`${applicationOrigin}/api/auth/login/${issuerId}?returnTo=%2Fsettings`),
    { params: Promise.resolve({ issuer: issuerId }) },
  );
  assert.equal(response.status, 307);
  const authorization = new URL(response.headers.get("location") ?? "");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorization.searchParams.get("nonce")?.length, 43);
  return {
    authorization,
    flowCookie: cookieValue(response, ENTERPRISE_FLOW_COOKIE),
  };
};

before(async () => {
  const first = await generateKeyPair("RS256");
  const second = await generateKeyPair("RS256");
  const third = await generateKeyPair("RS256");
  const ps = await generateKeyPair("PS256");
  primaryKey = {
    kid: "fixture-key-1",
    privateKey: first.privateKey,
    publicJwk: await exportJWK(first.publicKey),
  };
  rotatedKey = {
    kid: "fixture-key-2",
    privateKey: second.privateKey,
    publicJwk: await exportJWK(second.publicKey),
  };
  rogueKey = {
    kid: "fixture-key-rogue",
    privateKey: third.privateKey,
    publicJwk: await exportJWK(third.publicKey),
  };
  psKey = {
    kid: "fixture-key-ps256",
    privateKey: ps.privateKey,
    publicJwk: await exportJWK(ps.publicKey),
  };
  activeKey = primaryKey;
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", issuerOrigin);
    const issuer = url.pathname.startsWith("/entra") ? entraIssuer : keycloakIssuer;
    if (url.pathname.endsWith("/.well-known/openid-configuration")) {
      sendJson(response, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        revocation_endpoint: `${issuer}/revoke`,
        end_session_endpoint: `${issuer}/logout`,
        backchannel_logout_supported: true,
        backchannel_logout_session_supported: true,
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      });
      return;
    }
    if (url.pathname.endsWith("/jwks")) {
      sendJson(response, 200, { keys: [publicKey(activeKey)] });
      return;
    }
    if (url.pathname === "/keycloak/token" && request.method === "POST") {
      const body = new URLSearchParams(await readBody(request));
      assert.equal(request.headers.authorization, basicAuthorization);
      assert.equal(body.get("client_id"), null);
      assert.equal(body.get("client_secret"), null);
      if (body.get("grant_type") === "authorization_code") {
        const verifier = body.get("code_verifier") ?? "";
        const expected = createHash("sha256").update(verifier).digest("base64url");
        const nonce = body.get("code") === "fixture-code" ? currentNonce : "";
        assert.equal(expected, currentChallenge);
        sendJson(response, 200, {
          token_type: "Bearer",
          access_token: "fixture-access-token",
          refresh_token: "fixture-refresh-token",
          id_token: await identityToken({
            key: activeKey,
            issuer: keycloakIssuer,
            nonce,
            roles: ["platform"],
            clearanceGroup: "c2",
            mode: tokenMode,
            sid: currentSid,
          }),
        });
        return;
      }
      if (body.get("grant_type") === "refresh_token") {
        refreshes += 1;
        assert.equal(body.get("refresh_token"), "fixture-refresh-token");
        await new Promise((resolve) => setTimeout(resolve, 25));
        sendJson(response, 200, {
          token_type: "Bearer",
          access_token: "rotated-access-token",
          refresh_token: "rotated-refresh-token",
          id_token: await identityToken({
            key: activeKey,
            issuer: keycloakIssuer,
            nonce: undefined,
            roles: ["viewer"],
            clearanceGroup: undefined,
            mode: "valid",
            sid: currentSid,
            expirationSeconds: 300,
          }),
        });
        return;
      }
    }
    if (url.pathname === "/keycloak/revoke" && request.method === "POST") {
      const body = new URLSearchParams(await readBody(request));
      assert.equal(request.headers.authorization, basicAuthorization);
      assert.equal(body.get("token"), "rotated-refresh-token");
      revocations += 1;
      response.writeHead(200);
      response.end();
      return;
    }
    if (url.pathname === "/keycloak/logout") {
      assert.equal(url.searchParams.get("client_id"), "local-studio");
      assert.ok(url.searchParams.get("id_token_hint"));
      endSessions += 1;
      response.writeHead(302, {
        location: url.searchParams.get("post_logout_redirect_uri") ?? applicationOrigin,
      });
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("OIDC fixture did not bind");
  issuerOrigin = `http://127.0.0.1:${address.port}`;
  keycloakIssuer = `${issuerOrigin}/keycloak`;
  entraIssuer = `${issuerOrigin}/entra`;
  const configPath = join(directory, "enterprise-auth.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      mode: "required_oidc",
      issuers: [
        {
          id: "keycloak",
          kind: "keycloak",
          issuer: keycloakIssuer,
          client_id: "local-studio",
          audience: "local-studio-api",
          scopes: ["openid"],
          tenant: "tenant-1",
          realm: "science",
          role_claim: "roles",
          group_claim: "groups",
          role_mappings: {
            platform: ["platform_admin"],
            viewer: ["viewer"],
            scientist: ["scientist"],
          },
          clearance_mappings: { c2: "C2" },
          backchannel_logout: {
            enabled: true,
            session_required: true,
          },
        },
        {
          id: "entra",
          kind: "entra",
          issuer: entraIssuer,
          client_id: "local-studio",
          audience: "local-studio-api",
          scopes: ["api://local-studio/access"],
          tenant: "tenant-1",
          role_claim: "roles",
          group_claim: "groups",
          role_mappings: { scientist: ["scientist"] },
          clearance_mappings: { c2: "C2" },
        },
      ],
      session_idle_seconds: 900,
      session_absolute_seconds: 3600,
    }),
  );
  process.env.LOCAL_STUDIO_DATA_DIR = directory;
  process.env.LOCAL_STUDIO_ENTERPRISE_AUTH_CONFIG = configPath;
  process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEY = "fixture-session-encryption-key-32";
  delete process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS;
  process.env.LOCAL_STUDIO_OIDC_SECRET_KEYCLOAK = "fixture-secret";
  process.env.LOCAL_STUDIO_OIDC_SECRET_ENTRA = "fixture-secret";
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  rmSync(directory, { recursive: true, force: true });
  const restore = (key: string, value: string | undefined): void => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  restore("LOCAL_STUDIO_DATA_DIR", originalEnvironment.dataDir);
  restore("LOCAL_STUDIO_ENTERPRISE_AUTH_CONFIG", originalEnvironment.authConfig);
  restore("LOCAL_STUDIO_ENTERPRISE_SESSION_KEY", originalEnvironment.sessionKey);
  restore("LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS", originalEnvironment.sessionKeys);
  restore("LOCAL_STUDIO_OIDC_SECRET_KEYCLOAK", originalEnvironment.keycloakSecret);
  restore("LOCAL_STUDIO_OIDC_SECRET_ENTRA", originalEnvironment.entraSecret);
});

let currentChallenge = "";
let currentNonce = "";
let currentSid = "fixture-sid";

const logoutToken = async (input: {
  algorithm?: "RS256" | "PS256";
  audience?: string;
  events?: unknown;
  issuer?: string;
  jti?: string;
  key?: FixtureKey;
  nonce?: string;
  omit?: "iat" | "exp" | "jti";
  sid?: string;
  subject?: string;
  typ?: string;
}): Promise<string> => {
  const now = Math.floor(Date.now() / 1000);
  const key = input.key ?? activeKey;
  const token = new SignJWT({
    events:
      input.events === undefined
        ? { "http://schemas.openid.net/event/backchannel-logout": {} }
        : input.events,
    ...(input.nonce ? { nonce: input.nonce } : {}),
    ...(input.sid ? { sid: input.sid } : {}),
  })
    .setProtectedHeader({
      alg: input.algorithm ?? "RS256",
      kid: key.kid,
      typ: input.typ ?? "logout+jwt",
    })
    .setIssuer(input.issuer ?? keycloakIssuer)
    .setAudience(input.audience ?? "local-studio");
  if (input.omit !== "iat") token.setIssuedAt(now);
  if (input.omit !== "exp") token.setExpirationTime(now + 120);
  if (input.omit !== "jti") token.setJti(input.jti ?? `logout-${randomUUID()}`);
  if (input.subject) token.setSubject(input.subject);
  return token.sign(key.privateKey);
};

const sendBackchannelLogout = (token: string, contentType = "application/x-www-form-urlencoded") =>
  backchannelLogout(
    new NextRequest(`${applicationOrigin}/api/auth/backchannel-logout/keycloak`, {
      method: "POST",
      headers: { "content-type": contentType },
      body: new URLSearchParams({ logout_token: token }),
    }),
    { params: Promise.resolve({ issuer: "keycloak" }) },
  );

describe("enterprise OIDC route integration", () => {
  test("discovers Keycloak-like and Entra-like issuers over HTTP", async () => {
    const keycloak = await discoverIssuer({
      id: "keycloak",
      kind: "keycloak",
      issuer: keycloakIssuer,
      client_id: "local-studio",
      audience: "local-studio-api",
      scopes: ["openid"],
      tenant: "tenant-1",
      role_claim: "roles",
      group_claim: "groups",
      role_mappings: { scientist: ["scientist"] },
      clearance_mappings: { c2: "C2" },
    });
    const entra = await discoverIssuer({
      id: "entra",
      kind: "entra",
      issuer: entraIssuer,
      client_id: "local-studio",
      audience: "local-studio-api",
      scopes: ["api://local-studio/access"],
      tenant: "tenant-1",
      role_claim: "roles",
      group_claim: "groups",
      role_mappings: { scientist: ["scientist"] },
      clearance_mappings: { c2: "C2" },
    });
    assert.equal(keycloak.issuer, keycloakIssuer);
    assert.equal(entra.issuer, entraIssuer);
  });

  test("enforces PKCE and rejects nonce, issuer, audience, tenant, and expiry failures", async () => {
    for (const mode of ["nonce", "issuer", "audience", "tenant", "expired"] as const) {
      const flow = await loginFlow();
      currentChallenge = flow.authorization.searchParams.get("code_challenge") ?? "";
      currentNonce = flow.authorization.searchParams.get("nonce") ?? "";
      tokenMode = mode;
      const response = await callback(
        new NextRequest(
          `${applicationOrigin}/api/auth/callback/keycloak?code=fixture-code&state=${encodeURIComponent(
            flow.authorization.searchParams.get("state") ?? "",
          )}`,
          { headers: { cookie: `${ENTERPRISE_FLOW_COOKIE}=${flow.flowCookie}` } },
        ),
        { params: Promise.resolve({ issuer: "keycloak" }) },
      );
      assert.equal(response.status, 401, mode);
    }
  });

  test("creates one callback session, rejects callback replay, and verifies runtime parity", async () => {
    const flow = await loginFlow();
    currentChallenge = flow.authorization.searchParams.get("code_challenge") ?? "";
    currentNonce = flow.authorization.searchParams.get("nonce") ?? "";
    tokenMode = "valid";
    const callbackUrl = `${applicationOrigin}/api/auth/callback/keycloak?code=fixture-code&state=${encodeURIComponent(
      flow.authorization.searchParams.get("state") ?? "",
    )}`;
    const accepted = await callback(
      new NextRequest(callbackUrl, {
        headers: { cookie: `${ENTERPRISE_FLOW_COOKIE}=${flow.flowCookie}` },
      }),
      { params: Promise.resolve({ issuer: "keycloak" }) },
    );
    assert.equal(accepted.status, 307);
    sessionCookie = cookieValue(accepted, ENTERPRISE_SESSION_COOKIE);
    const replay = await callback(
      new NextRequest(callbackUrl, {
        headers: { cookie: `${ENTERPRISE_FLOW_COOKIE}=${flow.flowCookie}` },
      }),
      { params: Promise.resolve({ issuer: "keycloak" }) },
    );
    assert.equal(replay.status, 401);
    assert.equal(
      await authorizeEnterpriseAgentRequest(
        new Request("http://runtime/api/agent/turn", {
          method: "POST",
          headers: {
            "x-local-studio-enterprise-token": await runtimeToken(primaryKey, keycloakIssuer),
          },
        }),
      ),
      null,
    );
    assert.equal(
      await authorizeEnterpriseAgentRequest(
        new Request("http://runtime/api/agent/turn", {
          method: "POST",
          headers: {
            "x-local-studio-enterprise-token": await runtimeToken(primaryKey, entraIssuer),
          },
        }),
      ),
      null,
    );
  });

  test("deduplicates refresh, accepts JWKS rotation, and rotates a downgraded session", async () => {
    activeKey = rotatedKey;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_050));
    const request = () =>
      session(
        new NextRequest(`${applicationOrigin}/api/auth/session`, {
          headers: { cookie: `${ENTERPRISE_SESSION_COOKIE}=${sessionCookie}` },
        }),
      );
    const [first, second] = await Promise.all([request(), request()]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const firstBody = (await first.json()) as {
      authenticated: boolean;
      principal: { roles: string[]; clearance: string };
    };
    const secondBody = (await second.json()) as typeof firstBody;
    assert.equal(firstBody.authenticated, true);
    assert.deepEqual(firstBody, secondBody);
    assert.deepEqual(firstBody.principal.roles, ["viewer"]);
    assert.equal(firstBody.principal.clearance, "open");
    assert.equal(refreshes, 1);
    const firstCookie = cookieValue(first, ENTERPRISE_SESSION_COOKIE);
    const secondCookie = cookieValue(second, ENTERPRISE_SESSION_COOKIE);
    assert.equal(firstCookie, secondCookie);
    assert.notEqual(firstCookie, sessionCookie);
    const stale = await session(
      new NextRequest(`${applicationOrigin}/api/auth/session`, {
        headers: { cookie: `${ENTERPRISE_SESSION_COOKIE}=${sessionCookie}` },
      }),
    );
    assert.equal(((await stale.json()) as { authenticated: boolean }).authenticated, true);
    sessionCookie = firstCookie;
    assert.equal(
      await authorizeEnterpriseAgentRequest(
        new Request("http://runtime/api/agent/turn", {
          method: "POST",
          headers: {
            "x-local-studio-enterprise-token": await runtimeToken(rotatedKey, keycloakIssuer),
          },
        }),
      ),
      null,
    );
  });

  test("rejects logout CSRF, revokes, redirects, and denies ticket replay", async () => {
    const missingProof = await logout(
      new NextRequest(`${applicationOrigin}/api/auth/logout?returnTo=%2Fsettings`, {
        method: "POST",
        headers: { cookie: `${ENTERPRISE_SESSION_COOKIE}=${sessionCookie}` },
      }),
    );
    assert.equal(missingProof.status, 403);
    const mismatchedProof = await logout(
      new NextRequest(`${applicationOrigin}/api/auth/logout?returnTo=%2Fsettings`, {
        method: "POST",
        headers: {
          cookie: `${ENTERPRISE_SESSION_COOKIE}=${sessionCookie}; ${CSRF_COOKIE}=${csrfToken}`,
          [CSRF_HEADER]: "incorrect-proof",
        },
      }),
    );
    assert.equal(mismatchedProof.status, 403);
    const response = await logout(
      new NextRequest(`${applicationOrigin}/api/auth/logout?returnTo=%2Fsettings`, {
        method: "POST",
        headers: {
          cookie: `${ENTERPRISE_SESSION_COOKIE}=${sessionCookie}; ${CSRF_COOKIE}=${csrfToken}`,
          [CSRF_HEADER]: csrfToken,
        },
      }),
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      revocation: string;
      logout_path: string | null;
    };
    assert.equal(body.revocation, "observed");
    assert.ok(body.logout_path);
    assert.equal(revocations, 1);
    const redirect = await finishLogout(new NextRequest(`${applicationOrigin}${body.logout_path}`));
    assert.equal(redirect.status, 303);
    const issuerLocation = redirect.headers.get("location") ?? "";
    assert.equal(new URL(issuerLocation).pathname, "/keycloak/logout");
    const endSession = await fetch(issuerLocation, { redirect: "manual" });
    assert.equal(endSession.status, 302);
    assert.equal(endSessions, 1);
    const replay = await finishLogout(new NextRequest(`${applicationOrigin}${body.logout_path}`));
    assert.equal(new URL(replay.headers.get("location") ?? "").pathname, "/settings");
  });

  test("validates back-channel logout, removes the indexed session, and denies replay", async () => {
    currentSid = "backchannel-session";
    const flow = await loginFlow();
    currentChallenge = flow.authorization.searchParams.get("code_challenge") ?? "";
    currentNonce = flow.authorization.searchParams.get("nonce") ?? "";
    tokenMode = "valid";
    const accepted = await callback(
      new NextRequest(
        `${applicationOrigin}/api/auth/callback/keycloak?code=fixture-code&state=${encodeURIComponent(
          flow.authorization.searchParams.get("state") ?? "",
        )}`,
        { headers: { cookie: `${ENTERPRISE_FLOW_COOKIE}=${flow.flowCookie}` } },
      ),
      { params: Promise.resolve({ issuer: "keycloak" }) },
    );
    const cookie = cookieValue(accepted, ENTERPRISE_SESSION_COOKIE);
    for (const invalid of [
      await logoutToken({
        audience: "wrong-client",
        sid: currentSid,
        subject: "subject-1",
      }),
      await logoutToken({
        events: {},
        sid: currentSid,
        subject: "subject-1",
      }),
      await logoutToken({
        nonce: "prohibited",
        sid: currentSid,
        subject: "subject-1",
      }),
      await logoutToken({ subject: "subject-1" }),
      await logoutToken({
        sid: currentSid,
        subject: "subject-1",
        typ: "JWT",
      }),
      await logoutToken({
        issuer: `${keycloakIssuer}/wrong`,
        sid: currentSid,
        subject: "subject-1",
      }),
      await logoutToken({
        key: rogueKey,
        sid: currentSid,
        subject: "subject-1",
      }),
      await logoutToken({
        algorithm: "PS256",
        key: psKey,
        sid: currentSid,
        subject: "subject-1",
      }),
      await logoutToken({ omit: "iat", sid: currentSid, subject: "subject-1" }),
      await logoutToken({ omit: "exp", sid: currentSid, subject: "subject-1" }),
      await logoutToken({ omit: "jti", sid: currentSid, subject: "subject-1" }),
    ]) {
      assert.equal((await sendBackchannelLogout(invalid)).status, 400);
    }
    const before = await session(
      new NextRequest(`${applicationOrigin}/api/auth/session`, {
        headers: { cookie: `${ENTERPRISE_SESSION_COOKIE}=${cookie}` },
      }),
    );
    assert.equal(((await before.json()) as { authenticated: boolean }).authenticated, true);
    const valid = await logoutToken({
      jti: "backchannel-jti",
      sid: currentSid,
      subject: "subject-1",
    });
    const validResponse = await sendBackchannelLogout(
      valid,
      "Application/X-WWW-Form-Urlencoded; charset=UTF-8",
    );
    assert.equal(validResponse.status, 200);
    assert.equal(validResponse.headers.get("cache-control"), "no-store");
    assert.equal(revocations, 2);
    const after = await session(
      new NextRequest(`${applicationOrigin}/api/auth/session`, {
        headers: { cookie: `${ENTERPRISE_SESSION_COOKIE}=${cookie}` },
      }),
    );
    assert.equal(((await after.json()) as { authenticated: boolean }).authenticated, false);
    const replay = await sendBackchannelLogout(valid);
    assert.equal(replay.status, 400);
    assert.equal(replay.headers.get("cache-control"), "no-store");
    assert.equal(
      (
        await sendBackchannelLogout(
          await logoutToken({
            sid: currentSid,
            subject: "subject-1",
          }),
          "application/json",
        )
      ).status,
      400,
    );
  });
});

let sessionCookie = "";
