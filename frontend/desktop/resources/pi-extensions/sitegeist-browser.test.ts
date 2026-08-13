import assert from "node:assert/strict";
import { test } from "bun:test";
import { relayCapabilities, type RelayConfig } from "./sitegeist-browser";

test("sitegeist capability discovery releases a stalled runtime startup", async () => {
  const config: RelayConfig = {
    relayUrl: "http://127.0.0.1:7717",
    sessionId: "session-a",
    timeoutMs: 120_000,
    token: "",
  };
  const request = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })) as typeof fetch;
  const started = Date.now();
  assert.equal(await relayCapabilities(config, request, 20), null);
  assert.ok(Date.now() - started < 500);
});

test("sitegeist capability discovery times out a stalled response body", async () => {
  const config: RelayConfig = {
    relayUrl: "http://127.0.0.1:7717",
    sessionId: "session-a",
    timeoutMs: 120_000,
    token: "",
  };
  const request = ((_input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        new Promise<unknown>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    } as Response)) as typeof fetch;
  assert.equal(await relayCapabilities(config, request, 20), null);
});
