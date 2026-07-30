import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { proxyProvisioning } from "./proxy";
import { POST as setup } from "./setup/route";

const original = {
  fetch: globalThis.fetch,
  lifecycle: process.env.LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN,
  provisioning: process.env.LOCAL_STUDIO_PROVISIONING_TOKEN,
  runtime: process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL,
  dataDir: process.env.LOCAL_STUDIO_DATA_DIR,
};

afterEach(() => {
  globalThis.fetch = original.fetch;
  for (const [name, value] of [
    ["LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN", original.lifecycle],
    ["LOCAL_STUDIO_PROVISIONING_TOKEN", original.provisioning],
    ["LOCAL_STUDIO_AGENT_RUNTIME_URL", original.runtime],
    ["LOCAL_STUDIO_DATA_DIR", original.dataDir],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("provisioning coordinator front door", () => {
  it("fails closed without a server credential", async () => {
    delete process.env.LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN;
    delete process.env.LOCAL_STUDIO_PROVISIONING_TOKEN;
    const response = await proxyProvisioning(
      new Request("http://localhost/api/agent/provisioning"),
      "/api/provisioning",
    );
    assert.equal(response.status, 503);
  });

  it("rewrites the upstream path and replaces browser authorization", async () => {
    process.env.LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN = "lifecycle-secret";
    process.env.LOCAL_STUDIO_PROVISIONING_TOKEN = "provisioning-secret";
    process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL = "http://127.0.0.1:18081";
    let target = "";
    let authorization = "";
    globalThis.fetch = async (input, init) => {
      target = String(input);
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json({ phase: "idle" });
    };
    const response = await proxyProvisioning(
      new Request("http://localhost/api/agent/provisioning?view=lineage", {
        headers: { authorization: "Bearer browser-secret" },
      }),
      "/api/provisioning",
    );
    assert.equal(response.status, 200);
    assert.equal(target, "http://127.0.0.1:18081/api/provisioning?view=lineage");
    assert.equal(authorization, "Bearer provisioning-secret");
  });

  it("bounds setup bodies before contacting the runtime", async () => {
    process.env.LOCAL_STUDIO_DATA_DIR = "/tmp/local-studio-provisioning-test";
    process.env.LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN = "lifecycle-secret";
    let contacted = false;
    globalThis.fetch = async () => {
      contacted = true;
      return Response.json({});
    };
    const response = await setup(
      new NextRequest("http://localhost/api/agent/provisioning/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ padding: "x".repeat(1024 * 1024) }),
      }),
    );
    assert.equal(response.status, 413);
    assert.equal(contacted, false);
  });
});
