import assert from "node:assert/strict";
import { test } from "node:test";
import type { Metrics, ProcessInfo } from "@/lib/types";
import { resolveStatusSectionView } from "./status-section-view";

const process: ProcessInfo = {
  backend: "vllm",
  model_path: "/models/qwen",
  pid: 42,
  port: 8000,
  served_model_name: "qwen",
};

function view(metrics: Metrics) {
  return resolveStatusSectionView({
    currentProcess: process,
    currentRecipe: null,
    gpus: [],
    metrics,
  });
}

test("recorded throughput remains visible when the engine is idle", () => {
  const result = view({
    generation_throughput: 0,
    peak_generation_tps: 67.5,
    peak_prefill_tps: 469.5,
    prompt_throughput: 0,
    running_requests: 0,
    pending_requests: 0,
    total_requests: 9,
  });

  assert.deepEqual(
    result.metricColumns.map(({ label, value, detail }) => ({ label, value, detail })),
    [
      { label: "Decode", value: "67.5", detail: "recorded peak" },
      { label: "TTFT", value: null, detail: undefined },
      { label: "Prefill", value: "469.5", detail: "recorded peak" },
    ],
  );
  assert.deepEqual(result.compactMetrics[0], {
    label: "Requests",
    value: "9",
    detail: "0 active · 0 queued",
    detailTitle: "9 completed · 0 active · 0 queued",
  });
});

test("live throughput and request concurrency are labeled explicitly", () => {
  const result = view({
    generation_throughput: 67.4,
    generation_throughput_status: "live",
    peak_generation_tps: 70,
    prompt_throughput: 480.2,
    prompt_throughput_status: "live",
    peak_prefill_tps: 500,
    running_requests: 1,
    pending_requests: 2,
    total_requests: 9,
  });

  assert.equal(result.metricColumns[0]?.value, "67.4");
  assert.equal(result.metricColumns[0]?.detail, "live · max 70.0");
  assert.equal(result.metricColumns[2]?.value, "480.2");
  assert.equal(result.metricColumns[2]?.detail, "live · max 500.0");
  assert.equal(result.compactMetrics[0]?.value, "9");
  assert.equal(result.compactMetrics[0]?.detail, "1 active · 2 queued");
  assert.equal(result.sampleInput.requests, 3);
});

test("unmeasured throughput renders as unavailable instead of zero", () => {
  const result = view({ total_requests: 0 });

  assert.equal(result.metricColumns[0]?.value, null);
  assert.equal(result.metricColumns[2]?.value, null);
  assert.equal(result.compactMetrics[0]?.value, "0");
});
