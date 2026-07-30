import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { createServer, type Server } from "node:http";
import { proxyToAgentRuntime } from "../../app/api/agent/proxy-to-runtime";

let server: Server;
let receivedHeaders: Record<string, string | string[] | undefined> = {};
const originalRuntimeUrl = process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL;

before(async () => {
  server = createServer((request, response) => {
    receivedHeaders = request.headers;
    response.setHeader("content-type", "application/json");
    response.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Runtime fixture did not bind");
  process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL = `http://127.0.0.1:${address.port}`;
});

after(() => {
  server.close();
  if (originalRuntimeUrl === undefined) delete process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL;
  else process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL = originalRuntimeUrl;
});

describe("agent runtime enterprise proxy", () => {
  test("removes browser credentials and spoofed identity headers", async () => {
    const response = await proxyToAgentRuntime(
      new Request("http://frontend/api/agent/runtime/status", {
        headers: {
          authorization: "Bearer browser-token",
          cookie: "local_studio_enterprise_session=forged",
          "x-local-studio-enterprise-token": "forged-token",
          "x-local-studio-enterprise-subject": "forged-subject",
          "x-local-studio-enterprise-issuer": "https://forged.example.test",
          "x-local-studio-enterprise-issuer-id": "forged-issuer",
          "x-local-studio-enterprise-tenant": "forged-tenant",
          "x-local-studio-enterprise-clearance": "C2",
          "x-local-studio-enterprise-roles": "platform_admin",
          "x-spiffe-jwt-svid": "forged-workload-token",
        },
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(receivedHeaders["authorization"], undefined);
    assert.equal(receivedHeaders["cookie"], undefined);
    assert.equal(receivedHeaders["x-local-studio-enterprise-token"], undefined);
    assert.equal(receivedHeaders["x-local-studio-enterprise-subject"], undefined);
    assert.equal(receivedHeaders["x-local-studio-enterprise-issuer"], undefined);
    assert.equal(receivedHeaders["x-local-studio-enterprise-issuer-id"], undefined);
    assert.equal(receivedHeaders["x-local-studio-enterprise-tenant"], undefined);
    assert.equal(receivedHeaders["x-local-studio-enterprise-clearance"], undefined);
    assert.equal(receivedHeaders["x-local-studio-enterprise-roles"], undefined);
    assert.equal(receivedHeaders["x-spiffe-jwt-svid"], undefined);
  });
});
