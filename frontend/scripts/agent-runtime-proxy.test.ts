import assert from "node:assert/strict";
import test from "node:test";
import { agentRuntimeBaseUrl, proxyToAgentRuntime } from "../src/app/api/agent/proxy-to-runtime";

test("agent routes use the canonical runtime and preserve transport", async () => {
  const originalRuntimeUrl = process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL;
  const originalFetch = globalThis.fetch;
  const requests: Array<{ body: string; headers: Headers; url: string }> = [];

  try {
    delete process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL;
    assert.equal(agentRuntimeBaseUrl(), "http://127.0.0.1:8081");

    process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL = "http://127.0.0.1:18081///";
    globalThis.fetch = async (input, init) => {
      const body = init?.body instanceof ArrayBuffer ? new TextDecoder().decode(init.body) : "";
      requests.push({ body, headers: new Headers(init?.headers), url: String(input) });
      return new Response("runtime response", {
        headers: {
          "content-encoding": "gzip",
          "content-length": "16",
          "content-type": "text/plain",
        },
      });
    };

    const response = await proxyToAgentRuntime(
      new Request("http://studio.test/api/agent/turn?stream=1", {
        body: "request body",
        headers: { connection: "keep-alive", "x-session-id": "session-1" },
        method: "POST",
      }),
    );

    assert.equal(requests[0]?.url, "http://127.0.0.1:18081/api/agent/turn?stream=1");
    assert.equal(requests[0]?.body, "request body");
    assert.equal(requests[0]?.headers.get("connection"), null);
    assert.equal(requests[0]?.headers.get("x-session-id"), "session-1");
    assert.equal(response.headers.get("content-length"), null);
    assert.equal(response.headers.get("content-encoding"), null);
    assert.equal(await response.text(), "runtime response");

    globalThis.fetch = async () => {
      throw new Error("offline");
    };
    const unavailable = await proxyToAgentRuntime(
      new Request("http://studio.test/api/agent/runtime/status"),
    );
    assert.equal(unavailable.status, 502);
    assert.match(await unavailable.text(), /agent runtime unreachable/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalRuntimeUrl === undefined) delete process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL;
    else process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL = originalRuntimeUrl;
  }
});
