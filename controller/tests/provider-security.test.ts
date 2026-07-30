import { afterEach, describe, expect, test } from "bun:test";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NormalizedPrincipal } from "@local-studio/contracts/enterprise-auth";
import { Effect } from "effect";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import type { ProviderConfig } from "../src/config/persisted-config";
import { loadPersistedConfig, savePersistedConfig } from "../src/config/persisted-config";
import { buildChatCompletionsStreamResponse } from "../src/modules/proxy/chat-completions-stream";
import {
  assertProviderOutboundUrl,
  type ProviderHostnameLookup,
} from "../src/services/provider-boundary";
import { resolveProviderHeaders } from "../src/services/provider-authentication";
import { EnterpriseTokenVerifier } from "../src/http/enterprise-auth";
import {
  ProviderSecretStore,
  newProviderApiKeyReference,
  newProviderClientSecretReference,
  newProviderSubscriptionKeyReference,
  providerApiKeyReference,
} from "../src/services/provider-secret-store";
import { discoverProviderModels } from "../src/services/provider-routing";

const originalFetch = globalThis.fetch;
const originalEnvironment = {
  masterKey: process.env["LOCAL_STUDIO_PROVIDER_MASTER_KEY"],
  masterKeyId: process.env["LOCAL_STUDIO_PROVIDER_MASTER_KEY_ID"],
  previousMasterKeys: process.env["LOCAL_STUDIO_PROVIDER_PREVIOUS_MASTER_KEYS"],
  providerHosts: process.env["LOCAL_STUDIO_PROVIDER_HOST_ALLOWLIST"],
  privateHosts: process.env["LOCAL_STUDIO_PROVIDER_PRIVATE_HOST_ALLOWLIST"],
  managedIdentityEndpoint: process.env["LOCAL_STUDIO_MANAGED_IDENTITY_ENDPOINT"],
};
const temporaryDirectories: string[] = [];
const temporaryServers: Array<{ stop(closeActiveConnections?: boolean): void }> = [];

const restoreEnvironment = (name: string, value: string | undefined): void => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnvironment("LOCAL_STUDIO_PROVIDER_MASTER_KEY", originalEnvironment.masterKey);
  restoreEnvironment("LOCAL_STUDIO_PROVIDER_MASTER_KEY_ID", originalEnvironment.masterKeyId);
  restoreEnvironment(
    "LOCAL_STUDIO_PROVIDER_PREVIOUS_MASTER_KEYS",
    originalEnvironment.previousMasterKeys,
  );
  restoreEnvironment("LOCAL_STUDIO_PROVIDER_HOST_ALLOWLIST", originalEnvironment.providerHosts);
  restoreEnvironment(
    "LOCAL_STUDIO_PROVIDER_PRIVATE_HOST_ALLOWLIST",
    originalEnvironment.privateHosts,
  );
  restoreEnvironment(
    "LOCAL_STUDIO_MANAGED_IDENTITY_ENDPOINT",
    originalEnvironment.managedIdentityEndpoint,
  );
  for (const server of temporaryServers.splice(0)) server.stop(true);
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const temporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-provider-security-"));
  temporaryDirectories.push(directory);
  return directory;
};

const masterKey = (byte: string): string => byte.repeat(64);

const principal = (overrides: Partial<NormalizedPrincipal> = {}): NormalizedPrincipal => ({
  subject: "scientist-01",
  issuer: "https://issuer.test/realm",
  issuer_id: "issuer-01",
  tenant: "tenant-01",
  display_name: "Scientist",
  roles: ["scientist"],
  entitlements: ["model:invoke"],
  clearance: "C2",
  issued_at: Math.floor(Date.now() / 1000) - 10,
  expires_at: Math.floor(Date.now() / 1000) + 600,
  ...overrides,
});

