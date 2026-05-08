import { describe, expect, it } from "vitest";
import type { Metrics, ProcessInfo } from "@/lib/types";
import { metricsBelongToProcess, scopedMetrics } from "./dashboard-metrics";

const activeProcess = (overrides: Partial<ProcessInfo> = {}): ProcessInfo => ({
  pid: 123,
  backend: "sglang",
  model_path: "/models/Step-3.5-Flash",
  port: 8000,
  served_model_name: "Step-3.5-Flash",
  ...overrides,
});

describe("dashboard metric scoping", () => {
  it("rejects metrics from the previously running model", () => {
    const metrics: Metrics = {
      model_id: "deepseek-v4-flash",
      generation_throughput: 184.6,
      avg_ttft_ms: 412,
    };

    expect(metricsBelongToProcess(metrics, activeProcess())).toBe(false);
    expect(scopedMetrics(metrics, activeProcess())).toBeNull();
  });

  it("rejects identity-less metrics while a model is active", () => {
    const metrics: Metrics = {
      generation_throughput: 184.6,
      avg_ttft_ms: 412,
    };

    expect(scopedMetrics(metrics, activeProcess())).toBeNull();
  });

  it("accepts metrics with a matching served model name", () => {
    const metrics: Metrics = {
      served_model_name: "step-3.5-flash",
      generation_throughput: 12,
    };

    expect(scopedMetrics(metrics, activeProcess())).toBe(metrics);
  });

  it("accepts metrics whose path basename matches the active process", () => {
    const metrics: Metrics = {
      model_path: "/mnt/models/step-3.5-flash/",
      prompt_throughput: 55,
    };

    expect(scopedMetrics(metrics, activeProcess())).toBe(metrics);
  });

  it("rejects metrics when there is no active process", () => {
    expect(scopedMetrics({ model_id: "Step-3.5-Flash" }, null)).toBeNull();
  });
});
