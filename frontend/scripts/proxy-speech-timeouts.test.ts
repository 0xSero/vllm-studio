import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getUpstreamTimeoutMs } from "../src/app/api/proxy/[...path]/proxy-timeouts";

describe("speech proxy timeouts", () => {
  test("allows local speech generation to warm and synthesize", () => {
    assert.equal(getUpstreamTimeoutMs(["v1", "audio", "speech"], "POST"), 360_000);
  });

  test("bounds speech setup and cancellation as system operations", () => {
    assert.equal(getUpstreamTimeoutMs(["v1", "audio", "install"], "POST"), 20_000);
    assert.equal(getUpstreamTimeoutMs(["v1", "audio", "install", "cancel"], "POST"), 20_000);
  });

  test("allows reference normalization without extending voice reads", () => {
    assert.equal(getUpstreamTimeoutMs(["v1", "audio", "voices"], "POST"), 120_000);
    assert.equal(getUpstreamTimeoutMs(["v1", "audio", "voices"], "GET"), 5_000);
  });

  test("bounds speech worker shutdown", () => {
    assert.equal(getUpstreamTimeoutMs(["v1", "audio", "runtime", "stop"], "POST"), 20_000);
  });
});
