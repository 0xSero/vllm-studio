import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TokenCacheContext, type ISerializableTokenCache } from "@azure/msal-node";
import type {
  EnterpriseAuthConfig,
  NormalizedPrincipal,
  OidcIssuerConfig,
} from "@local-studio/contracts/enterprise-auth";
import {
  consumeIssuerLogoutTicket,
  consumeAuthorizationFlow,
  createAuthorizationFlow,
  createEnterpriseSession,
  createIssuerLogoutTicket,
  deleteEnterpriseSession,
  deleteEnterpriseSessionsForLogout,
  getEnterpriseSession,
  normalizeOidcClaims,
} from "../../lib/auth/enterprise-session";
import { acquireEnterpriseAccessToken } from "../../lib/auth/token-broker";
import { discoverIssuer } from "../../lib/auth/oidc-client";
import { createEnterpriseMsalCache } from "../../lib/auth/enterprise-msal-cache";
import { assertEnterpriseStateEncryptionKey } from "../../lib/auth/enterprise-state-store";

const dataDir = mkdtempSync(join(tmpdir(), "enterprise-session-"));
const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
const previousSessionKey = process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEY;
const previousSessionKeys = process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS;
const sessionKey = "test-only-session-encryption-key";
process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEY = sessionKey;
delete process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS;

const config: EnterpriseAuthConfig = {
  mode: "required_oidc",
  issuers: [],
  session_idle_seconds: 900,
  session_absolute_seconds: 3600,
};

const principal: NormalizedPrincipal = {
  subject: "subject-1",
  issuer: "https://issuer.example.test",
  issuer_id: "issuer",
  tenant: "tenant-1",
  display_name: "Scientist",
  roles: ["scientist"],
  entitlements: ["notebook:read", "notebook:execute", "ray:admit", "model:invoke", "agent:invoke"],
  clearance: "C2",
  issued_at: Math.floor(Date.now() / 1000),
  expires_at: Math.floor(Date.now() / 1000) + 600,
};

const legacyPayload = (value: unknown): string => {
  const nonce = randomBytes(12);
  const key = createHash("sha256").update(sessionKey, "utf8").digest();
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [nonce, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".");
};

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
  role_mappings: {
    viewer: ["viewer"],
    platform_admin: ["platform_admin"],
  },
  clearance_mappings: {
    platform_admin: "C2",
  },
};

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
  if (previousSessionKey === undefined) delete process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEY;
  else process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEY = previousSessionKey;
  if (previousSessionKeys === undefined) delete process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS;
  else process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS = previousSessionKeys;
});

