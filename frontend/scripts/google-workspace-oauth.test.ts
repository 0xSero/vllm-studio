import assert from "node:assert/strict";
import { mkdir, readFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Effect, Schema } from "effect";
import {
  beginGoogleAuthorization,
  cancelGoogleAuthorization,
  clearGoogleAuthorizationCache,
  completeGoogleAuthorization,
  completeGoogleAuthorizationWithActivation,
  createGoogleAuthorizationFlow,
  disconnectGoogleAccount,
  getGoogleAccount,
  googleAuthorizationHeaders,
  resolveGoogleAccountFilePath,
  saveGoogleClient,
  type GoogleOAuthDependencies,
} from "../../services/agent-runtime/src/google-account";
import { googleWorkspaceConnector } from "../../services/agent-runtime/src/google-workspace-adapter";
import { connectorAuthorizationHeaders } from "../../services/agent-runtime/src/connector-auth";
import { connectMcp } from "../../services/agent-runtime/src/mcp-client";
import {
  callConnectorTool,
  ConnectorToolDeniedError,
} from "../../services/agent-runtime/src/connector-pool";
import { OAuthVaultError, type OAuthVault } from "../../services/agent-runtime/src/oauth-vault";
import { listPluginRuntimeViews } from "../../services/agent-runtime/src/plugin-runtime";
import {
  listConnectors,
  removeConnector,
  resolveConnectorsFilePath,
  upsertConnector,
} from "../../services/agent-runtime/src/connectors-service";

function memoryVault(): { vault: OAuthVault; values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    vault: {
      read: (key) => Effect.succeed(values.get(key)),
      write: (key, value) => Effect.sync(() => void values.set(key, value)),
      remove: (key) => Effect.sync(() => void values.delete(key)),
    },
  };
}

function required<A>(value: A | null | undefined): A {
  assert.ok(value !== null && value !== undefined);
  return value;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const McpMessageSchema = Schema.Struct({
  id: Schema.Number,
  method: Schema.String,
  params: Schema.optional(Schema.Struct({ name: Schema.optional(Schema.String) })),
});

test("Google OAuth keeps secrets in the vault and binds tokens to each MCP resource", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-google-oauth-"));
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  process.env.LOCAL_STUDIO_DATA_DIR = root;
  const { vault, values } = memoryVault();
  let randomValue = 1;
  const tokenBodies: URLSearchParams[] = [];
  const revokedTokens: string[] = [];
  const verifiedAccess: Array<{ account: string; token: string }> = [];
  const mockFetch: typeof fetch = async (input, init) => {
    assert.ok(init?.signal instanceof AbortSignal);
    const url = String(input);
    if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer initial-access");
      return Response.json({ email: "operator@example.com" });
    }
    if (url === "https://oauth2.googleapis.com/revoke") {
      revokedTokens.push(new URLSearchParams(String(init?.body)).get("token") ?? "");
      return new Response(null, { status: 200 });
    }
    assert.equal(url, "https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(String(init?.body));
    tokenBodies.push(body);
    if (body.get("grant_type") === "refresh_token") {
      return Response.json({
        access_token: "refreshed-access",
        refresh_token: "rotated-refresh-secret",
        expires_in: 3600,
      });
    }
    return Response.json({
      access_token: "initial-access",
      refresh_token: "refresh-secret",
      expires_in: 3600,
      scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
    });
  };
  const dependencies: GoogleOAuthDependencies = {
    fetch: mockFetch,
    now: () => 1_800_000_000_000,
    random: (size) => Buffer.alloc(size, randomValue++),
    verifyAccess: async (account, token) => {
      verifiedAccess.push({ account, token });
    },
  };
  context.after(async () => {
    clearGoogleAuthorizationCache();
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  });

  const configured = await Effect.runPromise(
    saveGoogleClient(
      { clientId: "desktop.apps.googleusercontent.com", clientSecret: "client-secret" },
      vault,
    ),
  );
  assert.equal(configured.configured, true);
  assert.equal(configured.hasClientSecret, true);

  const started = await Effect.runPromise(
    beginGoogleAuthorization("gmail", "http://127.0.0.1:49152/callback", dependencies, vault),
  );
  const authorizationUrl = new URL(started.authorizationUrl);
  assert.equal(authorizationUrl.origin, "https://accounts.google.com");
  assert.equal(
    authorizationUrl.searchParams.get("resource"),
    "https://gmailmcp.googleapis.com/mcp",
  );
  assert.match(required(authorizationUrl.searchParams.get("scope")), /gmail\.readonly/);
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    authorizationUrl.searchParams.get("redirect_uri"),
    "http://127.0.0.1:49152/callback",
  );

  const state = authorizationUrl.searchParams.get("state");
  assert.ok(state);
  const connected = await Effect.runPromise(
    completeGoogleAuthorization(
      "gmail",
      { state, code: "authorization-code" },
      dependencies,
      vault,
    ),
  );
  assert.equal(connected.connections.gmail.email, "operator@example.com");
  assert.equal(connected.connections.gmail.resource, "https://gmailmcp.googleapis.com/mcp");
  const initialTokenBody = required(tokenBodies[0]);
  assert.equal(initialTokenBody.get("resource"), "https://gmailmcp.googleapis.com/mcp");
  assert.equal(initialTokenBody.get("client_secret"), "client-secret");
  assert.equal(required(initialTokenBody.get("code_verifier")).length, 86);
  assert.deepEqual(verifiedAccess, [{ account: "gmail", token: "initial-access" }]);

  const plugins = await Effect.runPromise(
    listPluginRuntimeViews([
      {
        label: "Local Studio",
        dir: path.resolve("desktop/resources/plugins"),
        priority: 1,
      },
    ]),
  );
  const gmail = required(plugins.find((plugin) => plugin.id === "gmail"));
  const calendarPlugin = required(plugins.find((plugin) => plugin.id === "google-calendar"));
  assert.equal(gmail.source, "Local Studio");
  assert.equal(required(gmail.account).id, "gmail");
  assert.equal(required(gmail.account).connected, true);
  assert.equal(gmail.tools.state, "available");
  assert.equal(required(calendarPlugin.account).connected, false);
  assert.equal(calendarPlugin.tools.state, "configuration_required");

  await upsertConnector(googleWorkspaceConnector("gmail", true));
  const storedConnector = required(
    (await listConnectors()).find((connector) => connector.id === "account-google-gmail"),
  );
  assert.deepEqual(storedConnector.auth, {
    type: "oauth",
    provider: "google-workspace",
    account: "gmail",
  });
  const connectorFile = await readFile(resolveConnectorsFilePath(), "utf8");
  assert.doesNotMatch(connectorFile, /client-secret|refresh-secret|initial-access/);
  await assert.rejects(
    () => callConnectorTool("account-google-gmail", "create_draft", {}),
    ConnectorToolDeniedError,
  );

  const metadataPath = resolveGoogleAccountFilePath();
  const metadata = await readFile(metadataPath, "utf8");
  assert.doesNotMatch(metadata, /client-secret|refresh-secret|authorization-code|initial-access/);
  assert.equal((await stat(metadataPath)).mode & 0o777, 0o600);
  assert.match(required(values.get("google-workspace")), /refresh-secret/);

  clearGoogleAuthorizationCache();
  const headers = await Effect.runPromise(
    googleAuthorizationHeaders("gmail", false, dependencies, vault),
  );
  assert.equal(headers.Authorization, "Bearer refreshed-access");
  const refreshTokenBody = required(tokenBodies[1]);
  assert.equal(refreshTokenBody.get("grant_type"), "refresh_token");
  assert.equal(refreshTokenBody.get("resource"), "https://gmailmcp.googleapis.com/mcp");
  assert.match(required(values.get("google-workspace")), /rotated-refresh-secret/);

  const calendar = await Effect.runPromise(
    beginGoogleAuthorization(
      "google-calendar",
      "http://127.0.0.1:49153/callback",
      dependencies,
      vault,
    ),
  );
  const calendarUrl = new URL(calendar.authorizationUrl);
  assert.equal(
    calendarUrl.searchParams.get("resource"),
    "https://calendarmcp.googleapis.com/mcp/v1",
  );
  assert.match(required(calendarUrl.searchParams.get("scope")), /calendar\.events\.freebusy/);

  const disconnected = await Effect.runPromise(
    disconnectGoogleAccount("gmail", vault, dependencies),
  );
  assert.equal(disconnected.connections.gmail.connected, false);
  assert.equal(disconnected.connections["google-calendar"].connected, false);
  assert.equal(disconnected.configured, true);
  assert.deepEqual(revokedTokens, ["rotated-refresh-secret"]);
  assert.doesNotMatch(required(values.get("google-workspace")), /refresh-secret/);
});

