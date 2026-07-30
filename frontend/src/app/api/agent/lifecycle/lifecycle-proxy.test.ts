import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { proxyAgentLifecycle } from "./proxy";
import { PUT as plan } from "./plan/route";

const originalToken = process.env.LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN;
const originalRuntimeUrl = process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL;
const originalFetch = globalThis.fetch;
const originalDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
const originalFrontendBase = process.env.LOCAL_STUDIO_FRONTEND_BASE;

afterEach(() => {
  if (originalToken === undefined) delete process.env.LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN;
  else process.env.LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN = originalToken;
  if (originalRuntimeUrl === undefined) delete process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL;
  else process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL = originalRuntimeUrl;
  globalThis.fetch = originalFetch;
  if (originalDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = originalDataDir;
  if (originalFrontendBase === undefined) delete process.env.LOCAL_STUDIO_FRONTEND_BASE;
  else process.env.LOCAL_STUDIO_FRONTEND_BASE = originalFrontendBase;
});

describe("agent lifecycle server credential proxy", () => {
  it("fails closed without a configured lifecycle credential", async () => {
    delete process.env.LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN;
    const response = await proxyAgentLifecycle(
      new Request("http://localhost/api/agent/lifecycle", {
        headers: { authorization: "Bearer browser-value" },
      }),
    );
    assert.equal(response.status, 503);
  });

  it("removes browser authorization and injects only the server credential", async () => {
    process.env.LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN = "server-only-value";
    process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL = "http://127.0.0.1:18081";
    let authorization = "";
    globalThis.fetch = async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json({ ok: true });
    };
    const response = await proxyAgentLifecycle(
      new Request("http://localhost/api/agent/lifecycle", {
        headers: { authorization: "Bearer browser-value" },
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(authorization, "Bearer server-only-value");
    assert.equal(await response.text(), '{"ok":true}');
  });

  it("binds plan locality and endpoint to trusted server state", async () => {
    process.env.LOCAL_STUDIO_DATA_DIR = "/tmp/local-studio-lifecycle-test";
    process.env.LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN = "server-only-value";
    process.env.LOCAL_STUDIO_FRONTEND_BASE = "http://127.0.0.1:3000";
    let upstream: unknown;
    globalThis.fetch = async (_input, init) => {
      upstream = JSON.parse(
        new TextDecoder().decode(
          init?.body instanceof ArrayBuffer
            ? init.body
            : new TextEncoder().encode(String(init?.body)),
        ),
      );
      return Response.json({
        version: 1,
        profile: null,
        receipt: null,
        recovery: null,
        updatedAt: new Date(0).toISOString(),
      });
    };
    const response = await plan(
      new NextRequest("http://attacker.invalid/api/agent/lifecycle/plan", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile: { version: 1 } }),
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(
      Reflect.get(Reflect.get(upstream as object, "locality"), "inferenceEndpoint"),
      "http://127.0.0.1:3000/api/agent/onboarding/inference/v1",
    );
    assert.equal(
      Reflect.get(Reflect.get(upstream as object, "locality"), "executionHome"),
      process.env.HOME,
    );
  });

  it("fails closed when the trusted frontend base is absent", async () => {
    process.env.LOCAL_STUDIO_DATA_DIR = "/tmp/local-studio-lifecycle-test";
    process.env.LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN = "server-only-value";
    delete process.env.LOCAL_STUDIO_FRONTEND_BASE;
    const response = await plan(
      new NextRequest("http://localhost/api/agent/lifecycle/plan", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile: { version: 1 } }),
      }),
    );
    assert.equal(response.status, 503);
  });
});
