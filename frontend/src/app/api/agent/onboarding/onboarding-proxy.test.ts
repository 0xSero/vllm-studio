import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { proxyAgentOnboarding } from "./proxy";

const original = {
  fetch: globalThis.fetch,
  lifecycle: process.env.LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN,
  onboarding: process.env.LOCAL_STUDIO_AGENT_ONBOARDING_TOKEN,
  runtime: process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL,
};

afterEach(() => {
  globalThis.fetch = original.fetch;
  for (const [name, value] of [
    ["LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN", original.lifecycle],
    ["LOCAL_STUDIO_AGENT_ONBOARDING_TOKEN", original.onboarding],
    ["LOCAL_STUDIO_AGENT_RUNTIME_URL", original.runtime],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("agent onboarding front door", () => {
  it("fails closed without an internal service credential", async () => {
    delete process.env.LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN;
    delete process.env.LOCAL_STUDIO_AGENT_ONBOARDING_TOKEN;
    const response = await proxyAgentOnboarding(
      new Request("http://localhost/api/agent/onboarding"),
    );
    assert.equal(response.status, 503);
  });

  it("replaces browser authorization and preserves the onboarding path", async () => {
    process.env.LOCAL_STUDIO_AGENT_ONBOARDING_TOKEN = "onboarding-secret";
    process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL = "http://127.0.0.1:18081";
    let target = "";
    let authorization = "";
    globalThis.fetch = async (input, init) => {
      target = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json({ profile: null });
    };
    const response = await proxyAgentOnboarding(
      new Request("http://localhost/api/agent/onboarding", {
        headers: { authorization: "Bearer browser-secret" },
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(target, "http://127.0.0.1:18081/api/agent/onboarding");
    assert.equal(authorization, "Bearer onboarding-secret");
  });

  it("bounds credential bodies before runtime forwarding", async () => {
    process.env.LOCAL_STUDIO_AGENT_ONBOARDING_TOKEN = "onboarding-secret";
    let contacted = false;
    globalThis.fetch = async () => {
      contacted = true;
      return Response.json({});
    };
    const response = await proxyAgentOnboarding(
      new Request("http://localhost/api/agent/onboarding", {
        method: "PUT",
        body: "x".repeat(1024 * 1024 + 1),
      }),
      undefined,
      1024 * 1024,
    );
    assert.equal(response.status, 413);
    assert.equal(contacted, false);
  });
});