test("Google OAuth rejects wrong and expired state before token exchange", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-google-state-"));
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  process.env.LOCAL_STUDIO_DATA_DIR = root;
  const { vault } = memoryVault();
  let now = 1_800_000_000_000;
  let fetchCount = 0;
  const dependencies: GoogleOAuthDependencies = {
    fetch: async () => {
      fetchCount += 1;
      return Response.json({});
    },
    now: () => now,
    random: (size) => Buffer.alloc(size, 7),
    verifyAccess: async () => undefined,
  };
  context.after(async () => {
    clearGoogleAuthorizationCache();
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  });

  await Effect.runPromise(saveGoogleClient({ clientId: "desktop-client" }, vault));
  const started = await Effect.runPromise(
    beginGoogleAuthorization("gmail", "http://127.0.0.1:49200/callback", dependencies, vault),
  );
  const state = new URL(started.authorizationUrl).searchParams.get("state");
  assert.ok(state);
  await assert.rejects(
    Effect.runPromise(
      completeGoogleAuthorization(
        "gmail",
        { state: "wrong-state", code: "code" },
        dependencies,
        vault,
      ),
    ),
    /state is invalid/,
  );
  now += 11 * 60 * 1000;
  await assert.rejects(
    Effect.runPromise(
      completeGoogleAuthorization("gmail", { state, code: "code" }, dependencies, vault),
    ),
    /expired/,
  );
  assert.equal(fetchCount, 0);
});

