import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/lib/api/create-api-client";

test("usage analytics fail after one upstream response instead of retrying the page waterfall", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return Response.json({ error: "unavailable" }, { status: 504 });
  };
  const api = createApiClient({ baseUrl: "http://usage.test", useProxy: false });

  try {
    await assert.rejects(() => api.getUsageStats(), /504/);
    assert.equal(requests, 1);

    requests = 0;
    await assert.rejects(() => api.getPiSessionsUsageStats(), /504/);
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
