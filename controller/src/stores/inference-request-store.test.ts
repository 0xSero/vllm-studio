import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InferenceRequestStore } from "./inference-request-store";

const temporaryDatabasePath = (): string =>
  join(mkdtempSync(join(tmpdir(), "inf-req-store-")), "test.db");

describe("InferenceRequestStore", () => {
  it("returns null when no records match the known model filter", () => {
    const store = new InferenceRequestStore(temporaryDatabasePath());
    store.record({ model: "external-model", prompt_tokens: 10, completion_tokens: 5 });
    expect(store.aggregate(new Set(["our-model"]))).toBeNull();
  });

  it("returns null when knownModels is empty (no provider models defined)", () => {
    const store = new InferenceRequestStore(temporaryDatabasePath());
    store.record({ model: "anything", prompt_tokens: 10, completion_tokens: 5 });
    expect(store.aggregate(new Set())).toBeNull();
  });

  it("aggregates totals, by_model, and recent activity for known models only", () => {
    const store = new InferenceRequestStore(temporaryDatabasePath());
    store.record({
      model: "glm-4.7",
      prompt_tokens: 100,
      completion_tokens: 20,
      duration_ms: 500,
      ttft_ms: 100,
    });
    store.record({
      model: "glm-4.7",
      prompt_tokens: 200,
      completion_tokens: 40,
      duration_ms: 700,
      ttft_ms: 120,
    });
    // External model that should be filtered out:
    store.record({
      model: "claude-opus-4-5",
      prompt_tokens: 5000,
      completion_tokens: 1000,
    });

    const result = store.aggregate(new Set(["glm-4.7"]));
    expect(result).not.toBeNull();
    expect(result!["totals"]).toMatchObject({
      total_requests: 2,
      prompt_tokens: 300,
      completion_tokens: 60,
      total_tokens: 360,
      successful_requests: 2,
      success_rate: 100,
    });
    const byModel = result!["by_model"] as Array<Record<string, unknown>>;
    expect(byModel).toHaveLength(1);
    expect(byModel[0]).toMatchObject({
      model: "glm-4.7",
      requests: 2,
      total_tokens: 360,
      avg_latency_ms: 600,
      avg_ttft_ms: 110,
    });
    const recent = result!["recent_activity"] as Record<string, unknown>;
    expect(recent["last_24h_requests"]).toBe(2);
  });

  it("tracks failed requests via non-2xx status", () => {
    const store = new InferenceRequestStore(temporaryDatabasePath());
    store.record({
      model: "glm-4.7",
      prompt_tokens: 10,
      completion_tokens: 5,
      status: 200,
    });
    store.record({
      model: "glm-4.7",
      prompt_tokens: 10,
      completion_tokens: 0,
      status: 500,
    });
    const result = store.aggregate(new Set(["glm-4.7"]));
    expect(result!["totals"]).toMatchObject({
      total_requests: 2,
      successful_requests: 1,
      failed_requests: 1,
      success_rate: 50,
    });
  });
});