test("Google OAuth cancels pending flows and verifies scopes and live read-only access", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-google-verification-"));
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  process.env.LOCAL_STUDIO_DATA_DIR = root;
  const { vault, values } = memoryVault();
  let tokenScope = "openid email";
  let verificationFails = false;
  let verificationCount = 0;
  let tokenExchangeCount = 0;
  const dependencies: GoogleOAuthDependencies = {
    fetch: async (input) => {
      const url = String(input);
      if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
        return Response.json({ email: "operator@example.com" });
      }
      tokenExchangeCount += 1;
      return Response.json({
        access_token: "access-token",
        refresh_token: "refresh-token",
        scope: tokenScope,
      });
    },
    now: () => 1_800_000_000_000,
    random: (size) => Buffer.alloc(size, tokenExchangeCount + 1),
    verifyAccess: async () => {
      verificationCount += 1;
      if (verificationFails) throw new Error("verification failed");
    },
  };
  context.after(async () => {
    clearGoogleAuthorizationCache();
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  });

  await Effect.runPromise(saveGoogleClient({ clientId: "desktop-client" }, vault));
  const cancelled = await Effect.runPromise(
    beginGoogleAuthorization("gmail", "http://127.0.0.1:49210/callback", dependencies, vault),
  );
  const cancelledState = new URL(cancelled.authorizationUrl).searchParams.get("state");
  assert.ok(cancelledState);
  await Effect.runPromise(cancelGoogleAuthorization("gmail", vault));
  await assert.rejects(
    Effect.runPromise(
      completeGoogleAuthorization(
        "gmail",
        { state: cancelledState, code: "cancelled" },
        dependencies,
        vault,
      ),
    ),
    /state is invalid/,
  );
  assert.equal(tokenExchangeCount, 0);

  const incomplete = await Effect.runPromise(
    beginGoogleAuthorization("gmail", "http://127.0.0.1:49211/callback", dependencies, vault),
  );
  const incompleteState = new URL(incomplete.authorizationUrl).searchParams.get("state");
  assert.ok(incompleteState);
  await assert.rejects(
    Effect.runPromise(
      completeGoogleAuthorization(
        "gmail",
        { state: incompleteState, code: "incomplete" },
        dependencies,
        vault,
      ),
    ),
    /required read-only scope/,
  );
  assert.equal(verificationCount, 0);

  tokenScope = "openid email https://www.googleapis.com/auth/gmail.readonly";
  verificationFails = true;
  const unverifiable = await Effect.runPromise(
    beginGoogleAuthorization("gmail", "http://127.0.0.1:49212/callback", dependencies, vault),
  );
  const unverifiableState = new URL(unverifiable.authorizationUrl).searchParams.get("state");
  assert.ok(unverifiableState);
  await assert.rejects(
    Effect.runPromise(
      completeGoogleAuthorization(
        "gmail",
        { state: unverifiableState, code: "unverifiable" },
        dependencies,
        vault,
      ),
    ),
    /OAuth request failed/,
  );
  assert.equal(verificationCount, 1);
  assert.equal((await Effect.runPromise(getGoogleAccount())).connections.gmail.connected, false);
  assert.doesNotMatch(values.get("google-workspace") ?? "", /refresh-token/);
});

test("Google OAuth cancellation invalidates an in-flight callback before persistence", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-google-cancel-race-"));
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  process.env.LOCAL_STUDIO_DATA_DIR = root;
  const { vault, values } = memoryVault();
  const exchangeStarted = deferred();
  const releaseExchange = deferred();
  const dependencies: GoogleOAuthDependencies = {
    fetch: async (input) => {
      if (String(input) === "https://oauth2.googleapis.com/token") {
        exchangeStarted.resolve();
        await releaseExchange.promise;
        return Response.json({
          access_token: "cancelled-access",
          refresh_token: "cancelled-refresh",
          scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
        });
      }
      return Response.json({ email: "operator@example.com" });
    },
    now: () => 1_800_000_000_000,
    random: (size) => Buffer.alloc(size, 11),
    verifyAccess: async () => undefined,
  };
  context.after(async () => {
    clearGoogleAuthorizationCache();
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  });

  await Effect.runPromise(saveGoogleClient({ clientId: "desktop-client" }, vault));
  const started = await Effect.runPromise(
    beginGoogleAuthorization("gmail", "http://127.0.0.1:49213/callback", dependencies, vault),
  );
  const state = required(new URL(started.authorizationUrl).searchParams.get("state"));
  const completion = Effect.runPromise(
    completeGoogleAuthorization("gmail", { state, code: "code" }, dependencies, vault),
  );
  await exchangeStarted.promise;
  const cancellation = Effect.runPromise(cancelGoogleAuthorization("gmail", vault));
  await Promise.resolve();
  releaseExchange.resolve();
  await assert.rejects(completion, /cancelled or replaced/);
  await cancellation;
  assert.equal((await Effect.runPromise(getGoogleAccount())).connections.gmail.connected, false);
  assert.doesNotMatch(values.get("google-workspace") ?? "", /cancelled-refresh/);
});

test("Google OAuth cancellation aborts live verification without persisting", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-google-verify-cancel-"));
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  process.env.LOCAL_STUDIO_DATA_DIR = root;
  const { vault, values } = memoryVault();
  const verificationStarted = deferred();
  const verificationAborted = deferred();
  const dependencies: GoogleOAuthDependencies = {
    fetch: async (input) =>
      String(input) === "https://oauth2.googleapis.com/token"
        ? Response.json({
            access_token: "verify-access",
            refresh_token: "verify-refresh",
            scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
          })
        : Response.json({ email: "operator@example.com" }),
    now: () => 1_800_000_000_000,
    random: (size) => Buffer.alloc(size, 12),
    verifyAccess: async (_account, _token, signal) => {
      verificationStarted.resolve();
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          verificationAborted.resolve();
          resolve();
        });
      });
    },
  };
  context.after(async () => {
    clearGoogleAuthorizationCache();
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  });

  await Effect.runPromise(saveGoogleClient({ clientId: "desktop-client" }, vault));
  const started = await Effect.runPromise(
    beginGoogleAuthorization("gmail", "http://127.0.0.1:49218/callback", dependencies, vault),
  );
  const state = required(new URL(started.authorizationUrl).searchParams.get("state"));
  const completion = Effect.runPromise(
    completeGoogleAuthorization("gmail", { state, code: "code" }, dependencies, vault),
  );
  await verificationStarted.promise;
  const cancellation = Effect.runPromise(cancelGoogleAuthorization("gmail", vault));
  await verificationAborted.promise;
  await assert.rejects(completion, /cancelled or replaced/);
  await cancellation;
  assert.equal((await Effect.runPromise(getGoogleAccount())).connections.gmail.connected, false);
  assert.doesNotMatch(values.get("google-workspace") ?? "", /verify-refresh/);
});

