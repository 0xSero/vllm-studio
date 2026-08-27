import { afterAll, beforeEach, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { Effect } from "effect";
import { cleanTemps, jsonResponse, tempDir } from "./test-fixtures";
import type { GoogleOAuthDependencies } from "../src/google-account";

process.env.LOCAL_STUDIO_DATA_DIR = tempDir("google-account-");
const google = await import("../src/google-account");
const { GOOGLE_WORKSPACE_BINDINGS: bindings } = await import("../src/google-workspace-binding");
afterAll(cleanTemps);

type Store = Map<string, string>;
const vault = (store: Store) => ({
  read: (key: string) => Effect.succeed(store.get(key)),
  write: (key: string, value: string) => Effect.sync(() => void store.set(key, value)),
  remove: (key: string) => Effect.sync(() => void store.delete(key)),
});
function dependencies(emails: string[], revoked: string[]): GoogleOAuthDependencies {
  let issued = 0;
  return {
    now: () => 1_700_000_000_000,
    random: (size) => Buffer.alloc(size, issued + 1),
    verifyAccess: () => Promise.resolve(),
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const url = request.url;
      if (url.endsWith("/revoke")) {
        const token = new URLSearchParams(await request.text()).get("token");
        if (!token) throw new Error("revoke request omitted its token");
        revoked.push(token);
        return jsonResponse({});
      }
      if (url.endsWith("/token")) {
        issued++;
        return jsonResponse({
          access_token: `access-${issued}`,
          refresh_token: `refresh-${issued}`,
          expires_in: 3600,
          scope: ["openid", "email", ...bindings.gmail.scopes].join(" "),
        });
      }
      if (url.includes("userinfo"))
        return jsonResponse({ email: emails[Math.min(issued, emails.length) - 1] });
      throw new Error(`unexpected request ${url}`);
    },
  };
}
async function connect(store: Store, deps: GoogleOAuthDependencies) {
  const service = "gmail",
    flow = google.createGoogleAuthorizationFlow(service),
    secure = vault(store);
  await Effect.runPromise(
    google.beginGoogleAuthorization(service, "http://127.0.0.1:41234/callback", deps, secure, flow),
  );
  const pending = JSON.parse(store.get(`google-workspace-pending:${service}`) ?? "{}");
  return Effect.runPromise(
    google.completeGoogleAuthorizationWithActivation(
      service,
      { state: pending.state, code: "auth-code" },
      flow,
      () => Effect.succeed(true),
      () => Effect.succeed(true),
      deps,
      secure,
    ),
  );
}
const accountEmails = async () =>
  (await Effect.runPromise(google.getGoogleAccount())).accounts.map(({ email }) => email);
let store: Store, revoked: string[];
beforeEach(async () => {
  store = new Map();
  revoked = [];
  rmSync(google.resolveGoogleAccountFilePath(), { force: true });
  google.clearGoogleAuthorizationCache();
  await Effect.runPromise(
    google.saveGoogleClient({ clientId: "client-1" }, vault(store), dependencies([], revoked)),
  );
});

test("mailboxes get distinct account keys", async () => {
  const deps = dependencies(["one@example.com", "two@example.com"], revoked);
  const first = await connect(store, deps),
    second = await connect(store, deps);
  expect(first.identity.accountKey).toBe(google.googleAccountKey("one@example.com"));
  expect(second.identity.accountKey).toBe(google.googleAccountKey("two@example.com"));
  expect(await accountEmails()).toEqual(["one@example.com", "two@example.com"]);
});

test("reauthorizing rotates instead of duplicating", async () => {
  const deps = dependencies(["one@example.com", "one@example.com"], revoked);
  await connect(store, deps);
  await connect(store, deps);
  expect((await Effect.runPromise(google.getGoogleAccount())).accounts).toHaveLength(1);
});

test("disconnecting one mailbox preserves the other", async () => {
  const deps = dependencies(["one@example.com", "two@example.com"], revoked);
  const first = await connect(store, deps);
  await connect(store, deps);
  await Effect.runPromise(google.disconnectGoogleAccount(first.identity, vault(store), deps));
  expect(revoked).toEqual(["refresh-1"]);
  expect(await accountEmails()).toEqual(["two@example.com"]);
  const headers = await Effect.runPromise(
    google.googleAuthorizationHeaders(
      { service: "gmail", accountKey: google.googleAccountKey("two@example.com") },
      true,
      deps,
      vault(store),
    ),
  );
  expect(headers.Authorization).toContain("Bearer ");
});

test("changing clients revokes every account", async () => {
  const deps = dependencies(["one@example.com", "two@example.com"], revoked);
  await connect(store, deps);
  await connect(store, deps);
  await Effect.runPromise(google.saveGoogleClient({ clientId: "client-2" }, vault(store), deps));
  expect(revoked.sort()).toEqual(["refresh-1", "refresh-2"]);
  expect((await Effect.runPromise(google.getGoogleAccount())).accounts).toHaveLength(0);
});

test("legacy single-account disks migrate to a keyed account", async () => {
  writeFileSync(
    google.resolveGoogleAccountFilePath(),
    JSON.stringify({
      clientId: "client-legacy",
      hasClientSecret: false,
      connections: {
        gmail: {
          email: "Legacy@Example.com",
          scopes: [...bindings.gmail.scopes],
          resource: bindings.gmail.mcpResource,
          connectedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    }),
  );
  const accounts = (await Effect.runPromise(google.getGoogleAccount())).accounts;
  expect(accounts).toHaveLength(1);
  expect(accounts[0]?.key).toBe(google.googleAccountKey("legacy@example.com"));
  expect(accounts[0]?.connections.gmail.connected).toBe(true);
});
