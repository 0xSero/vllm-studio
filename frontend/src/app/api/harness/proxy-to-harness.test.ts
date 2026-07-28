import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  downstreamResponseHeaders,
  harnessTargetUrl,
  upstreamRequestHeaders,
} from "./proxy-to-harness";

describe("Local Studio Harness proxy headers", () => {
  test("forwards only protocol headers required by the Harness API", () => {
    const source = new Headers({
      accept: "application/json",
      authorization: "Bearer test-token",
      cookie: "local_studio_token=cookie-token",
      "content-type": "application/json",
      origin: "http://127.0.0.1:4783",
      referer: "http://127.0.0.1:4783/harness",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "sec-fetch-user": "?1",
      "x-local-studio-csrf": "csrf-token",
      "x-local-studio-token": "header-token",
      "x-request-id": "request-1",
    });

    const upstream = upstreamRequestHeaders(source);

    for (const name of [
      "authorization",
      "cookie",
      "origin",
      "referer",
      "sec-fetch-dest",
      "sec-fetch-mode",
      "sec-fetch-site",
      "sec-fetch-user",
      "x-local-studio-csrf",
      "x-local-studio-token",
    ]) {
      assert.equal(upstream.get(name), null, `${name} must not cross the proxy boundary`);
    }
    assert.equal(upstream.get("accept"), "application/json");
    assert.equal(upstream.get("content-type"), "application/json");
    assert.equal(upstream.get("x-request-id"), "request-1");
    assert.equal(source.get("origin"), "http://127.0.0.1:4783");
  });

  test("still removes hop-by-hop transport headers", () => {
    const source = new Headers({
      host: "127.0.0.1:4783",
      connection: "keep-alive",
      "content-length": "42",
      "accept-encoding": "gzip, br",
      "content-type": "application/json",
    });

    const upstream = upstreamRequestHeaders(source);

    for (const name of ["host", "connection", "content-length", "accept-encoding"]) {
      assert.equal(upstream.get(name), null, `${name} must not cross the proxy boundary`);
    }
    assert.equal(upstream.get("content-type"), "application/json");
  });

  test("does not let the Harness set Local Studio cookies", () => {
    const downstream = downstreamResponseHeaders(
      new Headers({
        "content-type": "application/json",
        "set-cookie": "local_studio_token=attacker-controlled",
        "x-request-id": "request-2",
      }),
    );

    assert.equal(downstream.get("set-cookie"), null);
    assert.equal(downstream.get("content-type"), "application/json");
    assert.equal(downstream.get("x-request-id"), "request-2");
  });

  test("rejects dot segments before URL normalization can escape the API namespace", () => {
    assert.throws(() => harnessTargetUrl(["..", "admin"], "api"), /dot segments/);
    assert.throws(() => harnessTargetUrl(["%2e%2e", "admin"], "api"), /dot segments/);
  });

  test("keeps managed goals on the explicit /api namespace", () => {
    assert.equal(
      harnessTargetUrl(["tasks", "current", "stop"], "api"),
      "http://127.0.0.1:8771/api/tasks/current/stop",
    );
    assert.equal(
      harnessTargetUrl(["tasks", "current"], "v1"),
      "http://127.0.0.1:8771/v1/tasks/current",
    );
  });

  test("keeps provider-neutral goals on their isolated upstream", () => {
    assert.equal(harnessTargetUrl(["tasks"], "api", "provider"), "http://127.0.0.1:8772/api/tasks");
  });
});