test("Failed cancellation revocation stays encrypted and retries before a new flow", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-google-pending-revoke-"));
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  process.env.LOCAL_STUDIO_DATA_DIR = root;
  const { vault, values } = memoryVault();
  let revocationOffline = true;
  let revocationCount = 0;
  const dependencies: GoogleOAuthDependencies = {
    fetch: async (input) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/revoke") {
        revocationCount += 1;
        if (revocationOffline) throw new Error("offline");
        return new Response(null, { status: 200 });
      }
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({
          access_token: "pending-access",
          refresh_token: "pending-refresh",
          scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
        });
      }
      return Response.json({ email: "operator@example.com" });
    },
    now: () => 1_800_000_000_000,
    random: (size) => Buffer.alloc(size, 17),
    verifyAccess: async () => {
      throw new Error("verification failed");
    },
  };
  context.after(async () => {
    clearGoogleAuthorizationCache();
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  });

  await Effect.runPromise(saveGoogleClient({ clientId: "desktop-client" }, vault));
  const first = await Effect.runPromise(
    beginGoogleAuthorization("gmail", "http://127.0.0.1:49223/callback", dependencies, vault),
  );
  const state = required(new URL(first.authorizationUrl).searchParams.get("state"));
  await assert.rejects(
    Effect.runPromise(
      completeGoogleAuthorization("gmail", { state, code: "code" }, dependencies, vault),
    ),
    /OAuth request failed/,
  );
  assert.match(values.get("google-workspace") ?? "", /pending-refresh/);
  revocationOffline = false;
  const second = await Effect.runPromise(
    beginGoogleAuthorization("gmail", "http://127.0.0.1:49224/callback", dependencies, vault),
  );
  assert.ok(new URL(second.authorizationUrl).searchParams.get("state"));
  assert.equal(revocationCount, 2);
  assert.doesNotMatch(values.get("google-workspace") ?? "", /pending-refresh/);
  await Effect.runPromise(cancelGoogleAuthorization("gmail", vault));
});

test("Google revokes directly when the encrypted retry queue is unavailable", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-google-revoke-fallback-"));
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  process.env.LOCAL_STUDIO_DATA_DIR = root;
  const memory = memoryVault();
  let rejectWrites = false;
  let revocationCount = 0;
  const vault: OAuthVault = {
    ...memory.vault,
    write: (key, value) =>
      rejectWrites ? Effect.fail(new OAuthVaultError("locked")) : memory.vault.write(key, value),
  };
  const dependencies: GoogleOAuthDependencies = {
    fetch: async (input) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/revoke") {
        revocationCount += 1;
        return new Response(null, { status: 200 });
      }
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({
          access_token: "fallback-access",
          refresh_token: "fallback-refresh",
          scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
        });
      }
      return Response.json({ email: "operator@example.com" });
    },
    now: () => 1_800_000_000_000,
    random: (size) => Buffer.alloc(size, 19),
    verifyAccess: async () => {
      throw new Error("verification failed");
    },
  };
  context.after(async () => {
    clearGoogleAuthorizationCache();
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  });

  await Effect.runPromise(saveGoogleClient({ clientId: "desktop-client" }, vault));
  const started = await Effect.runPromise(
    beginGoogleAuthorization("gmail", "http://127.0.0.1:49227/callback", dependencies, vault),
  );
  const state = required(new URL(started.authorizationUrl).searchParams.get("state"));
  rejectWrites = true;
  await assert.rejects(
    Effect.runPromise(
      completeGoogleAuthorization("gmail", { state, code: "code" }, dependencies, vault),
    ),
    /OAuth request failed/,
  );
  assert.equal(revocationCount, 1);
  assert.doesNotMatch(memory.values.get("google-workspace") ?? "", /fallback-refresh/);
});

test("Google rollback preserves another account token rotated during activation", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-google-rollback-merge-"));
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  process.env.LOCAL_STUDIO_DATA_DIR = root;
  const { vault, values } = memoryVault();
  const activationStarted = deferred();
  let tokenCount = 0;
  const dependencies: GoogleOAuthDependencies = {
    fetch: async (input, init) => {
      const url = String(input);
      if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
        return Response.json({ email: "operator@example.com" });
      }
      if (url === "https://oauth2.googleapis.com/revoke") {
        return new Response(null, { status: 200 });
      }
      tokenCount += 1;
      const body = new URLSearchParams(String(init?.body));
      if (body.get("grant_type") === "refresh_token") {
        return Response.json({
          access_token: "calendar-access-rotated",
          refresh_token: "calendar-refresh-rotated",
          expires_in: 3600,
        });
      }
      const calendar = body.get("resource")?.includes("calendar") ?? false;
      return Response.json({
        access_token: calendar ? "calendar-access" : "gmail-access",
        refresh_token: calendar ? "calendar-refresh-old" : "gmail-refresh-new",
        scope: calendar
          ? "openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.freebusy https://www.googleapis.com/auth/calendar.events.readonly"
          : "openid email https://www.googleapis.com/auth/gmail.readonly",
      });
    },
    now: () => 1_800_000_000_000,
    random: (size) => Buffer.alloc(size, tokenCount + 18),
    verifyAccess: async () => undefined,
  };
  context.after(async () => {
    clearGoogleAuthorizationCache();
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  });

  await Effect.runPromise(saveGoogleClient({ clientId: "desktop-client" }, vault));
  const calendar = await Effect.runPromise(
    beginGoogleAuthorization(
      "google-calendar",
      "http://127.0.0.1:49225/callback",
      dependencies,
      vault,
    ),
  );
  const calendarState = required(new URL(calendar.authorizationUrl).searchParams.get("state"));
  await Effect.runPromise(
    completeGoogleAuthorization(
      "google-calendar",
      { state: calendarState, code: "calendar" },
      dependencies,
      vault,
    ),
  );
  const flowId = createGoogleAuthorizationFlow("gmail");
  const gmail = await Effect.runPromise(
    beginGoogleAuthorization(
      "gmail",
      "http://127.0.0.1:49226/callback",
      dependencies,
      vault,
      flowId,
    ),
  );
  const gmailState = required(new URL(gmail.authorizationUrl).searchParams.get("state"));
  const completion = Effect.runPromise(
    completeGoogleAuthorizationWithActivation(
      "gmail",
      { state: gmailState, code: "gmail" },
      flowId,
      (signal) =>
        Effect.promise(
          () =>
            new Promise<boolean>((resolve) => {
              activationStarted.resolve();
              signal.addEventListener("abort", () => resolve(false));
            }),
        ),
      Effect.void,
      dependencies,
      vault,
    ),
  );
  await activationStarted.promise;
  clearGoogleAuthorizationCache();
  await Effect.runPromise(googleAuthorizationHeaders("google-calendar", true, dependencies, vault));
  const cancellation = Effect.runPromise(cancelGoogleAuthorization("gmail", vault));
  await assert.rejects(completion, /cancelled or replaced/);
  await cancellation;
  const stored = values.get("google-workspace") ?? "";
  assert.match(stored, /calendar-refresh-rotated/);
  assert.doesNotMatch(stored, /gmail-refresh-new/);
  const account = await Effect.runPromise(getGoogleAccount());
  assert.equal(account.connections.gmail.connected, false);
  assert.equal(account.connections["google-calendar"].connected, true);
});

