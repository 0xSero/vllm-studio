import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  HARNESS_INTEGRATION_CONTRACT_VERSION,
  HARNESS_REMOTE_DATA_CONSENT_HEADER,
  HARNESS_REMOTE_DATA_CONSENT_VERSION,
} from "@shared/agent/harness";
import {
  downstreamResponseHeaders,
  harnessIntegrationContract,
  harnessToken,
  harnessTargetUrl,
  isHarnessRouteAllowed,
  projectHarnessPayload,
  proxyToManagedHarness,
  proxyToProviderHarness,
  upstreamRequestHeaders,
} from "./proxy-to-harness";

describe("Local Studio Harness proxy headers", () => {
  test("forwards only protocol headers required by the Harness API", () => {
    const source = new Headers({
      accept: "application/json",
      authorization: "Bearer test-token",
      cookie: "local_studio_token=cookie-token",
      "content-type": "application/json",
      origin: "http://127.0.0.1:4783",
      referer: "http://127.0.0.1:4783/harness",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "sec-fetch-user": "?1",
      "x-local-studio-csrf": "csrf-token",
      "x-local-studio-token": "header-token",
      "x-request-id": "request-1",
    });

    const upstream = upstreamRequestHeaders(source);

    for (const name of [
      "authorization",
      "cookie",
      "origin",
      "referer",
      "sec-fetch-dest",
      "sec-fetch-mode",
      "sec-fetch-site",
      "sec-fetch-user",
      "x-local-studio-csrf",
      "x-local-studio-token",
    ]) {
      assert.equal(upstream.get(name), null, `${name} must not cross the proxy boundary`);
    }
    assert.equal(upstream.get("accept"), "application/json");
    assert.equal(upstream.get("content-type"), "application/json");
    assert.equal(upstream.get("x-request-id"), "request-1");
    assert.equal(source.get("origin"), "http://127.0.0.1:4783");
  });

  test("still removes hop-by-hop transport headers", () => {
    const source = new Headers({
      host: "127.0.0.1:4783",
      connection: "keep-alive",
      "content-length": "42",
      "accept-encoding": "gzip, br",
      "content-type": "application/json",
    });

    const upstream = upstreamRequestHeaders(source);

    for (const name of ["host", "connection", "content-length", "accept-encoding"]) {
      assert.equal(upstream.get(name), null, `${name} must not cross the proxy boundary`);
    }
    assert.equal(upstream.get("content-type"), "application/json");
  });

  test("does not let the Harness set Local Studio cookies", () => {
    const downstream = downstreamResponseHeaders(
      new Headers({
        "content-type": "application/json",
        "set-cookie": "local_studio_token=attacker-controlled",
        "x-request-id": "request-2",
      }),
    );

    assert.equal(downstream.get("set-cookie"), null);
    assert.equal(downstream.get("content-type"), "application/json");
    assert.equal(downstream.get("x-request-id"), "request-2");
  });

  test("rejects dot segments before URL normalization can escape the API namespace", () => {
    assert.throws(() => harnessTargetUrl(["..", "admin"], "api"), /dot segments/);
    assert.throws(() => harnessTargetUrl(["%2e%2e", "admin"], "api"), /dot segments/);
  });

  test("keeps managed goals on the explicit /api namespace", () => {
    assert.equal(
      harnessTargetUrl(["tasks", "current", "stop"], "api"),
      "http://127.0.0.1:8771/api/tasks/current/stop",
    );
    assert.equal(
      harnessTargetUrl(["tasks", "current"], "v1"),
      "http://127.0.0.1:8771/v1/tasks/current",
    );
  });

  test("keeps provider-neutral goals on their isolated upstream", () => {
    assert.equal(harnessTargetUrl(["tasks"], "api", "provider"), "http://127.0.0.1:8772/api/tasks");
  });

  test("allows only the Harness routes used by the product UI", () => {
    assert.equal(isHarnessRouteAllowed("GET", ["routes"], "v1", "managed"), true);
    assert.equal(isHarnessRouteAllowed("POST", ["tasks"], "v1", "managed"), true);
    assert.equal(
      isHarnessRouteAllowed("GET", ["tasks", "goal-1", "events"], "v1", "managed"),
      true,
    );
    assert.equal(
      isHarnessRouteAllowed("POST", ["tasks", "current", "continue"], "api", "managed"),
      true,
    );
    assert.equal(isHarnessRouteAllowed("POST", ["setup", "test"], "api", "provider"), true);
    assert.equal(isHarnessRouteAllowed("POST", ["setup"], "api", "managed"), false);
    assert.equal(
      isHarnessRouteAllowed("GET", ["tasks", "current", "file"], "api", "managed"),
      false,
    );
    assert.equal(isHarnessRouteAllowed("POST", ["tasks", "bulk"], "api", "managed"), false);
  });

  test("reads a dedicated server-side token for each Harness target", () => {
    const previousManaged = process.env.LOCAL_STUDIO_HARNESS_TOKEN;
    const previousProvider = process.env.LOCAL_STUDIO_PROVIDER_HARNESS_TOKEN;
    process.env.LOCAL_STUDIO_HARNESS_TOKEN = "managed-token";
    process.env.LOCAL_STUDIO_PROVIDER_HARNESS_TOKEN = "provider-token";
    try {
      assert.equal(harnessToken("managed"), "managed-token");
      assert.equal(harnessToken("provider"), "provider-token");
    } finally {
      if (previousManaged === undefined) delete process.env.LOCAL_STUDIO_HARNESS_TOKEN;
      else process.env.LOCAL_STUDIO_HARNESS_TOKEN = previousManaged;
      if (previousProvider === undefined) delete process.env.LOCAL_STUDIO_PROVIDER_HARNESS_TOKEN;
      else process.env.LOCAL_STUDIO_PROVIDER_HARNESS_TOKEN = previousProvider;
    }
  });

  test("always marks browser traffic through Local Studio as remote", async () => {
    const previousToken = process.env.LOCAL_STUDIO_PROVIDER_HARNESS_TOKEN;
    const previousFetch = globalThis.fetch;
    let forwardedHeaders: Headers | undefined;
    process.env.LOCAL_STUDIO_PROVIDER_HARNESS_TOKEN = "provider-token";
    globalThis.fetch = (async (_input, init) => {
      forwardedHeaders = new Headers(init?.headers);
      return Response.json({ ok: true });
    }) as typeof fetch;
    try {
      const response = await proxyToProviderHarness(
        new Request("https://studio.example/api/harness/provider/setup", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [HARNESS_REMOTE_DATA_CONSENT_HEADER]: HARNESS_REMOTE_DATA_CONSENT_VERSION,
            "x-forwarded-host": "127.0.0.1",
          },
          body: "{}",
        }),
        ["setup"],
      );

      assert.equal(response.status, 200);
      assert.equal(forwardedHeaders?.get("authorization"), "Bearer provider-token");
      assert.equal(forwardedHeaders?.get("x-agentic-harness-client-scope"), "remote");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousToken === undefined) delete process.env.LOCAL_STUDIO_PROVIDER_HARNESS_TOKEN;
      else process.env.LOCAL_STUDIO_PROVIDER_HARNESS_TOKEN = previousToken;
    }
  });

  test("blocks every mutation without the current remote-data consent contract", async () => {
    const previousToken = process.env.LOCAL_STUDIO_PROVIDER_HARNESS_TOKEN;
    const previousFetch = globalThis.fetch;
    let fetchCalls = 0;
    process.env.LOCAL_STUDIO_PROVIDER_HARNESS_TOKEN = "provider-token";
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return Response.json({ ok: true });
    }) as typeof fetch;
    try {
      const response = await proxyToProviderHarness(
        new Request("https://studio.example/api/harness/provider/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ objective: "Do not forward me" }),
        }),
        ["tasks"],
      );
      const payload = (await response.json()) as { code?: string; consent_version?: string };

      assert.equal(response.status, 428);
      assert.equal(payload.code, "harness_remote_data_consent_required");
      assert.equal(payload.consent_version, HARNESS_REMOTE_DATA_CONSENT_VERSION);
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousToken === undefined) delete process.env.LOCAL_STUDIO_PROVIDER_HARNESS_TOKEN;
      else process.env.LOCAL_STUDIO_PROVIDER_HARNESS_TOKEN = previousToken;
    }
  });

  test("publishes external ownership and lifecycle limits on setup", async () => {
    const previousToken = process.env.LOCAL_STUDIO_HARNESS_TOKEN;
    const previousFetch = globalThis.fetch;
    process.env.LOCAL_STUDIO_HARNESS_TOKEN = "managed-token";
    globalThis.fetch = (async () => Response.json({ configured: true })) as typeof fetch;
    try {
      const response = await proxyToManagedHarness(
        new Request("https://studio.example/api/harness/managed/setup"),
        ["setup"],
      );
      const payload = (await response.json()) as {
        configured?: boolean;
        integration?: ReturnType<typeof harnessIntegrationContract>;
      };

      assert.equal(response.status, 200);
      assert.equal(payload.configured, true);
      assert.equal(payload.integration?.contract, HARNESS_INTEGRATION_CONTRACT_VERSION);
      assert.equal(payload.integration?.ownership, "external");
      assert.deepEqual(payload.integration?.lifecycle, {
        state: "reachable",
        install: "external",
        start: "external",
        stop: "external",
      });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousToken === undefined) delete process.env.LOCAL_STUDIO_HARNESS_TOKEN;
      else process.env.LOCAL_STUDIO_HARNESS_TOKEN = previousToken;
    }
  });

  test("projects task responses without raw worker output or unknown fields", () => {
    const projected = projectHarnessPayload(
      {
        task: {
          id: "task-1",
          status: "done",
          summary: "Safe result summary",
          advanced_details: { stdout: "raw-secret-value" },
          events: [
            {
              seq: 4,
              checkpoint: "verification_complete",
              summary: "raw-secret-value",
              output: "raw-secret-value",
            },
          ],
          verification: ["raw-secret-value"],
          metadata: {
            observed_at: "2026-08-04T12:00:00Z",
            "raw-secret-value": true,
          },
        },
        "raw-secret-value": { leaked: true },
      },
      "api",
      ["tasks", "current"],
      "managed",
    );
    const serialized = JSON.stringify(projected);
    const task = projected?.task as {
      events?: Array<Record<string, unknown>>;
      verification?: Array<Record<string, unknown>>;
    };

    assert.ok(projected);
    assert.equal(serialized.includes("raw-secret-value"), false);
    assert.deepEqual(task.events, [{ seq: 4, checkpoint: "verification_complete" }]);
    assert.equal(task.verification?.[0]?.passed, false);
    assert.equal(task.verification?.[0]?.source, "legacy");
  });
});
