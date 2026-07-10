import assert from "node:assert/strict";
import test from "node:test";
import {
  ProxyBodyTooLargeError,
  readProxyRequestBody,
} from "../src/app/api/proxy/[...path]/proxy-fetch";
import { toProxyNextResponse } from "../src/app/api/proxy/[...path]/proxy-response";

test("preserves binary controller request bodies byte for byte", async () => {
  const bytes = Uint8Array.from([0, 255, 26, 10, 128]);
  const body = await readProxyRequestBody(
    new Request("http://localhost/speech/voices", { method: "POST", body: bytes }),
    "POST",
  );

  assert.deepEqual(new Uint8Array(body ?? new ArrayBuffer(0)), bytes);
});

test("rejects chunked request bodies at the configured byte boundary", async () => {
  const request = new Request("http://localhost/speech/voices", {
    method: "POST",
    body: Uint8Array.from([1, 2, 3, 4]),
  });

  await assert.rejects(() => readProxyRequestBody(request, "POST", 3), ProxyBodyTooLargeError);
});

test("preserves binary controller responses byte for byte", async () => {
  const bytes = Uint8Array.from([0, 255, 82, 73, 70, 70, 128, 10]);
  const response = await toProxyNextResponse(
    new Response(bytes, { headers: { "content-type": "audio/wav" } }),
    {
      client: { ip: "127.0.0.1", country: "local", ua: "test" },
      invalidateOverride: false,
      method: "POST",
      path: ["v1", "audio", "speech"],
    },
  );

  assert.equal(response.headers.get("content-type"), "audio/wav");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});