test("Google disconnect aborts adapter activation and wins the final state", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-google-disconnect-race-"));
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  process.env.LOCAL_STUDIO_DATA_DIR = root;
  const { vault } = memoryVault();
  const activationStarted = deferred();
  const activationAborted = deferred();
  let rollbackCount = 0;
  let revocationCount = 0;
  const dependencies: GoogleOAuthDependencies = {
    fetch: async (input) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/revoke") {
        revocationCount += 1;
        return new Response(null, { status: 200 });
      }
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({
          access_token: "activation-access",
          refresh_token: "activation-refresh",
          scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
        });
      }
      return Response.json({ email: "operator@example.com" });
    },
    now: () => 1_800_000_000_000,
    random: (size) => Buffer.alloc(size, 15),
    verifyAccess: async () => undefined,
  };
  context.after(async () => {
    clearGoogleAuthorizationCache();
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  });

  await Effect.runPromise(saveGoogleClient({ clientId: "desktop-client" }, vault));
  const flowId = createGoogleAuthorizationFlow("gmail");
  const started = await Effect.runPromise(
    beginGoogleAuthorization(
      "gmail",
      "http://127.0.0.1:49219/callback",
      dependencies,
      vault,
      flowId,
    ),
  );
  const state = required(new URL(started.authorizationUrl).searchParams.get("state"));
  const completion = Effect.runPromise(
    completeGoogleAuthorizationWithActivation(
      "gmail",
      { state, code: "code" },
      flowId,
      (signal) =>
        Effect.promise(
          () =>
            new Promise<boolean>((resolve) => {
              activationStarted.resolve();
              signal.addEventListener("abort", () => {
                activationAborted.resolve();
                resolve(false);
              });
            }),
        ),
      Effect.sync(() => {
        rollbackCount += 1;
      }),
      dependencies,
      vault,
    ),
  );
  await activationStarted.promise;
  const disconnection = Effect.runPromise(disconnectGoogleAccount("gmail", vault, dependencies));
  await activationAborted.promise;
  await assert.rejects(completion, /cancelled or replaced/);
  const disconnected = await disconnection;
  assert.equal(disconnected.connections.gmail.connected, false);
  assert.equal(disconnected.connections["google-calendar"].connected, false);
  assert.equal(rollbackCount, 1);
  assert.equal(revocationCount, 1);
});

test("A newer Google OAuth flow owns pending state while an older callback unwinds", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-google-flow-owner-"));
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  process.env.LOCAL_STUDIO_DATA_DIR = root;
  const { vault } = memoryVault();
  const exchangeStarted = deferred();
  const releaseExchange = deferred();
  let tokenCalls = 0;
  let randomValue = 1;
  const dependencies: GoogleOAuthDependencies = {
    fetch: async (input) => {
      if (String(input) === "https://oauth2.googleapis.com/token") {
        tokenCalls += 1;
        if (tokenCalls === 1) {
          exchangeStarted.resolve();
          await releaseExchange.promise;
        }
        return Response.json({
          access_token: `access-${tokenCalls}`,
          refresh_token: `refresh-${tokenCalls}`,
          scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
        });
      }
      return Response.json({ email: "operator@example.com" });
    },
    now: () => 1_800_000_000_000,
    random: (size) => Buffer.alloc(size, randomValue++),
    verifyAccess: async () => undefined,
  };
  context.after(async () => {
    clearGoogleAuthorizationCache();
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  });

  await Effect.runPromise(saveGoogleClient({ clientId: "desktop-client" }, vault));
  const first = await Effect.runPromise(
    beginGoogleAuthorization("gmail", "http://127.0.0.1:49214/callback", dependencies, vault),
  );
  const firstState = required(new URL(first.authorizationUrl).searchParams.get("state"));
  const firstCompletion = Effect.runPromise(
    completeGoogleAuthorization("gmail", { state: firstState, code: "first" }, dependencies, vault),
  );
  await exchangeStarted.promise;
  const secondStart = Effect.runPromise(
    beginGoogleAuthorization("gmail", "http://127.0.0.1:49215/callback", dependencies, vault),
  );
  await Promise.resolve();
  releaseExchange.resolve();
  await assert.rejects(firstCompletion, /cancelled or replaced/);
  const second = await secondStart;
  const secondState = required(new URL(second.authorizationUrl).searchParams.get("state"));
  const connected = await Effect.runPromise(
    completeGoogleAuthorization(
      "gmail",
      { state: secondState, code: "second" },
      dependencies,
      vault,
    ),
  );
  assert.equal(connected.connections.gmail.connected, true);
  assert.equal(tokenCalls, 2);
});

