import { afterAll, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { cleanTemps, jsonResponse, tempDir } from "./test-fixtures";
import type { OAuthConnectorDependencies } from "../src/oauth-connectors";
import type { OAuthConnectorAuthDefinition } from "../src/oauth-connector-contract";
import type { ConnectorConfig } from "../src/connectors-service";

process.env.LOCAL_STUDIO_DATA_DIR = tempDir("oauth-connectors-");
const oauth = await import("../src/oauth-connectors");
const { resolveConnectorTarget } = await import("../src/connector-pool");
const { listConnectors } = await import("../src/connectors-service");

type State = {
  polls: number;
  allow: boolean;
  deny: boolean;
  refreshes: Array<Record<string, string>>;
  challenge: string | null;
};
const state: State = { polls: 0, allow: false, deny: false, refreshes: [], challenge: null };
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/login/device/code")
      return jsonResponse({
        device_code: "device-code-1",
        user_code: "ABCD-1234",
        verification_uri: `http://127.0.0.1:${server.port}/activate`,
        expires_in: 900,
        interval: 0.02,
      });
    if (url.pathname === "/user")
      return (request.headers.get("authorization") ?? "").startsWith("Bearer gho_")
        ? jsonResponse({ login: "octocat" })
        : new Response("", { status: 401 });
    if (url.pathname !== "/login/oauth/access_token") return new Response("", { status: 404 });
    const body = new URLSearchParams(await request.text()),
      grant = body.get("grant_type");
    if (grant === "urn:ietf:params:oauth:grant-type:device_code") {
      state.polls++;
      if (state.deny) return jsonResponse({ error: "access_denied" });
      if (!state.allow || state.polls < 3) return jsonResponse({ error: "authorization_pending" });
      return jsonResponse({
        access_token: "gho_device_access_1",
        token_type: "bearer",
        scope: "repo,read:org",
        expires_in: 3600,
        refresh_token: "ghr_refresh_1",
      });
    }
    if (grant === "refresh_token") {
      state.refreshes.push(Object.fromEntries(body));
      return jsonResponse({
        access_token: "gho_refreshed_access_2",
        token_type: "bearer",
        scope: "repo,read:org",
        expires_in: 3600,
        refresh_token: "ghr_refresh_2",
      });
    }
    if (grant === "authorization_code") {
      const hash = createHash("sha256")
        .update(body.get("code_verifier") ?? "")
        .digest("base64url");
      if (body.get("code") !== "pkce-code-1" || hash !== state.challenge)
        return jsonResponse({ error: "invalid_grant" });
      return jsonResponse({
        access_token: "gho_pkce_access_1",
        token_type: "bearer",
        scope: "repo read:org",
      });
    }
    return jsonResponse({ error: "unsupported_grant_type" });
  },
});
const base = `http://127.0.0.1:${server.port}`,
  T0 = 1_800_000_000_000,
  HOUR = 3_600_000;
const definition = (kind: "oauth-device" | "oauth-pkce"): OAuthConnectorAuthDefinition => ({
  kind,
  clientIdEnv: "LOCAL_STUDIO_TEST_GITHUB_CLIENT_ID",
  ...(kind === "oauth-device"
    ? { deviceUrl: `${base}/login/device/code` }
    : { authorizeUrl: `${base}/authorize` }),
  tokenUrl: `${base}/login/oauth/access_token`,
  scopes: ["repo", "read:org"],
  tokenEnv: "GITHUB_PERSONAL_ACCESS_TOKEN",
  identityUrl: `${base}/user`,
  identityField: "login",
  createClientUrl: `${base}/settings/applications/new`,
  setupHint: "test",
});
const deps = (now: number, kind: "oauth-device" | "oauth-pkce"): OAuthConnectorDependencies => ({
  fetch,
  now: () => now,
  random: randomBytes,
  definitions: { github: definition(kind) },
});
const status = (kind: "oauth-device" | "oauth-pkce" = "oauth-device") =>
  oauth.getOAuthConnectorStatus("github", deps(T0, kind));
const rows = async () => (await listConnectors()).find(({ id }) => id === "github");
const tokens = () => readFileSync(oauth.resolveOAuthTokensFilePath(), "utf8");
afterAll(() => {
  server.stop(true);
  cleanTemps();
});

test("device flow polls, persists, and exposes status", async () => {
  await oauth.saveOAuthConnectorClient("github", "test-client-id");
  const begun = await oauth.beginOAuthConnectorAuthorization("github", deps(T0, "oauth-device"));
  if (begun.flow !== "device") throw new Error("expected device flow");
  expect(begun.userCode).toBe("ABCD-1234");
  expect(begun.verificationUri).toBe(`${base}/activate`);
  const settled = oauth.oauthConnectorFlowSettled("github");
  const pending = await status();
  expect(pending.connected).toBe(false);
  expect(pending.pending?.userCode).toBe("ABCD-1234");
  state.allow = true;
  await settled;
  const connected = await status();
  expect(connected.connected).toBe(true);
  expect(connected.account).toBe("octocat");
  expect(connected.scopes).toEqual(["repo", "read:org"]);
  expect(connected.pending).toBeNull();
  expect(state.polls).toBeGreaterThanOrEqual(3);
});