describe("enterprise session persistence", () => {
  test("preserves callback flow after wrong state or issuer and consumes valid state once", async () => {
    const flow = await createAuthorizationFlow(
      "issuer",
      "https://app.example.test/callback",
      "/settings",
    );
    await assert.rejects(
      consumeAuthorizationFlow(flow.id, "incorrect-state", "issuer"),
      /invalid or expired/u,
    );
    await assert.rejects(
      consumeAuthorizationFlow(flow.id, flow.state, "other-issuer"),
      /invalid or expired/u,
    );
    assert.equal((await consumeAuthorizationFlow(flow.id, flow.state, "issuer")).id, flow.id);
    await assert.rejects(
      consumeAuthorizationFlow(flow.id, flow.state, "issuer"),
      /invalid or expired/u,
    );
  });

  test("persists opaque sessions without plaintext tokens", async () => {
    const session = await createEnterpriseSession(principal, "sensitive-access-token", config, {
      refreshToken: "sensitive-refresh-token",
    });
    const path = join(dataDir, "enterprise-sessions.json");
    const beforeRead = readFileSync(path);
    assert.equal(
      (await getEnterpriseSession(session.id, config))?.principal.subject,
      principal.subject,
    );
    const bytes = readFileSync(path);
    assert.deepEqual(bytes, beforeRead);
    assert.equal(bytes.includes(Buffer.from("sensitive-access-token")), false);
    assert.equal(bytes.includes(Buffer.from("sensitive-refresh-token")), false);
    assert.equal((await deleteEnterpriseSession(session.id))?.id, session.id);
    assert.equal(await getEnterpriseSession(session.id, config), null);
  });

  test("binds encrypted records to their logical session key", async () => {
    const first = await createEnterpriseSession(principal, "first-bound-token", config);
    const second = await createEnterpriseSession(principal, "second-bound-token", config);
    const path = join(dataDir, "enterprise-sessions.json");
    const original = readFileSync(path, "utf8");
    const document = JSON.parse(original) as {
      records: Record<string, { payload: string; expires_at: number; envelope?: number }>;
    };
    document.records[`session:${first.id}`] = document.records[`session:${second.id}`]!;
    writeFileSync(path, `${JSON.stringify(document)}\n`, { mode: 0o600 });
    try {
      await assert.rejects(getEnterpriseSession(first.id, config));
    } finally {
      writeFileSync(path, original, { mode: 0o600 });
    }
  });

  test("reads legacy encrypted sessions during envelope migration", async () => {
    const session = await createEnterpriseSession(principal, "legacy-access-token", config);
    const path = join(dataDir, "enterprise-sessions.json");
    const document = JSON.parse(readFileSync(path, "utf8")) as {
      records: Record<string, { payload: string; expires_at: number; envelope?: number }>;
    };
    document.records[`session:${session.id}`] = {
      payload: legacyPayload(session),
      expires_at: session.absoluteExpiresAt,
    };
    writeFileSync(path, `${JSON.stringify(document)}\n`, { mode: 0o600 });
    assert.equal(
      (await getEnterpriseSession(session.id, config))?.accessToken,
      "legacy-access-token",
    );
    const migrated = JSON.parse(readFileSync(path, "utf8")) as {
      records: Record<string, { envelope?: number; key_id?: string }>;
    };
    assert.equal(migrated.records[`session:${session.id}`]?.envelope, 3);
    assert.equal(migrated.records[`session:${session.id}`]?.key_id, "default");
  });

  test("rotates session encryption keys and migrates records to the primary key", async () => {
    const currentKeys = process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS;
    const currentKey = process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEY;
    const oldKey = "old-enterprise-session-key-material-0001";
    const newKey = "new-enterprise-session-key-material-0002";
    delete process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEY;
    process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS = JSON.stringify([{ id: "old", key: oldKey }]);
    try {
      const rotationPrincipal = { ...principal, subject: "rotation-subject" };
      const session = await createEnterpriseSession(
        rotationPrincipal,
        "rotation-access-token",
        config,
      );
      const unmigrated = await createEnterpriseSession(
        rotationPrincipal,
        "unmigrated-access-token",
        config,
      );
      const path = join(dataDir, "enterprise-sessions.json");
      process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS = JSON.stringify([
        { id: "old", key: oldKey },
        { id: "new", key: newKey },
      ]);
      assert.equal(
        (await getEnterpriseSession(session.id, config))?.accessToken,
        "rotation-access-token",
      );
      const staged = JSON.parse(readFileSync(path, "utf8")) as {
        records: Record<string, { key_id?: string }>;
      };
      assert.equal(staged.records[`session:${session.id}`]?.key_id, "old");
      process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS = JSON.stringify([
        { id: "new", key: newKey },
        { id: "old", key: oldKey },
      ]);
      assert.equal(
        (await getEnterpriseSession(session.id, config))?.accessToken,
        "rotation-access-token",
      );
      const migrated = JSON.parse(readFileSync(path, "utf8")) as {
        records: Record<string, { envelope?: number; key_id?: string }>;
      };
      assert.equal(migrated.records[`session:${session.id}`]?.envelope, 3);
      assert.equal(migrated.records[`session:${session.id}`]?.key_id, "new");
      process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS = JSON.stringify([
        { id: "new", key: newKey },
      ]);
      assert.equal(
        (await getEnterpriseSession(session.id, config))?.accessToken,
        "rotation-access-token",
      );
      await assert.rejects(getEnterpriseSession(unmigrated.id, config), /key is unavailable/u);
      process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS = JSON.stringify([
        { id: "new", key: newKey },
        { id: "old", key: oldKey },
      ]);
      await deleteEnterpriseSession(session.id);
      await deleteEnterpriseSession(unmigrated.id);
    } finally {
      if (currentKeys === undefined) delete process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS;
      else process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS = currentKeys;
      if (currentKey === undefined) delete process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEY;
      else process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEY = currentKey;
    }
  });

  test("rejects weak, duplicate, and malformed enterprise session keyrings", async () => {
    const weakDirectory = mkdtempSync(join(tmpdir(), "enterprise-session-weak-"));
    const currentDirectory = process.env.LOCAL_STUDIO_DATA_DIR;
    const currentKey = process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEY;
    const currentKeys = process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS;
    process.env.LOCAL_STUDIO_DATA_DIR = weakDirectory;
    delete process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEY;
    try {
      process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS = JSON.stringify([
        { id: "weak", key: "weak" },
      ]);
      assert.throws(() => assertEnterpriseStateEncryptionKey(), /at least 32 bytes/u);
      process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS = JSON.stringify([
        { id: "one", key: "duplicate-enterprise-session-key-0001" },
        { id: "two", key: "duplicate-enterprise-session-key-0001" },
      ]);
      assert.throws(() => assertEnterpriseStateEncryptionKey(), /must be unique/u);
      process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS = "not-json";
      assert.throws(() => assertEnterpriseStateEncryptionKey(), /valid JSON/u);
      process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS = JSON.stringify([
        { id: "valid", key: "valid-enterprise-session-key-material-01" },
      ]);
      process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEY = "compatibility-session-key-material-0001";
      assert.throws(() => assertEnterpriseStateEncryptionKey(), /either the enterprise/u);
    } finally {
      rmSync(weakDirectory, { recursive: true, force: true });
      if (currentDirectory === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
      else process.env.LOCAL_STUDIO_DATA_DIR = currentDirectory;
      if (currentKey === undefined) delete process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEY;
      else process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEY = currentKey;
      if (currentKeys === undefined) delete process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS;
      else process.env.LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS = currentKeys;
    }
  });

  test("deduplicates refresh, remaps authorization, and rotates the opaque session", async () => {
    let refreshes = 0;
    const stale = await createEnterpriseSession(
      {
        ...principal,
        roles: ["platform_admin"],
        entitlements: [
          "notebook:read",
          "notebook:execute",
          "ray:admit",
          "model:invoke",
          "agent:invoke",
          "configuration:write",
          "audit:read",
        ],
        expires_at: Math.floor(Date.now() / 1000) - 1,
      },
      "stale-access-token",
      config,
      { refreshToken: "refresh-token" },
    );
    const dependencies = {
      issuer: () => issuer,
      refresh: async () => {
        refreshes += 1;
        await Promise.resolve();
        const now = Math.floor(Date.now() / 1000);
        return {
          accessToken: "rotated-access-token",
          refreshToken: "rotated-refresh-token",
          idToken: "rotated-id-token",
          claims: {
            sub: principal.subject,
            iss: issuer.issuer,
            tid: issuer.tenant,
            iat: now,
            exp: now + 600,
            roles: ["viewer"],
          },
        };
      },
    };
    const [first, second] = await Promise.all([
      acquireEnterpriseAccessToken(stale, dependencies),
      acquireEnterpriseAccessToken(stale, dependencies),
    ]);
    assert.equal(refreshes, 1);
    assert.equal(first.session.id, second.session.id);
    assert.notEqual(first.session.id, stale.id);
    assert.deepEqual(first.session.principal.roles, ["viewer"]);
    assert.deepEqual(first.session.principal.entitlements, ["notebook:read"]);
    assert.equal((await getEnterpriseSession(stale.id, config))?.id, first.session.id);
    assert.equal(
      (await getEnterpriseSession(first.session.id, config))?.accessToken,
      "rotated-access-token",
    );
  });

  test("does not resurrect a session when back-channel logout wins an in-flight refresh", async () => {
    const racePrincipal = {
      ...principal,
      subject: "logout-race-subject",
      expires_at: Math.floor(Date.now() / 1000) - 1,
    };
    const stale = await createEnterpriseSession(racePrincipal, "logout-race-token", config, {
      refreshToken: "logout-race-refresh-token",
    });
    let beginRefresh = (): void => {};
    let finishRefresh = (): void => {};
    const started = new Promise<void>((resolve) => {
      beginRefresh = resolve;
    });
    const finish = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    const pending = acquireEnterpriseAccessToken(stale, {
      issuer: () => issuer,
      refresh: async () => {
        beginRefresh();
        await finish;
        const now = Math.floor(Date.now() / 1000);
        return {
          accessToken: "must-not-survive",
          claims: {
            sub: racePrincipal.subject,
            iss: issuer.issuer,
            tid: issuer.tenant,
            iat: now,
            exp: now + 600,
            roles: ["viewer"],
          },
        };
      },
    });
    await started;
    assert.deepEqual(
      await deleteEnterpriseSessionsForLogout(
        racePrincipal.issuer,
        racePrincipal.issuer_id,
        "logout-race-jti",
        Date.now() + 120_000,
        { subject: racePrincipal.subject },
      ),
      { deleted: 1, replayed: false },
    );
    finishRefresh();
    await assert.rejects(pending, /ended during token refresh/u);
    assert.equal(await getEnterpriseSession(stale.id, config), null);
  });

  test("persists the MSAL cache encrypted across plugin instances", async () => {
    const serialized = JSON.stringify({
      Account: { account: { home_account_id: "home-account" } },
      AccessToken: { token: { secret: "restart-sensitive-token" } },
    });
    let restored = "";
    const writer = createEnterpriseMsalCache("entra:test-client");
    const writerContext = new TokenCacheContext(
      {
        deserialize: (): void => {},
        serialize: (): string => serialized,
      } satisfies ISerializableTokenCache,
      true,
    );
    await writer.beforeCacheAccess(writerContext);
    await writer.afterCacheAccess(writerContext);
    const reader = createEnterpriseMsalCache("entra:test-client");
    const readerContext = new TokenCacheContext(
      {
        deserialize: (value: string): void => {
          restored = value;
        },
        serialize: (): string => "",
      } satisfies ISerializableTokenCache,
      false,
    );
    await reader.beforeCacheAccess(readerContext);
    await reader.afterCacheAccess(readerContext);
    assert.equal(restored, serialized);
    assert.equal(
      readFileSync(join(dataDir, "enterprise-sessions.json")).includes(
        Buffer.from("restart-sensitive-token"),
      ),
      false,
    );
  });

  test("rejects a tenant downgrade during claim normalization", async () => {
    const now = Math.floor(Date.now() / 1000);
    assert.throws(
      () =>
        normalizeOidcClaims(
          {
            sub: principal.subject,
            iss: issuer.issuer,
            tid: "other-tenant",
            iat: now,
            exp: now + 600,
            roles: ["viewer"],
          },
          issuer,
        ),
      /authorized role mapping/u,
    );
  });

  test("rejects missing issuer and materially future identity claims", async () => {
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      sub: principal.subject,
      tid: issuer.tenant,
      iat: now,
      exp: now + 600,
      roles: ["viewer"],
    };
    assert.throws(() => normalizeOidcClaims(claims, issuer), /authorized role mapping/u);
    assert.throws(
      () =>
        normalizeOidcClaims(
          {
            ...claims,
            iss: issuer.issuer,
            iat: now + 120,
          },
          issuer,
        ),
      /authorized role mapping/u,
    );
    for (const issuedAt of [-1, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () =>
          normalizeOidcClaims(
            {
              ...claims,
              iss: issuer.issuer,
              iat: issuedAt,
            },
            issuer,
          ),
        /authorized role mapping/u,
      );
    }
    assert.throws(
      () =>
        normalizeOidcClaims(
          {
            ...claims,
            iss: issuer.issuer,
            exp: Number.POSITIVE_INFINITY,
          },
          issuer,
        ),
      /authorized role mapping/u,
    );
  });

  test("consumes issuer logout tickets once", async () => {
    const ticket = await createIssuerLogoutTicket(
      "https://issuer.example.test/logout",
      "/settings#enterprise",
    );
    assert.equal(
      (await consumeIssuerLogoutTicket(ticket))?.url,
      "https://issuer.example.test/logout",
    );
    assert.equal(await consumeIssuerLogoutTicket(ticket), null);
  });

  test("indexes sid and subject logout atomically and records replay", async () => {
    const logoutPrincipal = { ...principal, subject: "logout-subject" };
    const first = await createEnterpriseSession(logoutPrincipal, "sid-first-token", config, {
      oidcSessionId: "sid-first",
    });
    const second = await createEnterpriseSession(logoutPrincipal, "sid-second-token", config, {
      oidcSessionId: "sid-second",
    });
    const otherClient = await createEnterpriseSession(
      { ...logoutPrincipal, issuer_id: "other-client" },
      "other-client-token",
      config,
      { oidcSessionId: "sid-first" },
    );
    const expiry = Date.now() + 120_000;
    assert.deepEqual(
      await deleteEnterpriseSessionsForLogout(
        logoutPrincipal.issuer,
        logoutPrincipal.issuer_id,
        "logout-jti-first",
        expiry,
        { sid: "sid-first", subject: logoutPrincipal.subject },
      ),
      { deleted: 1, replayed: false },
    );
    assert.equal(await getEnterpriseSession(first.id, config), null);
    assert.equal((await getEnterpriseSession(second.id, config))?.id, second.id);
    assert.equal((await getEnterpriseSession(otherClient.id, config))?.id, otherClient.id);
    assert.deepEqual(
      await deleteEnterpriseSessionsForLogout(
        logoutPrincipal.issuer,
        logoutPrincipal.issuer_id,
        "logout-jti-first",
        expiry,
        { sid: "sid-first", subject: logoutPrincipal.subject },
      ),
      { deleted: 0, replayed: true },
    );
    assert.deepEqual(
      await deleteEnterpriseSessionsForLogout(
        logoutPrincipal.issuer,
        logoutPrincipal.issuer_id,
        "logout-jti-subject",
        expiry,
        {
          subject: logoutPrincipal.subject,
        },
      ),
      { deleted: 1, replayed: false },
    );
    assert.equal(await getEnterpriseSession(second.id, config), null);
    assert.equal((await getEnterpriseSession(otherClient.id, config))?.id, otherClient.id);
    assert.deepEqual(
      await deleteEnterpriseSessionsForLogout(
        logoutPrincipal.issuer,
        "other-client",
        "other-client-jti",
        expiry,
        { sid: "sid-first", subject: logoutPrincipal.subject },
      ),
      { deleted: 1, replayed: false },
    );
  });

  test("scans legacy sessions when an index is only partially migrated", async () => {
    const legacyPrincipal = { ...principal, subject: "partial-index-subject" };
    const first = await createEnterpriseSession(legacyPrincipal, "partial-first-token", config);
    const second = await createEnterpriseSession(legacyPrincipal, "partial-second-token", config);
    const path = join(dataDir, "enterprise-sessions.json");
    const document = JSON.parse(readFileSync(path, "utf8")) as {
      records: Record<string, unknown>;
    };
    const indexId = createHash("sha256")
      .update(
        `${legacyPrincipal.issuer}\u0000${legacyPrincipal.issuer_id}\u0000${legacyPrincipal.subject}`,
        "utf8",
      )
      .digest("base64url");
    delete document.records[`session_subject:${indexId}`];
    writeFileSync(path, `${JSON.stringify(document)}\n`);
    assert.equal((await getEnterpriseSession(first.id, config))?.id, first.id);
    assert.deepEqual(
      await deleteEnterpriseSessionsForLogout(
        legacyPrincipal.issuer,
        legacyPrincipal.issuer_id,
        "partial-index-logout",
        Date.now() + 120_000,
        { subject: legacyPrincipal.subject },
      ),
      { deleted: 2, replayed: false },
    );
    assert.equal(await getEnterpriseSession(first.id, config), null);
    assert.equal(await getEnterpriseSession(second.id, config), null);
  });

  test("rejects an untrusted discovery issuer before network access", async () => {
    assert.throws(
      () =>
        discoverIssuer({
          ...issuer,
          id: "untrusted",
          issuer: "http://identity.example.test/realms/science",
        }),
      /issuer URL is untrusted/u,
    );
    assert.throws(
      () =>
        discoverIssuer({
          ...issuer,
          id: "credentialed",
          issuer: "https://operator:secret@identity.example.test/realms/science",
        }),
      /issuer URL is untrusted/u,
    );
  });
});
