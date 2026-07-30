import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { OAuthVaultError, type OAuthVault } from "../src/oauth-vault";
import {
  AgentOnboardingError,
  clearOnboardingReceipt,
  defaultOnboardingProfile,
  getOnboardingState,
  profileDigest,
  probeOnboardingTarget,
  proxyOnboardingInference,
  recordOnboardingReceipt,
  recordOnboardingRecovery,
  saveOnboarding,
  searchFastCrw,
} from "../src/agent-onboarding-service";

let dataDir = "";
let secrets: Map<string, string>;

const vault: OAuthVault = {
  read: (key) => Effect.succeed(secrets.get(key)),
  write: (key, value) =>
    Effect.sync(() => {
      secrets.set(key, value);
    }),
  remove: (key) =>
    Effect.sync(() => {
      secrets.delete(key);
    }),
};

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "agent-onboarding-"));
  process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
  await writeFile(path.join(dataDir, "api-settings.json"), "{}");
  secrets = new Map();
});

afterEach(async () => {
  delete process.env.LOCAL_STUDIO_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("agent onboarding service", () => {
  test("returns the C2 enterprise defaults without inventing enrollment evidence", async () => {
    const state = await Effect.runPromise(getOnboardingState(vault));
    expect(state.profile.classification).toBe("C2");
    expect(state.profile.services.map((service) => service.id)).toEqual([
      "vault",
      "gitlab",
      "jira",
    ]);
    expect(state.receipt).toBeNull();
    expect(state.keyring.available).toBe(true);
  });

  test("persists metadata separately from encrypted credential values", async () => {
    const profile = defaultOnboardingProfile();
    const state = await Effect.runPromise(
      saveOnboarding(
        {
          profile,
          credentials: [{ ref: "vault:search:fastcrw", value: "crw-secret" }],
        },
        vault,
      ),
    );
    expect(state.keyring.credentialRefs).toContain("vault:search:fastcrw");
    expect(secrets.get("vault:search:fastcrw")).toBe("crw-secret");
    const file = path.join(dataDir, "agent-onboarding.json");
    const raw = await readFile(file, "utf8");
    expect(raw).not.toContain("crw-secret");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  test("rejects URLs outside the explicit onboarding allowlist", async () => {
    const profile = defaultOnboardingProfile();
    profile.search.baseUrl = "https://example.com";
    const error = await Effect.runPromise(saveOnboarding({ profile }, vault).pipe(Effect.flip));
    expect(error).toBeInstanceOf(AgentOnboardingError);
    expect(error.status).toBe(400);
  });

  test("produces a stable algorithm-prefixed profile digest", () => {
    const profile = defaultOnboardingProfile("2026-07-28T00:00:00.000Z");
    expect(profileDigest(profile)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(profileDigest(profile)).toBe(profileDigest(profile));
  });

  test("serializes concurrent probe evidence without losing targets", async () => {
    secrets.set("vault:enterprise:vault", "vault-token");
    secrets.set("vault:enterprise:gitlab", "gitlab-token");
    secrets.set("vault:enterprise:jira", "jira-token");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))) as typeof fetch;
    try {
      await Promise.all([
        Effect.runPromise(probeOnboardingTarget({ target: "vault" }, vault)),
        Effect.runPromise(probeOnboardingTarget({ target: "gitlab" }, vault)),
        Effect.runPromise(probeOnboardingTarget({ target: "jira" }, vault)),
      ]);
      const state = await Effect.runPromise(getOnboardingState(vault));
      expect(new Set(state.probes.map((probe) => probe.target))).toEqual(
        new Set(["vault", "gitlab", "jira"]),
      );
      expect(
        state.probes.every((probe) => probe.profileDigest === profileDigest(state.profile)),
      ).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test.each([401, 403])("records HTTP %s as failed probe evidence", async (status) => {
    secrets.set("vault:enterprise:gitlab", "gitlab-token");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(new Response(null, { status }))) as typeof fetch;
    try {
      const result = await Effect.runPromise(probeOnboardingTarget({ target: "gitlab" }, vault));
      expect(result.ok).toBe(false);
      expect(result.status).toBe(`HTTP ${status}`);
      const state = await Effect.runPromise(getOnboardingState(vault));
      expect(state.probes.find((probe) => probe.target === "gitlab")?.ok).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("maps credentials to target-specific headers without persisting them", async () => {
    secrets.set("vault:enterprise:vault", "vault-token");
    secrets.set("vault:enterprise:gitlab", "gitlab-token");
    secrets.set("vault:enterprise:jira", "jira-token");
    const requests: Request[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input, init) => {
      requests.push(new Request(input, init));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;
    try {
      await Effect.runPromise(probeOnboardingTarget({ target: "vault" }, vault));
      await Effect.runPromise(probeOnboardingTarget({ target: "gitlab" }, vault));
      await Effect.runPromise(probeOnboardingTarget({ target: "jira" }, vault));
      expect(requests[0]?.headers.get("X-Vault-Token")).toBe("vault-token");
      expect(requests[1]?.headers.get("PRIVATE-TOKEN")).toBe("gitlab-token");
      expect(requests[2]?.headers.get("Authorization")).toBe("Bearer jira-token");
      expect(await readFile(path.join(dataDir, "agent-onboarding.json"), "utf8")).not.toContain(
        "-token",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("does not probe a credential-bound target anonymously", async () => {
    let requests = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      requests += 1;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;
    try {
      const result = await Effect.runPromise(probeOnboardingTarget({ target: "gitlab" }, vault));
      expect(result.ok).toBe(false);
      expect(result.status).toBe("Credential unavailable");
      expect(requests).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test.each([501, 503])("does not treat Vault HTTP %s as operational", async (status) => {
    secrets.set("vault:enterprise:vault", "vault-token");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(new Response(null, { status }))) as typeof fetch;
    try {
      const result = await Effect.runPromise(probeOnboardingTarget({ target: "vault" }, vault));
      expect(result.ok).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rejects embedded URL credentials and invalid credential references", async () => {
    const embedded = defaultOnboardingProfile();
    embedded.runtime.baseUrl = "https://user:pass@api.tprime.vlans.ca/v1";
    const embeddedError = await Effect.runPromise(
      saveOnboarding({ profile: embedded }, vault).pipe(Effect.flip),
    );
    expect(embeddedError).toBeInstanceOf(AgentOnboardingError);
    expect(embeddedError.status).toBe(400);

    const invalidRef = defaultOnboardingProfile();
    invalidRef.runtime.credentialRef = "vault:runtime:other";
    const refError = await Effect.runPromise(
      saveOnboarding({ profile: invalidRef }, vault).pipe(Effect.flip),
    );
    expect(refError).toBeInstanceOf(AgentOnboardingError);
    expect(refError.status).toBe(400);
  });

  test("restores earlier keyring writes when a later credential write fails", async () => {
    secrets.set("vault:enterprise:vault", "old-vault");
    secrets.set("vault:enterprise:gitlab", "old-gitlab");
    const failingVault: OAuthVault = {
      read: vault.read,
      remove: vault.remove,
      write: (key, value) =>
        key === "vault:enterprise:gitlab" && value === "new-gitlab"
          ? Effect.fail(new OAuthVaultError("write failed"))
          : vault.write(key, value),
    };
    const error = await Effect.runPromise(
      saveOnboarding(
        {
          profile: defaultOnboardingProfile(),
          credentials: [
            { ref: "vault:enterprise:vault", value: "new-vault" },
            { ref: "vault:enterprise:gitlab", value: "new-gitlab" },
          ],
        },
        failingVault,
      ).pipe(Effect.flip),
    );
    expect(error).toBeInstanceOf(AgentOnboardingError);
    expect(secrets.get("vault:enterprise:vault")).toBe("old-vault");
    expect(secrets.get("vault:enterprise:gitlab")).toBe("old-gitlab");
  });

  test("bounds native search input and forwards only the configured credential", async () => {
    secrets.set("vault:search:fastcrw", "search-token");
    let request: Request | undefined;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input, init) => {
      request = new Request(input, init);
      return Promise.resolve(Response.json({ results: [] }));
    }) as typeof fetch;
    try {
      await Effect.runPromise(
        searchFastCrw(
          {
            query: "ray datasets",
            limit: 999,
            categories: ["a", "b", "c", "d", "e", "f"],
          },
          vault,
        ),
      );
      expect(request?.url).toBe("https://api.fastcrw.com/v1/search");
      expect(request?.headers.get("Authorization")).toBe("Bearer search-token");
      const body = JSON.parse(await request!.text()) as {
        limit: number;
        categories: string[];
      };
      expect(body.limit).toBe(20);
      expect(body.categories).toEqual(["a", "b", "c", "d", "e"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rejects disabled search and invalid query bounds before egress", async () => {
    const profile = defaultOnboardingProfile();
    profile.search.enabled = false;
    await Effect.runPromise(saveOnboarding({ profile }, vault));
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      return Promise.resolve(Response.json({}));
    }) as typeof fetch;
    try {
      const disabled = await Effect.runPromise(
        searchFastCrw({ query: "query" }, vault).pipe(Effect.flip),
      );
      expect(disabled.status).toBe(503);
      const empty = await Effect.runPromise(
        searchFastCrw({ query: "   " }, vault).pipe(Effect.flip),
      );
      expect(empty.status).toBe(400);
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("restricts inference paths, enforces body size, and injects keyring auth", async () => {
    secrets.set("vault:runtime:inference", "runtime-token");
    const originalFetch = globalThis.fetch;
    let request: Request | undefined;
    globalThis.fetch = ((input, init) => {
      request = new Request(input, init);
      return Promise.resolve(Response.json({ data: [] }));
    }) as typeof fetch;
    try {
      const denied = await Effect.runPromise(
        proxyOnboardingInference(new Request("http://localhost/anything"), ["admin"], vault).pipe(
          Effect.flip,
        ),
      );
      expect(denied.status).toBe(404);

      const oversized = await Effect.runPromise(
        proxyOnboardingInference(
          new Request("http://localhost/chat", {
            method: "POST",
            body: new Uint8Array(4 * 1024 * 1024 + 1),
          }),
          ["v1", "chat", "completions"],
          vault,
        ).pipe(Effect.flip),
      );
      expect(oversized.status).toBe(413);

      const response = await Effect.runPromise(
        proxyOnboardingInference(new Request("http://localhost/models"), ["v1", "models"], vault),
      );
      expect(response.status).toBe(200);
      expect(request?.url).toBe("http://127.0.0.1:18181/v1/models");
      expect(request?.headers.get("Authorization")).toBe("Bearer runtime-token");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("normalizes runtime endpoints to exactly one v1 segment", async () => {
    secrets.set("vault:runtime:inference", "runtime-token");
    const profile = defaultOnboardingProfile();
    profile.runtime.baseUrl = "http://localhost:8000";
    await Effect.runPromise(saveOnboarding({ profile }, vault));
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = ((input) => {
      urls.push(input instanceof Request ? input.url : String(input));
      return Promise.resolve(Response.json({ data: [] }));
    }) as typeof fetch;
    try {
      await Effect.runPromise(probeOnboardingTarget({ target: "runtime" }, vault));
      await Effect.runPromise(
        proxyOnboardingInference(
          new Request("http://localhost/proxy", {
            method: "POST",
            body: JSON.stringify({ model: profile.runtime.modelId, messages: [] }),
          }),
          ["v1", "chat", "completions"],
          vault,
        ),
      );
      expect(urls).toEqual([
        "http://localhost:8000/v1/models",
        "http://localhost:8000/v1/chat/completions",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("maps FastCRW recency to the upstream tbs field", async () => {
    const originalFetch = globalThis.fetch;
    let body = "";
    globalThis.fetch = ((_input, init) => {
      body = String(init?.body ?? "");
      return Promise.resolve(Response.json({ success: true, data: [] }));
    }) as typeof fetch;
    try {
      await Effect.runPromise(searchFastCrw({ query: "Ray security", recency: "qdr:w" }, vault));
      expect(JSON.parse(body)).toMatchObject({ query: "Ray security", tbs: "qdr:w" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("records and clears digest-bound enrollment receipts", async () => {
    const profile = defaultOnboardingProfile("2026-07-28T00:00:00.000Z");
    await Effect.runPromise(saveOnboarding({ profile }, vault));
    const recorded = await Effect.runPromise(
      recordOnboardingReceipt(
        {
          id: "onboarding-test",
          profileDigest: profileDigest(
            (await Effect.runPromise(getOnboardingState(vault))).profile,
          ),
          appliedAt: "2026-07-28T00:01:00.000Z",
          localAgentResults: [],
          probes: [],
        },
        vault,
      ),
    );
    expect(recorded.receipt?.id).toBe("onboarding-test");
    expect(recorded.receipt?.profileDigest).toMatch(/^sha256:/);
    await Effect.runPromise(clearOnboardingReceipt());
    expect((await Effect.runPromise(getOnboardingState(vault))).receipt).toBeNull();
  });

  test("persists rollback recovery evidence until lifecycle recovery completes", async () => {
    const profile = defaultOnboardingProfile();
    await Effect.runPromise(saveOnboarding({ profile }, vault));
    await Effect.runPromise(
      recordOnboardingRecovery({
        id: "recovery-test",
        operation: "apply",
        failedAt: "2026-07-28T00:02:00.000Z",
        profileDigest: profileDigest((await Effect.runPromise(getOnboardingState(vault))).profile),
        failures: ["remote connector: injected failure"],
        localAgentResults: [
          {
            agent: "pi",
            ok: true,
            configPath: "/tmp/pi-config",
            backupPath: "/tmp/pi-config.backup",
          },
        ],
        previousConnector: null,
      }),
    );
    const failed = await Effect.runPromise(getOnboardingState(vault));
    expect(failed.recovery?.failures).toEqual(["remote connector: injected failure"]);
    expect(failed.recovery?.localAgentResults?.[0]?.backupPath).toBe("/tmp/pi-config.backup");
    await Effect.runPromise(clearOnboardingReceipt());
    expect((await Effect.runPromise(getOnboardingState(vault))).recovery).toBeNull();
  });

  test("invalidates probes after a material profile change and preserves the active receipt", async () => {
    secrets.set("vault:runtime:inference", "runtime-token");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch;
    try {
      await Effect.runPromise(probeOnboardingTarget({ target: "runtime" }, vault));
      const before = await Effect.runPromise(getOnboardingState(vault));
      await Effect.runPromise(
        recordOnboardingReceipt(
          {
            id: "onboarding-active",
            profileDigest: profileDigest(before.profile),
            appliedAt: "2026-07-28T00:01:00.000Z",
            localAgentResults: [],
            probes: before.probes,
            previousConnector: null,
          },
          vault,
        ),
      );
      const changed = {
        ...before.profile,
        runtime: { ...before.profile.runtime, modelId: "gemma" },
      };
      const saved = await Effect.runPromise(saveOnboarding({ profile: changed }, vault));
      expect(saved.probes).toEqual([]);
      expect(saved.receipt?.id).toBe("onboarding-active");
      expect(saved.receipt?.profileDigest).not.toBe(profileDigest(saved.profile));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("keeps probes when only the non-material profile timestamp changes", async () => {
    secrets.set("vault:enterprise:jira", "jira-token");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch;
    try {
      await Effect.runPromise(probeOnboardingTarget({ target: "jira" }, vault));
      const before = await Effect.runPromise(getOnboardingState(vault));
      const saved = await Effect.runPromise(
        saveOnboarding(
          { profile: { ...before.profile, updatedAt: "2099-01-01T00:00:00.000Z" } },
          vault,
        ),
      );
      expect(saved.probes.map((probe) => probe.target)).toEqual(["jira"]);
      expect(profileDigest(saved.profile)).toBe(profileDigest(before.profile));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rolls back earlier credential mutations when a later keyring write fails", async () => {
    secrets.set("vault:enterprise:vault", "old-vault");
    secrets.set("vault:enterprise:gitlab", "old-gitlab");
    let failed = false;
    const failingVault: OAuthVault = {
      read: vault.read,
      remove: vault.remove,
      write: (key, value) =>
        Effect.try({
          try: () => {
            if (key === "vault:enterprise:gitlab" && !failed) {
              failed = true;
              throw new Error("injected keyring failure");
            }
            secrets.set(key, value);
          },
          catch: () => new Error("injected keyring failure"),
        }),
    };
    await Effect.runPromise(
      saveOnboarding(
        {
          profile: defaultOnboardingProfile(),
          credentials: [
            { ref: "vault:enterprise:vault", value: "new-vault" },
            { ref: "vault:enterprise:gitlab", value: "new-gitlab" },
          ],
        },
        failingVault,
      ).pipe(Effect.flip),
    );
    expect(secrets.get("vault:enterprise:vault")).toBe("old-vault");
    expect(secrets.get("vault:enterprise:gitlab")).toBe("old-gitlab");
  });

  test("requires the canonical C2 service set and credential references", async () => {
    const missing = defaultOnboardingProfile();
    missing.services = missing.services.slice(0, 2);
    const missingError = await Effect.runPromise(
      saveOnboarding({ profile: missing }, vault).pipe(Effect.flip),
    );
    expect(missingError.status).toBe(400);

    const mismatched = defaultOnboardingProfile();
    mismatched.services[0] = {
      ...mismatched.services[0]!,
      credentialRef: "vault:enterprise:gitlab",
    };
    const mismatchError = await Effect.runPromise(
      saveOnboarding({ profile: mismatched }, vault).pipe(Effect.flip),
    );
    expect(mismatchError.status).toBe(400);
  });
});
