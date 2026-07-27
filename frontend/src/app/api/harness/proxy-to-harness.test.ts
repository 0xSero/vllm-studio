import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { upstreamRequestHeaders } from "./proxy-to-harness";

describe("Local Studio Harness proxy headers", () => {
  test("removes browser-origin metadata from the internal upstream request", () => {
    const source = new Headers({
      accept: "application/json",
      authorization: "Bearer test-token",
      "content-type": "application/json",
      origin: "http://127.0.0.1:4783",
      referer: "http://127.0.0.1:4783/harness",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "sec-fetch-user": "?1",
      "x-request-id": "request-1",
    });

    const upstream = upstreamRequestHeaders(source);

    for (const name of [
      "origin",
      "sec-fetch-dest",
      "sec-fetch-mode",
      "sec-fetch-site",
      "sec-fetch-user",
    ]) {
      assert.equal(upstream.get(name), null, `${name} must not cross the proxy boundary`);
    }
    assert.equal(upstream.get("authorization"), "Bearer test-token");
    assert.equal(upstream.get("content-type"), "application/json");
    assert.equal(upstream.get("referer"), "http://127.0.0.1:4783/harness");
    assert.equal(upstream.get("x-request-id"), "request-1");
    assert.equal(source.get("origin"), "http://127.0.0.1:4783");
  });
});