test("token storage is private and status redacts secrets", async () => {
  const file = oauth.resolveOAuthTokensFilePath();
  expect(existsSync(file)).toBe(true);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(tokens()).toContain("gho_device_access_1");
  expect(tokens()).toContain("ghr_refresh_1");
  const rendered = JSON.stringify(await status());
  expect(rendered).not.toContain("gho_device_access_1");
  expect(rendered).not.toContain("ghr_refresh_1");
});

test("connecting writes a disabled OAuth connector row without token env", async () => {
  const row = await rows();
  expect(row).toBeDefined();
  expect(row?.auth).toEqual({ type: "oauth", provider: "github", account: "octocat" });
  expect(row?.command).toBe("npx");
  expect(row?.enabled).toBe(false);
  expect(row?.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBeUndefined();
  expect(row?.name).toBe("GitHub · octocat");
});

test("pool injects access tokens but not refresh tokens", async () => {
  const row = await rows();
  if (!row) throw new Error("github row missing");
  const target = await resolveConnectorTarget(row, undefined, deps(T0, "oauth-device"));
  if (target.transport !== "stdio") throw new Error("expected stdio target");
  expect(target.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("gho_device_access_1");
  expect(JSON.stringify(target)).not.toContain("ghr_refresh_1");
});

test("provider impostor rows get no token", async () => {
  const row: ConnectorConfig = {
    id: "not-github",
    name: "impostor",
    transport: "stdio",
    command: "env",
    auth: { type: "oauth", provider: "github", account: "octocat" },
    enabled: true,
  };
  expect(await oauth.oauthConnectorSpawnEnv(row, deps(T0, "oauth-device"))).toEqual({});
});

test("expiring tokens refresh once and persist rotation", async () => {
  const at = T0 + HOUR - 30_000;
  expect(await oauth.freshOAuthConnectorAccessToken("github", deps(at, "oauth-device"))).toBe(
    "gho_refreshed_access_2",
  );
  expect(state.refreshes).toHaveLength(1);
  expect(state.refreshes[0]?.refresh_token).toBe("ghr_refresh_1");
  expect(tokens()).toContain("ghr_refresh_2");
  expect(tokens()).not.toContain("ghr_refresh_1");
  const row = await rows();
  if (!row) throw new Error("github row missing");
  const target = await resolveConnectorTarget(row, undefined, deps(at, "oauth-device"));
  if (target.transport !== "stdio") throw new Error("expected stdio target");
  expect(target.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("gho_refreshed_access_2");
  expect(state.refreshes).toHaveLength(1);
});

test("declined device flow reports failure and preserves old grant", async () => {
  state.deny = true;
  await oauth.beginOAuthConnectorAuthorization("github", deps(T0, "oauth-device"));
  await oauth.oauthConnectorFlowSettled("github");
  state.deny = false;
  const result = await status();
  expect(result.error).toContain("declined");
  expect(result.connected).toBe(true);
});

test("disconnect destroys grants and strips OAuth row state", async () => {
  const result = await oauth.disconnectOAuthConnector("github");
  expect(result.connected).toBe(false);
  expect(result.account).toBeNull();
  expect(tokens()).not.toContain("gho_");
  expect(tokens()).not.toContain("ghr_");
  const row = await rows();
  expect(row?.auth).toBeUndefined();
  expect(row?.enabled).toBe(false);
  await expect(
    oauth.freshOAuthConnectorAccessToken("github", deps(T0, "oauth-device")),
  ).rejects.toThrow("not connected");
});

test("PKCE loopback rejects forged state and verifies S256 exchange", async () => {
  const begun = await oauth.beginOAuthConnectorAuthorization("github", deps(T0, "oauth-pkce"));
  if (begun.flow !== "pkce") throw new Error("expected pkce flow");
  const authorize = new URL(begun.authorizeUrl);
  expect(authorize.origin).toBe(base);
  expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authorize.searchParams.get("client_id")).toBe("test-client-id");
  const redirect = authorize.searchParams.get("redirect_uri") ?? "";
  expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  state.challenge = authorize.searchParams.get("code_challenge");
  expect((await fetch(`${redirect}?state=wrong&code=pkce-code-1`)).status).toBe(400);
  const retry = await oauth.beginOAuthConnectorAuthorization("github", deps(T0, "oauth-pkce"));
  if (retry.flow !== "pkce") throw new Error("expected pkce flow");
  const next = new URL(retry.authorizeUrl);
  state.challenge = next.searchParams.get("code_challenge");
  const callback = await fetch(
    `${next.searchParams.get("redirect_uri")}?state=${encodeURIComponent(
      next.searchParams.get("state") ?? "",
    )}&code=pkce-code-1`,
  );
  expect(callback.status).toBe(200);
  expect(await callback.text()).toContain("connected");
  const result = await status("oauth-pkce");
  expect(result.connected).toBe(true);
  expect(result.account).toBe("octocat");
});

test("replacing client ids drops their grant", async () => {
  await oauth.saveOAuthConnectorClient("github", "another-client-id");
  const result = await status();
  expect(result.configured).toBe(true);
  expect(result.connected).toBe(false);
});

test("unknown connectors are refused", async () => {
  await expect(oauth.beginOAuthConnectorAuthorization("nope")).rejects.toThrow(
    "not an OAuth-capable",
  );
});
