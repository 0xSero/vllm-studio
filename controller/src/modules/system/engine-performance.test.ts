import { describe, expect, test } from "bun:test";
import { VLLM_METRIC_NAMES } from "./engine-metrics-scrape";
import { EnginePerformanceTracker } from "./engine-performance";

const metricSample = ({
  completedRequests,
  decodeSeconds,
  generationTokens,
  prefillSeconds,
  promptTokens,
}: {
  completedRequests: number;
  decodeSeconds: number;
  generationTokens: number;
  prefillSeconds: number;
  promptTokens: number;
}): Record<string, number> => ({
  "vllm:e2e_request_latency_seconds_count": completedRequests,
  "vllm:generation_tokens_total": generationTokens,
  "vllm:prompt_tokens_total": promptTokens,
  "vllm:request_decode_time_seconds_sum": decodeSeconds,
  "vllm:request_generation_tokens_sum": generationTokens,
  "vllm:request_prefill_time_seconds_sum": prefillSeconds,
  "vllm:request_prompt_tokens_sum": promptTokens,
});

describe("engine performance tracking", () => {
  test("keeps completed-request throughput after the engine returns idle", () => {
    const tracker = new EnginePerformanceTracker();
    const baseline = metricSample({
      completedRequests: 1,
      decodeSeconds: 4,
      generationTokens: 200,
      prefillSeconds: 0.5,
      promptTokens: 100,
    });
    const active = metricSample({
      completedRequests: 1,
      decodeSeconds: 4,
      generationTokens: 350,
      prefillSeconds: 0.5,
      promptTokens: 500,
    });
    active["vllm:request_generation_tokens_sum"] = 200;
    active["vllm:request_prompt_tokens_sum"] = 100;
    const completed = metricSample({
      completedRequests: 2,
      decodeSeconds: 10,
      generationTokens: 500,
      prefillSeconds: 1.5,
      promptTokens: 500,
    });

    tracker.observe({
      key: "qwen:1",
      metrics: baseline,
      names: VLLM_METRIC_NAMES,
      observedAt: 0,
      pendingRequests: 0,
      runningRequests: 0,
    });
    const live = tracker.observe({
      key: "qwen:1",
      metrics: active,
      names: VLLM_METRIC_NAMES,
      observedAt: 5_000,
      pendingRequests: 0,
      runningRequests: 1,
    });
    const finished = tracker.observe({
      key: "qwen:1",
      metrics: completed,
      names: VLLM_METRIC_NAMES,
      observedAt: 10_000,
      pendingRequests: 0,
      runningRequests: 0,
    });
    const idle = tracker.observe({
      key: "qwen:1",
      metrics: completed,
      names: VLLM_METRIC_NAMES,
      observedAt: 15_000,
      pendingRequests: 0,
      runningRequests: 0,
    });

    expect(live.generationThroughput).toBe(30);
    expect(live.generationThroughputStatus).toBe("live");
    expect(finished.promptThroughput).toBe(400);
    expect(finished.generationThroughput).toBe(50);
    expect(finished.completedRequests).toBe(2);
    expect(finished.promptThroughputStatus).toBe("last");
    expect(idle.promptThroughput).toBe(400);
    expect(idle.generationThroughput).toBe(50);
    expect(idle.generationThroughputStatus).toBe("last");
  });

  test("clears retained rates when engine counters reset", () => {
    const tracker = new EnginePerformanceTracker();
    const baseline = metricSample({
      completedRequests: 2,
      decodeSeconds: 10,
      generationTokens: 500,
      prefillSeconds: 1.5,
      promptTokens: 500,
    });
    const reset = metricSample({
      completedRequests: 0,
      decodeSeconds: 0,
      generationTokens: 0,
      prefillSeconds: 0,
      promptTokens: 0,
    });

    tracker.observe({
      key: "qwen:1",
      metrics: baseline,
      names: VLLM_METRIC_NAMES,
      observedAt: 0,
      pendingRequests: 0,
      runningRequests: 0,
    });
    const result = tracker.observe({
      key: "qwen:1",
      metrics: reset,
      names: VLLM_METRIC_NAMES,
      observedAt: 5_000,
      pendingRequests: 0,
      runningRequests: 0,
    });

    expect(result.promptThroughput).toBe(0);
    expect(result.generationThroughput).toBe(0);
    expect(result.promptThroughputStatus).toBe("unavailable");
  });

  test("retains the last measurement through a failed scrape", () => {
    const tracker = new EnginePerformanceTracker();
    const directMetrics = {
      "sglang:generation_throughput": 40,
      "sglang:prompt_throughput": 250,
    };

    tracker.observe({
      key: "qwen:1",
      metrics: directMetrics,
      names: {
        ...VLLM_METRIC_NAMES,
        generationThroughput: ["sglang:generation_throughput"],
        promptThroughput: ["sglang:prompt_throughput"],
      },
      observedAt: 0,
      pendingRequests: 0,
      runningRequests: 1,
    });
    const result = tracker.observe({
      key: "qwen:1",
      metrics: {},
      names: VLLM_METRIC_NAMES,
      observedAt: 5_000,
      pendingRequests: 0,
      runningRequests: 0,
    });

    expect(result.promptThroughput).toBe(250);
    expect(result.generationThroughput).toBe(40);
    expect(result.promptThroughputStatus).toBe("last");
  });
});
