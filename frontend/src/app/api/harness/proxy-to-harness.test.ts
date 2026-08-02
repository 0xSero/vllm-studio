import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  downstreamResponseHeaders,
  harnessToken,
  harnessTargetUrl,
  isHarnessRouteAllowed,
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
});