const delegatedToken = (claims: Record<string, unknown>): string => {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(claims)}.signature`;
};

const managedIdentityProvider = (resource = "https://gateway.test"): ProviderConfig => ({
  id: "azure",
  name: "Azure",
  base_url: "https://gateway.test/v1",
  enabled: true,
  authentication: {
    type: "managed_identity",
    resource,
  },
});

describe("provider secret storage", () => {
  test("encrypts values and fails closed for a wrong key or corrupted ciphertext", () => {
    const directory = temporaryDirectory();
    const ref = providerApiKeyReference("tensorprime");
    const secret = "not-visible-in-storage";
    process.env["LOCAL_STUDIO_PROVIDER_MASTER_KEY"] = masterKey("1");
    const store = new ProviderSecretStore(directory, true);
    store.writeSync(ref, secret);
    const secretDirectory = join(directory, "provider-secrets");
    const blob = readdirSync(secretDirectory).find((entry) => entry.endsWith(".bin"));
    expect(blob).toBeDefined();
    const path = join(secretDirectory, blob!);
    expect(readFileSync(path).includes(Buffer.from(secret))).toBe(false);
    const alias = join(secretDirectory, "credential-alias.bin");
    linkSync(path, alias);
    expect(() => store.readSync(ref)).toThrow("Provider credential could not be read");
    unlinkSync(alias);

    process.env["LOCAL_STUDIO_PROVIDER_MASTER_KEY"] = masterKey("2");
    const wrongKeyStore = new ProviderSecretStore(directory, true);
    expect(() => wrongKeyStore.readSync(ref)).toThrow("Provider credential could not be read");

    process.env["LOCAL_STUDIO_PROVIDER_MASTER_KEY"] = masterKey("1");
    const bytes = readFileSync(path);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    writeFileSync(path, bytes);
    expect(() => store.readSync(ref)).toThrow("Provider credential could not be read");
  });

  test("imports legacy plaintext, scrubs settings, and survives restart", () => {
    const directory = temporaryDirectory();
    process.env["LOCAL_STUDIO_PROVIDER_MASTER_KEY"] = masterKey("3");
    writeFileSync(
      join(directory, "studio-settings.json"),
      JSON.stringify({
        providers: [
          {
            id: "legacy",
            name: "Legacy",
            base_url: "http://127.0.0.1:8101",
            api_key: "legacy-secret",
            enabled: true,
          },
        ],
      }),
    );
    const firstStore = new ProviderSecretStore(directory, true);
    const first = loadPersistedConfig(directory, firstStore);
    const persisted = readFileSync(join(directory, "studio-settings.json"), "utf8");
    const migratedAuthentication = first.providers?.[0]?.authentication;
    expect(migratedAuthentication?.type).toBe("api_key");
    const ref =
      migratedAuthentication?.type === "api_key" ? migratedAuthentication.secret_ref : undefined;
    expect(ref).toMatch(/^provider:legacy:api-key:[a-f\d]{32}$/);
    expect(persisted).not.toContain("legacy-secret");
    expect(
      Object.hasOwn(JSON.parse(persisted).providers[0] as Record<string, unknown>, "api_key"),
    ).toBe(false);

    const restartedStore = new ProviderSecretStore(directory, true);
    const restarted = loadPersistedConfig(directory, restartedStore);
    expect(restarted.providers?.[0]?.authentication).toEqual({
      type: "api_key",
      secret_ref: ref,
    });
    expect(restartedStore.readSync(ref!)).toBe("legacy-secret");
  });

  test("keeps credential revisions immutable across an interrupted configuration switch", () => {
    const directory = temporaryDirectory();
    process.env["LOCAL_STUDIO_PROVIDER_MASTER_KEY"] = masterKey("5");
    const store = new ProviderSecretStore(directory, true);
    const first = newProviderApiKeyReference("revisioned");
    const second = newProviderApiKeyReference("revisioned");
    store.writeSync(first, "first-value");
    store.writeSync(second, "second-value");
    expect(first).not.toBe(second);
    expect(store.readSync(first)).toBe("first-value");
    expect(store.readSync(second)).toBe("second-value");
    store.reconcileSync(new Set([first]));
    expect(store.readSync(first)).toBe("first-value");
    expect(store.readSync(second)).toBeUndefined();
  });

  test("rewraps a previous-key envelope with the active key and survives key retirement", () => {
    const directory = temporaryDirectory();
    const reference = newProviderApiKeyReference("rotated");
    process.env["LOCAL_STUDIO_PROVIDER_MASTER_KEY"] = masterKey("1");
    process.env["LOCAL_STUDIO_PROVIDER_MASTER_KEY_ID"] = "provider-2026-01";
    const initial = new ProviderSecretStore(directory, true);
    initial.writeSync(reference, "rotated-secret");
    const secretDirectory = join(directory, "provider-secrets");
    const blob = join(
      secretDirectory,
      readdirSync(secretDirectory).find((entry) => entry.endsWith(".bin"))!,
    );
    const previousEnvelope = readFileSync(blob);

    process.env["LOCAL_STUDIO_PROVIDER_MASTER_KEY"] = masterKey("2");
    process.env["LOCAL_STUDIO_PROVIDER_MASTER_KEY_ID"] = "provider-2026-07";
    process.env["LOCAL_STUDIO_PROVIDER_PREVIOUS_MASTER_KEYS"] = JSON.stringify({
      "provider-2026-01": masterKey("1"),
    });
    const rotated = new ProviderSecretStore(directory, true);
    expect(rotated.readSync(reference)).toBe("rotated-secret");
    expect(readFileSync(blob).equals(previousEnvelope)).toBe(false);

    delete process.env["LOCAL_STUDIO_PROVIDER_PREVIOUS_MASTER_KEYS"];
    const retired = new ProviderSecretStore(directory, true);
    expect(retired.readSync(reference)).toBe("rotated-secret");
  });

  test("rewraps the legacy envelope format on authenticated read", () => {
    const directory = temporaryDirectory();
    const reference = providerApiKeyReference("legacy-envelope");
    process.env["LOCAL_STUDIO_PROVIDER_MASTER_KEY"] = masterKey("3");
    process.env["LOCAL_STUDIO_PROVIDER_MASTER_KEY_ID"] = "provider-current";
    const secretDirectory = join(directory, "provider-secrets");
    mkdirSync(secretDirectory, { recursive: true });
    const blob = join(
      secretDirectory,
      `${createHash("sha256").update(reference).digest("hex")}.bin`,
    );
    const key = Buffer.from(masterKey("3"), "hex");
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.from(reference));
    const encrypted = Buffer.concat([cipher.update("legacy-value", "utf8"), cipher.final()]);
    writeFileSync(blob, Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), encrypted]), {
      mode: 0o600,
    });

    const store = new ProviderSecretStore(directory, true);
    expect(store.readSync(reference)).toBe("legacy-value");
    expect(readFileSync(blob)[0]).toBe(2);
  });

  test("rolls back failed persistence and reconciles orphan blobs", () => {
    const directory = temporaryDirectory();
    process.env["LOCAL_STUDIO_PROVIDER_MASTER_KEY"] = masterKey("4");
    const store = new ProviderSecretStore(directory, true);
    const activeRef = providerApiKeyReference("active");
    const orphanRef = providerApiKeyReference("orphan");
    store.writeSync(activeRef, "old-secret");
    expect(() =>
      store.mutateSync([{ ref: activeRef, value: "new-secret" }], () => {
        throw new Error("settings write failed");
      }),
    ).toThrow("Provider secret transaction failed");
    expect(store.readSync(activeRef)).toBe("old-secret");
    store.writeSync(orphanRef, "orphan-secret");
    store.reconcileSync(new Set([activeRef]));
    expect(store.readSync(orphanRef)).toBeUndefined();
    expect(store.readSync(activeRef)).toBe("old-secret");
  });

  test("commits provider deletion before reconciliation and recovers after interruption", () => {
    const directory = temporaryDirectory();
    process.env["LOCAL_STUDIO_PROVIDER_MASTER_KEY"] = masterKey("9");
    const store = new ProviderSecretStore(directory, true);
    const reference = newProviderApiKeyReference("deletion-order");
    store.writeSync(reference, "deletion-secret");
    const provider: ProviderConfig = {
      id: "deletion-order",
      name: "Deletion order",
      base_url: "https://gateway.test/v1",
      enabled: true,
      authentication: { type: "api_key", secret_ref: reference },
    };
    savePersistedConfig(directory, { providers: [provider] }, store);

    class InterruptedReconciliationStore extends ProviderSecretStore {
      committed = false;

      override reconcileSync(): void {
        const persisted = JSON.parse(
          readFileSync(join(directory, "studio-settings.json"), "utf8"),
        ) as { providers?: unknown[] };
        this.committed = persisted.providers?.length === 0;
        throw new Error("simulated interruption after config commit");
      }
    }

    const interruptedStore = new InterruptedReconciliationStore(directory, true);
    expect(() => savePersistedConfig(directory, { providers: [] }, interruptedStore)).toThrow(
      "simulated interruption after config commit",
    );
    expect(interruptedStore.committed).toBe(true);
    expect(store.readSync(reference)).toBe("deletion-secret");

    const restartedStore = new ProviderSecretStore(directory, true);
    expect(loadPersistedConfig(directory, restartedStore).providers).toEqual([]);
    expect(restartedStore.readSync(reference)).toBeUndefined();
  });
});

describe("provider authentication", () => {
  test("deduplicates managed identity refresh and fails closed without leaking tokens", async () => {
    let calls = 0;
    let fail = false;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = Bun.serve({
      port: 0,
      async fetch() {
        calls += 1;
        await gate;
        return fail
          ? new Response("managed-secret", { status: 500 })
          : Response.json({
              access_token: "managed-secret",
              expires_in: 600,
            });
      },
    });
    temporaryServers.push(server);
    process.env["LOCAL_STUDIO_MANAGED_IDENTITY_ENDPOINT"] = new URL(
      "/metadata/identity/oauth2/token",
      server.url,
    ).toString();
    const provider = managedIdentityProvider();
    const first = Effect.runPromise(resolveProviderHeaders(provider));
    const second = Effect.runPromise(resolveProviderHeaders(provider));
    await Promise.resolve();
    release!();
    expect(await Promise.all([first, second])).toEqual([
      { Authorization: "Bearer managed-secret" },
      { Authorization: "Bearer managed-secret" },
    ]);
    expect(calls).toBe(1);

    fail = true;
    await expect(
      Effect.runPromise(resolveProviderHeaders(managedIdentityProvider("https://failure.test"))),
    ).rejects.toMatchObject({ reason: "identity_unavailable" });
  });

  test("denies delegated tokens with wrong issuer, audience, or scope", async () => {
    const provider: ProviderConfig = {
      id: "gateway",
      name: "Gateway",
      base_url: "https://gateway.test/v1",
      enabled: true,
      authentication: {
        type: "apim_gateway",
        issuer_id: "issuer-01",
        audience: "api://gateway",
        scopes: ["models.invoke"],
      },
    };
    const baseClaims = {
      sub: "scientist-01",
      iss: "https://issuer.test/realm",
      exp: Math.floor(Date.now() / 1000) + 600,
    };
    await expect(
      Effect.runPromise(
        resolveProviderHeaders(provider, {
          principal: principal({ issuer_id: "other-issuer" }),
          verifiedBearerToken: delegatedToken({
            ...baseClaims,
            aud: "api://gateway",
            scp: "models.invoke",
          }),
        }),
      ),
    ).rejects.toMatchObject({ reason: "identity_mismatch" });
    await expect(
      Effect.runPromise(
        resolveProviderHeaders(provider, {
          principal: principal(),
          verifiedBearerToken: delegatedToken({
            ...baseClaims,
            aud: "api://other",
            scp: "models.invoke",
          }),
        }),
      ),
    ).rejects.toMatchObject({ reason: "audience_mismatch" });
    await expect(
      Effect.runPromise(
        resolveProviderHeaders(provider, {
          principal: principal(),
          verifiedBearerToken: delegatedToken({
            ...baseClaims,
            aud: "api://gateway",
            scp: "openid",
          }),
        }),
      ),
    ).rejects.toMatchObject({ reason: "scope_mismatch" });
  });

  test("exchanges a signed delegated token once for concurrent APIM calls", async () => {
    let calls = 0;
    let posted = "";
    const keys = await generateKeyPair("RS256");
    const publicJwk = { ...(await exportJWK(keys.publicKey)), alg: "RS256", kid: "provider-key" };
    const server = Bun.serve({
      port: 0,
      async fetch(request): Promise<Response> {
        const url = new URL(request.url);
        if (url.pathname === "/.well-known/openid-configuration") {
          return Response.json({ jwks_uri: new URL("/jwks", request.url).toString() });
        }
        if (url.pathname === "/jwks") return Response.json({ keys: [publicJwk] });
        calls += 1;
        posted = await request.text();
        return Response.json({
          access_token: "exchanged-access-token",
          expires_in: 600,
          token_type: "Bearer",
        });
      },
    });
    temporaryServers.push(server);
    const issuer = server.url.toString().replace(/\/$/u, "");
    const subjectToken = await new SignJWT({
      sub: "scientist-01",
      scope: "models.invoke",
      roles: ["scientist"],
    })
      .setProtectedHeader({ alg: "RS256", kid: "provider-key" })
      .setIssuer(issuer)
      .setAudience("api://gateway")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(keys.privateKey);
    const directory = temporaryDirectory();
    process.env["LOCAL_STUDIO_PROVIDER_MASTER_KEY"] = masterKey("6");
    const secretStore = new ProviderSecretStore(directory, true);
    const clientSecretRef = newProviderClientSecretReference("gateway-exchange");
    secretStore.writeSync(clientSecretRef, "exchange-client-secret");
    const provider: ProviderConfig = {
      id: "gateway-exchange",
      name: "Gateway exchange",
      base_url: "https://gateway.test/v1",
      enabled: true,
      authentication: {
        type: "apim_gateway",
        issuer_id: "issuer-01",
        audience: "api://gateway",
        scopes: ["models.invoke"],
        token_exchange: {
          mode: "rfc8693",
          token_endpoint: server.url.toString(),
          client_id: "local-studio",
          client_secret_ref: clientSecretRef,
        },
      },
    };
    const identity = await Effect.runPromise(
      new EnterpriseTokenVerifier({
        mode: "required_oidc",
        session_idle_seconds: 900,
        session_absolute_seconds: 3600,
        issuers: [
          {
            id: "issuer-01",
            kind: "keycloak",
            issuer,
            client_id: "local-studio",
            audience: "api://gateway",
            scopes: ["models.invoke"],
            tenant: "tenant-01",
            role_claim: "roles",
            group_claim: "groups",
            role_mappings: { scientist: ["scientist"] },
            clearance_mappings: { scientist: "C2" },
          },
        ],
      }).verify(subjectToken),
    );
    const context = {
      principal: identity,
      verifiedBearerToken: subjectToken,
      secretStore,
    };
    expect(
      await Promise.all([
        Effect.runPromise(resolveProviderHeaders(provider, context)),
        Effect.runPromise(resolveProviderHeaders(provider, context)),
      ]),
    ).toEqual([
      { Authorization: "Bearer exchanged-access-token" },
      { Authorization: "Bearer exchanged-access-token" },
    ]);
    expect(calls).toBe(1);
    const form = new URLSearchParams(posted);
    expect(form.get("subject_token")).toBe(subjectToken);
    expect(form.get("client_secret")).toBe("exchange-client-secret");
    expect(form.get("audience")).toBe("api://gateway");
  });

  test("cancels one token-exchange waiter without cancelling the shared acquisition", async () => {
    let calls = 0;
    let releaseExchange: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const exchangeStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const exchangeReleased = new Promise<void>((resolve) => {
      releaseExchange = resolve;
    });
    const server = Bun.serve({
      port: 0,
      async fetch(): Promise<Response> {
        calls += 1;
        markStarted?.();
        await exchangeReleased;
        return Response.json({
          access_token: "shared-exchanged-token",
          expires_in: 600,
          token_type: "Bearer",
        });
      },
    });
    temporaryServers.push(server);
    const issuer = server.url.toString().replace(/\/$/u, "");
    const keys = await generateKeyPair("RS256");
    const subjectToken = await new SignJWT({
      sub: "scientist-01",
      scope: "models.invoke",
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(issuer)
      .setAudience("api://gateway-cancel")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(keys.privateKey);
    const provider: ProviderConfig = {
      id: "gateway-cancel",
      name: "Gateway cancellation",
      base_url: "https://gateway.test/v1",
      enabled: true,
      authentication: {
        type: "apim_gateway",
        issuer_id: "issuer-01",
        audience: "api://gateway-cancel",
        scopes: ["models.invoke"],
        token_exchange: {
          mode: "rfc8693",
          token_endpoint: server.url.toString(),
          client_id: "local-studio",
        },
      },
    };
    const identity = principal({ issuer, subject: "scientist-01" });
    const cancelled = new AbortController();
    const cancelledWaiter = Effect.runPromise(
      resolveProviderHeaders(provider, {
        principal: identity,
        verifiedBearerToken: subjectToken,
        signal: cancelled.signal,
      }),
    );
    const continuingWaiter = Effect.runPromise(
      resolveProviderHeaders(provider, {
        principal: identity,
        verifiedBearerToken: subjectToken,
      }),
    );
    await exchangeStarted;
    cancelled.abort();
    releaseExchange?.();
    await expect(cancelledWaiter).rejects.toMatchObject({ reason: "token_unavailable" });
    expect(await continuingWaiter).toEqual({
      Authorization: "Bearer shared-exchanged-token",
    });
    expect(calls).toBe(1);
  });

  test("exchanges client credentials for an apim_client provider", async () => {
    let calls = 0;
    let posted = "";
    const keys = await generateKeyPair("RS256");
    const server = Bun.serve({
      port: 0,
      async fetch(request): Promise<Response> {
        calls += 1;
        posted = await request.text();
        const accessToken = await new SignJWT({
          aud: "api://gateway",
          scp: "models.invoke",
        })
          .setProtectedHeader({ alg: "RS256" })
          .setIssuedAt()
          .setExpirationTime("10m")
          .sign(keys.privateKey);
        return Response.json({
          access_token: accessToken,
          expires_in: 600,
          token_type: "Bearer",
        });
      },
    });
    temporaryServers.push(server);
    const directory = temporaryDirectory();
    process.env["LOCAL_STUDIO_PROVIDER_MASTER_KEY"] = masterKey("a");
    const secretStore = new ProviderSecretStore(directory, true);
    const clientSecretReference = newProviderClientSecretReference("client-cred");
    secretStore.writeSync(clientSecretReference, "client-secret-value");
    const provider: ProviderConfig = {
      id: "client-cred",
      name: "Client credentials",
      base_url: "https://gateway.test/v1",
      enabled: true,
      authentication: {
        type: "apim_client",
        issuer_id: "issuer-01",
        audience: "api://gateway",
        scopes: ["models.invoke"],
        token_endpoint: server.url.toString(),
        client_id: "local-studio",
        client_secret_ref: clientSecretReference,
      },
    };
    const headers = await Effect.runPromise(resolveProviderHeaders(provider, { secretStore }));
    expect(headers["Authorization"]).toMatch(/^Bearer /);
    expect(calls).toBe(1);
    const form = new URLSearchParams(posted);
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("client_id")).toBe("local-studio");
    expect(form.get("client_secret")).toBe("client-secret-value");
    expect(form.get("scope")).toBe("models.invoke");
  });
});

describe("provider outbound policy", () => {
  test("rejects unexpected private resolution and admits explicit private hosts", async () => {
    process.env["LOCAL_STUDIO_PROVIDER_HOST_ALLOWLIST"] = "private.test,public.test";
    const privateLookup: ProviderHostnameLookup = () =>
      Effect.succeed([{ address: "172.18.7.206", family: 4 }]);
    await expect(
      Effect.runPromise(assertProviderOutboundUrl("https://private.test", privateLookup)),
    ).rejects.toThrow("restricted network address");
    process.env["LOCAL_STUDIO_PROVIDER_PRIVATE_HOST_ALLOWLIST"] = "private.test";
    expect(
      await Effect.runPromise(assertProviderOutboundUrl("https://private.test", privateLookup)),
    ).toBe("https://private.test/v1");
    expect(
      await Effect.runPromise(
        assertProviderOutboundUrl("http://api.tprime.vlans.ca", privateLookup),
      ),
    ).toBe("http://api.tprime.vlans.ca/v1");
    expect(
      await Effect.runPromise(
        assertProviderOutboundUrl("https://public.test", () =>
          Effect.succeed([{ address: "93.184.216.34", family: 4 }]),
        ),
      ),
    ).toBe("https://public.test/v1");
  });
});

describe("provider cancellation", () => {
  test("propagates client abort to model discovery", async () => {
    const controller = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    const request = Effect.runPromise(
      discoverProviderModels(
        {
          id: "local",
          name: "Local",
          base_url: "http://127.0.0.1:8101/v1",
          enabled: true,
          authentication: { type: "none" },
        },
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            upstreamSignal = init?.signal ?? undefined;
            upstreamSignal?.addEventListener("abort", () => reject(upstreamSignal?.reason), {
              once: true,
            });
          }),
        { signal: controller.signal },
      ),
    );
    await Promise.resolve();
    controller.abort(new Error("client disconnected"));
    await expect(request).rejects.toBeDefined();
    expect(upstreamSignal?.aborted).toBe(true);
  });

  test("propagates client abort to streaming upstream fetch", async () => {
    const controller = new AbortController();
    let upstreamSignal: AbortSignal | undefined;
    let observedAbortResolve: (() => void) | undefined;
    const observedAbort = new Promise<void>((resolve) => {
      observedAbortResolve = resolve;
    });
    globalThis.fetch = ((_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        upstreamSignal = init?.signal ?? undefined;
        upstreamSignal?.addEventListener(
          "abort",
          () => {
            observedAbortResolve!();
            reject(upstreamSignal?.reason);
          },
          { once: true },
        );
      })) as typeof fetch;
    const response = buildChatCompletionsStreamResponse({
      upstreamUrl: "http://127.0.0.1:8101/v1/chat/completions",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "model-a", stream: true }),
      clientSignal: controller.signal,
      matchedRecipe: null,
      sourceHeader: null,
      sessionId: null,
      recordedModel: "model-a",
      recordedProvider: "local",
      requestStart: performance.now(),
      requestProvider: "local",
      providerRouting: null,
      context: {
        logger: { error: () => undefined, warn: () => undefined },
        stores: {},
      } as never,
      keepaliveIntervalMs: 60_000,
    });
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort(new Error("client disconnected"));
    await observedAbort;
    const completed = await reader.read();
    expect(upstreamSignal?.aborted).toBe(true);
    expect(completed.done).toBe(true);
  });
});

describe("provider subscription key", () => {
  test("includes the subscription key header alongside the bearer token", async () => {
    process.env["LOCAL_STUDIO_PROVIDER_MASTER_KEY"] = masterKey("1");
    process.env["LOCAL_STUDIO_PROVIDER_MASTER_KEY_ID"] = "provider-current";
    const directory = temporaryDirectory();
    const store = new ProviderSecretStore(directory, true);
    const reference = newProviderSubscriptionKeyReference("trustnest");
    const apiKeyReference = newProviderApiKeyReference("trustnest");
    store.writeSync(reference, "apim-subscription-secret");
    const provider: ProviderConfig = {
      id: "trustnest",
      name: "TrustNest",
      base_url: "https://api.thalesdigital.io/ai-models/openai",
      enabled: true,
      authentication: {
        type: "api_key",
        secret_ref: apiKeyReference,
      },
      subscription_key: {
        header: "TrustNest-Apim-Subscription-Key",
        secret_ref: reference,
      },
    };
    store.writeSync(apiKeyReference, "bearer-token");
    const headers = await Effect.runPromise(
      resolveProviderHeaders(provider, { secretStore: store }),
    );
    expect(headers).toEqual({
      Authorization: "Bearer bearer-token",
      "TrustNest-Apim-Subscription-Key": "apim-subscription-secret",
    });
  });

  test("fails closed when the subscription key is missing from the store", async () => {
    process.env["LOCAL_STUDIO_PROVIDER_MASTER_KEY"] = masterKey("2");
    const directory = temporaryDirectory();
    const store = new ProviderSecretStore(directory, true);
    const reference = newProviderSubscriptionKeyReference("trustnest");
    const provider: ProviderConfig = {
      id: "trustnest",
      name: "TrustNest",
      base_url: "https://api.thalesdigital.io/ai-models/openai",
      enabled: true,
      authentication: { type: "none" },
      subscription_key: {
        header: "TrustNest-Apim-Subscription-Key",
        secret_ref: reference,
      },
    };
    await expect(
      Effect.runPromise(resolveProviderHeaders(provider, { secretStore: store })),
    ).rejects.toMatchObject({ reason: "credential_unavailable" });
  });

  test("uses a direct subscription key for probing without a persisted secret", async () => {
    const provider: ProviderConfig = {
      id: "trustnest",
      name: "TrustNest",
      base_url: "https://api.thalesdigital.io/ai-models/openai",
      enabled: true,
      authentication: { type: "none" },
    };
    const headers = await Effect.runPromise(
      resolveProviderHeaders(provider, {
        directSubscriptionKey: { header: "TrustNest-Apim-Subscription-Key", value: "probe-secret" },
      }),
    );
    expect(headers).toEqual({ "TrustNest-Apim-Subscription-Key": "probe-secret" });
  });
});