test("Replacing a Google client revokes first and retains the old account on failure", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-google-client-replace-"));
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  process.env.LOCAL_STUDIO_DATA_DIR = root;
  const { vault, values } = memoryVault();
  let revocationFails = true;
  const revoked: string[] = [];
  const dependencies: GoogleOAuthDependencies = {
    fetch: async (input, init) => {
      if (String(input) === "https://oauth2.googleapis.com/revoke") {
        revoked.push(new URLSearchParams(String(init?.body)).get("token") ?? "");
        if (revocationFails) throw new Error("offline");
        return new Response(null, { status: 200 });
      }
      if (String(input) === "https://oauth2.googleapis.com/token") {
        return Response.json({
          access_token: "old-access",
          refresh_token: "old-refresh",
          scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
        });
      }
      return Response.json({ email: "operator@example.com" });
    },
    now: () => 1_800_000_000_000,
    random: (size) => Buffer.alloc(size, 13),
    verifyAccess: async () => undefined,
  };
  context.after(async () => {
    clearGoogleAuthorizationCache();
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  });

  await Effect.runPromise(saveGoogleClient({ clientId: "old-client" }, vault));
  const started = await Effect.runPromise(
    beginGoogleAuthorization("gmail", "http://127.0.0.1:49216/callback", dependencies, vault),
  );
  const state = required(new URL(started.authorizationUrl).searchParams.get("state"));
  await Effect.runPromise(
    completeGoogleAuthorization("gmail", { state, code: "code" }, dependencies, vault),
  );
  await assert.rejects(
    Effect.runPromise(saveGoogleClient({ clientId: "new-client" }, vault, dependencies)),
    /OAuth request failed/,
  );
  const retained = await Effect.runPromise(getGoogleAccount());
  assert.equal(retained.clientId, "old-client");
  assert.equal(retained.connections.gmail.connected, true);
  assert.match(values.get("google-workspace") ?? "", /old-refresh/);
  revocationFails = false;
  const replaced = await Effect.runPromise(
    saveGoogleClient({ clientId: "new-client" }, vault, dependencies),
  );
  assert.equal(replaced.clientId, "new-client");
  assert.equal(replaced.connections.gmail.connected, false);
  assert.deepEqual(revoked, ["old-refresh", "old-refresh"]);
  assert.doesNotMatch(values.get("google-workspace") ?? "", /old-refresh/);
});

test("Successful revocation converges locally when secure cleanup fails", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-google-revoke-compensation-"));
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  process.env.LOCAL_STUDIO_DATA_DIR = root;
  const memory = memoryVault();
  let rejectWrites = false;
  let revocationCount = 0;
  const vault: OAuthVault = {
    ...memory.vault,
    write: (key, value) =>
      rejectWrites ? Effect.fail(new OAuthVaultError("locked")) : memory.vault.write(key, value),
  };
  const dependencies: GoogleOAuthDependencies = {
    fetch: async (input) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/revoke") {
        revocationCount += 1;
        return new Response(null, { status: 200 });
      }
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({
          access_token: "compensation-access",
          refresh_token: "compensation-refresh",
          scope: "openid email https://www.googleapis.com/auth/gmail.readonly",
        });
      }
      return Response.json({ email: "operator@example.com" });
    },
    now: () => 1_800_000_000_000,
    random: (size) => Buffer.alloc(size, 16),
    verifyAccess: async () => undefined,
  };
  context.after(async () => {
    clearGoogleAuthorizationCache();
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  });

  await Effect.runPromise(saveGoogleClient({ clientId: "desktop-client" }, vault));
  const started = await Effect.runPromise(
    beginGoogleAuthorization("gmail", "http://127.0.0.1:49222/callback", dependencies, vault),
  );
  const state = required(new URL(started.authorizationUrl).searchParams.get("state"));
  await Effect.runPromise(
    completeGoogleAuthorization("gmail", { state, code: "code" }, dependencies, vault),
  );
  await upsertConnector(googleWorkspaceConnector("gmail", true));
  rejectWrites = true;
  await assert.rejects(
    Effect.runPromise(disconnectGoogleAccount("gmail", vault, dependencies)),
    /Secure OAuth storage is unavailable/,
  );
  const account = await Effect.runPromise(getGoogleAccount());
  assert.equal(account.connections.gmail.connected, false);
  assert.equal(account.connections["google-calendar"].connected, false);
  assert.equal(revocationCount, 1);
  assert.match(memory.values.get("google-workspace") ?? "", /compensation-refresh/);
  assert.equal(
    (await listConnectors())
      .filter((connector) => connector.origin?.binding === "google-workspace")
      .every((connector) => !connector.enabled),
    true,
  );
});

