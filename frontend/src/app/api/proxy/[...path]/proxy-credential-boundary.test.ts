import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { NextRequest } from "next/server";
import { buildProxyRequestHeaders, getForwardedSearchParams } from "./proxy-fetch";

describe("query credential boundary", () => {
  test("detects and strips proxy API keys without converting them to bearer headers", () => {
    const request = new NextRequest(
      "http://localhost/api/proxy/v1/models?api_key=secret&access_token=other&limit=2",
    );
    assert.deepEqual(getForwardedSearchParams(request), {
      credentialQueryPresent: true,
      searchParams: "limit=2",
    });
    assert.equal(buildProxyRequestHeaders(request, "").has("authorization"), false);
  });

  test("uses only an authorization header or persisted controller credential", () => {
    const request = new NextRequest("http://localhost/api/proxy/v1/models", {
      headers: { authorization: "Bearer incoming" },
    });
    assert.equal(
      buildProxyRequestHeaders(request, "persisted").get("authorization"),
      "Bearer incoming",
    );
    const source = readFileSync(new URL("../../../../proxy.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /searchParams\.get\("token"\)/u);
  });

  test("forwards only bounded scientific evidence references", () => {
    const accepted = new NextRequest("http://localhost/api/proxy/ai/v1/responses", {
      headers: { "x-local-studio-scientific-submission-id": "submission-01" },
    });
    const rejected = new NextRequest("http://localhost/api/proxy/ai/v1/responses", {
      headers: { "x-local-studio-scientific-submission-id": "../other-submission" },
    });
    assert.equal(
      buildProxyRequestHeaders(accepted, "").get("x-local-studio-scientific-submission-id"),
      "submission-01",
    );
    assert.equal(
      buildProxyRequestHeaders(rejected, "").has("x-local-studio-scientific-submission-id"),
      false,
    );
  });
});