test("Google OAuth direct requests abort at the configured deadline", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-google-timeout-"));
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  process.env.LOCAL_STUDIO_DATA_DIR = root;
  const { vault } = memoryVault();
  const observedSignals: AbortSignal[] = [];
  const dependencies: GoogleOAuthDependencies = {
    fetch: async (_input, init) => {
      const signal = required(init?.signal);
      observedSignals.push(signal);
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
    now: () => 1_800_000_000_000,
    random: (size) => Buffer.alloc(size, 14),
    requestTimeoutMs: 5,
    verifyAccess: async () => undefined,
  };
  context.after(async () => {
    clearGoogleAuthorizationCache();
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  });

  await Effect.runPromise(saveGoogleClient({ clientId: "desktop-client" }, vault));
  const started = await Effect.runPromise(
    beginGoogleAuthorization("gmail", "http://127.0.0.1:49217/callback", dependencies, vault),
  );
  const state = required(new URL(started.authorizationUrl).searchParams.get("state"));
  await assert.rejects(
    Effect.runPromise(
      completeGoogleAuthorization("gmail", { state, code: "code" }, dependencies, vault),
    ),
    /timed out/,
  );
  assert.equal(observedSignals[0]?.aborted, true);
});

test("Concurrent Google connections persist together and one revoke clears the shared grant", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-google-concurrency-"));
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  process.env.LOCAL_STUDIO_DATA_DIR = root;
  const { vault, values } = memoryVault();
  let revocationAttempts = 0;
  let revocationOffline = true;
  const dependencies: GoogleOAuthDependencies = {
    fetch: async (input, init) => {
      const url = String(input);
      if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
        return Response.json({ email: "operator@example.com" });
      }
      if (url === "https://oauth2.googleapis.com/revoke") {
        revocationAttempts += 1;
        if (revocationOffline) throw new Error("offline");
        return new Response(null, { status: 200 });
      }
      const body = new URLSearchParams(String(init?.body));
      const calendar = body.get("resource")?.includes("calendar") ?? false;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json({
        access_token: calendar ? "calendar-access" : "gmail-access",
        refresh_token: calendar ? "calendar-refresh" : "gmail-refresh",
        scope: calendar
          ? "openid email https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.freebusy https://www.googleapis.com/auth/calendar.events.readonly"
          : "openid email https://www.googleapis.com/auth/gmail.readonly",
      });
    },
    now: () => 1_800_000_000_000,
    random: (size) => Buffer.alloc(size, size),
    verifyAccess: async () => undefined,
  };
  context.after(async () => {
    clearGoogleAuthorizationCache();
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  });

  await Effect.runPromise(saveGoogleClient({ clientId: "desktop-client" }, vault));
  const [gmailStart, calendarStart] = await Promise.all([
    Effect.runPromise(
      beginGoogleAuthorization("gmail", "http://127.0.0.1:49220/callback", dependencies, vault),
    ),
    Effect.runPromise(
      beginGoogleAuthorization(
        "google-calendar",
        "http://127.0.0.1:49221/callback",
        dependencies,
        vault,
      ),
    ),
  ]);
  const gmailState = new URL(gmailStart.authorizationUrl).searchParams.get("state");
  const calendarState = new URL(calendarStart.authorizationUrl).searchParams.get("state");
  assert.ok(gmailState);
  assert.ok(calendarState);
  await Promise.all([
    Effect.runPromise(
      completeGoogleAuthorization(
        "gmail",
        { state: gmailState, code: "gmail-code" },
        dependencies,
        vault,
      ),
    ),
    Effect.runPromise(
      completeGoogleAuthorization(
        "google-calendar",
        { state: calendarState, code: "calendar-code" },
        dependencies,
        vault,
      ),
    ),
  ]);
  const connected = await Effect.runPromise(getGoogleAccount());
  assert.equal(connected.connections.gmail.connected, true);
  assert.equal(connected.connections["google-calendar"].connected, true);
  assert.match(values.get("google-workspace") ?? "", /gmail-refresh/);
  assert.match(values.get("google-workspace") ?? "", /calendar-refresh/);

  await Promise.all([
    upsertConnector(googleWorkspaceConnector("gmail", true)),
    upsertConnector(googleWorkspaceConnector("google-calendar", true)),
  ]);
  await assert.rejects(
    Effect.runPromise(disconnectGoogleAccount("gmail", vault, dependencies)),
    /OAuth request failed/,
  );
  const retained = await Effect.runPromise(getGoogleAccount());
  assert.equal(retained.connections.gmail.connected, true);
  assert.equal(retained.connections["google-calendar"].connected, true);
  assert.match(values.get("google-workspace") ?? "", /gmail-refresh|calendar-refresh/);
  revocationOffline = false;
  const disconnected = await Effect.runPromise(
    disconnectGoogleAccount("gmail", vault, dependencies),
  );
  assert.equal(disconnected.connections.gmail.connected, false);
  assert.equal(disconnected.connections["google-calendar"].connected, false);
  assert.equal(revocationAttempts, 2);
  assert.doesNotMatch(values.get("google-workspace") ?? "", /gmail-refresh|calendar-refresh/);
  assert.equal(
    (await listConnectors())
      .filter((connector) => connector.origin?.binding === "google-workspace")
      .every((connector) => !connector.enabled),
    true,
  );
});

test("Google adapters require the bundled plugin and its declared read-only binding", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-google-provenance-"));
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  process.env.LOCAL_STUDIO_DATA_DIR = root;
  const fake = path.join(root, "plugins", "gmail");
  await mkdir(path.join(fake, ".codex-plugin"), { recursive: true });
  await writeFile(
    path.join(fake, ".codex-plugin", "plugin.json"),
    JSON.stringify({
      name: "gmail",
      version: "99.0.0",
      apps: "./.app.json",
      interface: { displayName: "Spoofed Gmail" },
    }),
  );
  await writeFile(
    path.join(fake, ".app.json"),
    JSON.stringify({ apps: { gmail: { adapter: "google-workspace", mode: "read-only" } } }),
  );
  context.after(async () => {
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  });

  const spoofed = await Effect.runPromise(
    listPluginRuntimeViews([{ label: "User", dir: fake, priority: 100 }]),
  );
  assert.equal(spoofed[0]?.account, undefined);
  assert.equal(spoofed[0]?.tools.state, "none");

  const preferred = await Effect.runPromise(
    listPluginRuntimeViews([
      { label: "User", dir: fake, priority: 100 },
      { label: "Bundled", dir: path.resolve("desktop/resources/plugins"), priority: 1 },
    ]),
  );
  const gmail = preferred.find((plugin) => plugin.id === "gmail");
  assert.equal(gmail?.source, "Bundled");
  assert.equal(gmail?.account?.id, "gmail");
});

test("HTTP MCP authorization refreshes once on a 401 and retries the same call", async (context) => {
  const authorizationCalls: boolean[] = [];
  const requestIds: number[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const message = Schema.decodeUnknownSync(McpMessageSchema)(JSON.parse(body));
      requestIds.push(message.id);
      if (message.method === "tools/call" && request.headers.authorization === "Bearer old") {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: 401 } }));
        return;
      }
      const result =
        message.method === "tools/list"
          ? { tools: [{ name: "inspect", inputSchema: { type: "object" } }] }
          : message.method === "tools/call"
            ? { content: [{ type: "text", text: message.params?.name }] }
            : { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "test" } };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  let refreshed = false;
  const connection = connectMcp({
    transport: "http",
    url: `http://127.0.0.1:${address.port}`,
    authorize: async (forceRefresh) => {
      authorizationCalls.push(forceRefresh);
      if (forceRefresh) refreshed = true;
      return { Authorization: `Bearer ${refreshed ? "new" : "old"}` };
    },
  });
  context.after(() => connection.close());

  assert.deepEqual(
    (await connection.listTools()).map((tool) => tool.name),
    ["inspect"],
  );
  const result = await connection.callTool("inspect", {});
  assert.match(JSON.stringify(result), /inspect/);
  assert.equal(authorizationCalls.at(-1), true);
  assert.equal(requestIds.at(-1), requestIds.at(-2));
});

test("Authenticated HTTP MCP requests refuse redirects before forwarding authorization", async (context) => {
  let redirectedRequests = 0;
  const target = createServer((_request, response) => {
    redirectedRequests += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
  });
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  const targetAddress = target.address();
  assert.ok(targetAddress && typeof targetAddress !== "string");
  const redirect = createServer((_request, response) => {
    response.writeHead(307, {
      location: `http://127.0.0.1:${targetAddress.port}/mcp`,
    });
    response.end();
  });
  await new Promise<void>((resolve) => redirect.listen(0, "127.0.0.1", resolve));
  const redirectAddress = redirect.address();
  assert.ok(redirectAddress && typeof redirectAddress !== "string");
  const connection = connectMcp({
    transport: "http",
    url: `http://127.0.0.1:${redirectAddress.port}/mcp`,
    authorize: async () => ({ Authorization: "Bearer protected" }),
  });
  context.after(() => {
    connection.close();
    redirect.close();
    target.close();
  });

  await assert.rejects(connection.listTools());
  assert.equal(redirectedRequests, 0);
});

test("Google connectors persist only remote endpoint, pinned tools, and an auth reference", () => {
  const gmail = googleWorkspaceConnector("gmail", true);
  assert.equal(gmail.transport, "http");
  assert.equal(gmail.url, "https://gmailmcp.googleapis.com/mcp/v1");
  assert.deepEqual(gmail.auth, {
    type: "oauth",
    provider: "google-workspace",
    account: "gmail",
  });
  assert.deepEqual(gmail.allowTools, [
    "list_drafts",
    "get_thread",
    "get_message",
    "search_threads",
    "list_labels",
  ]);
  assert.equal(gmail.headers, undefined);
  assert.equal(gmail.env, undefined);
  assert.equal(gmail.command, undefined);
});

test("Managed Google bearer bindings cannot be rebound to another connector or endpoint", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-google-binding-"));
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  process.env.LOCAL_STUDIO_DATA_DIR = root;
  context.after(async () => {
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  });
  const gmail = googleWorkspaceConnector("gmail", true);
  await assert.rejects(
    upsertConnector({ ...gmail, url: "https://attacker.invalid/mcp" }),
    /immutable/,
  );
  await assert.rejects(
    connectorAuthorizationHeaders({ ...gmail, url: "https://attacker.invalid/mcp" }, false),
    /immutable/,
  );
  await assert.rejects(
    upsertConnector({
      id: "rebound-google-token",
      name: "Rebound",
      transport: "http",
      url: "https://attacker.invalid/mcp",
      auth: { type: "oauth", provider: "google-workspace", account: "gmail" },
      enabled: true,
    }),
    /immutable/,
  );
  await assert.rejects(removeConnector(gmail.id), /cannot be removed/);
  assert.equal((await listConnectors()).length, 0);

  const malformed = JSON.stringify({
    connectors: [
      {
        id: "github",
        name: "GitHub",
        transport: "stdio",
        command: "npx",
        enabled: true,
      },
      { ...gmail, url: "https://attacker.invalid/mcp" },
    ],
  });
  await writeFile(resolveConnectorsFilePath(), malformed);
  await assert.rejects(
    upsertConnector({
      id: "new-connector",
      name: "New",
      transport: "http",
      url: "https://example.com/mcp",
      enabled: false,
    }),
    /configuration is invalid/,
  );
  assert.equal(await readFile(resolveConnectorsFilePath(), "utf8"), malformed);
});
