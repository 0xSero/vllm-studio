import type { GPU, Metrics, ProcessInfo, RecipeWithStatus, RuntimePlatformKind } from "@/lib/types";
import { toGB, toGBFromMB } from "@/lib/formatters";

export type MetricSampleInput = {
  key: string;
  generation: number;
  generationPeak: number;
  prefill: number;
  prefillPeak: number;
  ttft: number;
  ttftPeak: number;
  requests: number;
  requestPeak: number;
  active: boolean;
};

export type MetricColumnView = {
  label: string;
  value: string | null;
  unit: string;
  detail?: string;
  detailTitle?: string;
};

export type CompactMetricView = {
  label: string;
  value: string | null;
  detail?: string;
  detailTitle?: string;
};

type PeakKind = "generation" | "prefill" | "ttft";
type PeakTier = "session" | "bestSession" | "all";
type ThroughputSource = "live" | "last" | "peak" | "unavailable";

const PEAK_FIELDS: Record<PeakKind, Record<PeakTier, readonly (keyof Metrics)[]>> = {
  generation: {
    session: [
      "session_peak_generation_tps",
      "session_peak_generation_throughput",
      "session_peak_generation",
    ],
    bestSession: ["best_session_generation_tps", "session_peak_generation_tps"],
    all: ["peak_generation_tps"],
  },
  prefill: {
    session: ["session_peak_prefill_tps", "session_peak_prompt_throughput", "session_peak_prefill"],
    bestSession: ["best_session_prefill_tps", "session_peak_prefill_tps"],
    all: ["peak_prefill_tps"],
  },
  ttft: {
    session: ["session_peak_best_ttft_ms", "session_peak_ttft_ms"],
    bestSession: ["best_session_ttft_ms", "session_peak_best_ttft_ms"],
    all: ["peak_ttft_ms"],
  },
};

const PEAK_DISPLAY: Record<PeakKind, { digits: number; suffix: string; label: string }> = {
  generation: { digits: 1, suffix: "", label: "max" },
  prefill: { digits: 1, suffix: "", label: "max" },
  ttft: { digits: 0, suffix: " ms", label: "best" },
};

type StatusSectionViewInput = {
  currentProcess: ProcessInfo | null;
  currentRecipe: RecipeWithStatus | null;
  gpus: GPU[];
  inferencePort?: number;
  metrics: Metrics | null;
  platformKind?: RuntimePlatformKind | null;
};

export function resolveStatusSectionView({
  currentProcess,
  currentRecipe,
  gpus,
  inferencePort,
  metrics,
  platformKind,
}: StatusSectionViewInput) {
  const isRunning = Boolean(currentProcess);
  const perf = resolvePerformanceMetrics(metrics, gpus);
  return {
    backend: currentProcess?.backend,
    compactMetrics: compactMetricViews(perf),
    displayPlatformKind: platformKind ?? null,
    displayPort: inferencePort || currentProcess?.port || undefined,
    isRunning,
    metricColumns: metricColumnViews(metrics, perf),
    modelName: resolveModelName(currentProcess, currentRecipe),
    sampleInput: {
      key: resolveModelSampleKey(currentProcess, currentRecipe),
      generation: perf.genSample,
      generationPeak: peakFor(metrics, "generation") ?? perf.genTps ?? 0,
      prefill: perf.prefillSample,
      prefillPeak: peakFor(metrics, "prefill") ?? perf.prefillTps ?? 0,
      ttft: perf.ttftMs ?? 0,
      ttftPeak: peakFor(metrics, "ttft") ?? perf.ttftMs ?? 0,
      requests: perf.activeRequests + perf.queuedRequests,
      requestPeak: perf.peakReq || perf.activeRequests + perf.queuedRequests,
      active: isRunning,
    },
  };
}

function resolveModelName(
  currentProcess: ProcessInfo | null,
  currentRecipe: RecipeWithStatus | null,
): string {
  return (
    currentRecipe?.name ||
    currentProcess?.served_model_name ||
    currentProcess?.model_path?.split("/").pop() ||
    "No model loaded"
  );
}

function resolveModelSampleKey(
  currentProcess: ProcessInfo | null,
  currentRecipe: RecipeWithStatus | null,
): string {
  return (
    currentProcess?.served_model_name || currentProcess?.model_path || currentRecipe?.id || "idle"
  );
}

function resolvePerformanceMetrics(metrics: Metrics | null, gpus: GPU[]) {
  const gpuTotals = resolveGpuTotals(gpus);
  const generation = resolveThroughput(metrics, "generation");
  const prefill = resolveThroughput(metrics, "prefill");
  return {
    genTps: generation.value,
    genSample: generation.source === "peak" ? 0 : (generation.value ?? 0),
    genSource: generation.source,
    prefillTps: prefill.value,
    prefillSample: prefill.source === "peak" ? 0 : (prefill.value ?? 0),
    prefillSource: prefill.source,
    ttftMs: firstPositive(metrics?.avg_ttft_ms),
    activeRequests: finiteCount(metrics?.running_requests),
    queuedRequests: finiteCount(metrics?.pending_requests),
    totalRequests: firstFiniteCount(metrics?.total_requests, metrics?.requests_total),
    peakReq: metrics?.session_peak_running_requests ?? 0,
    totalMemUsed: firstPositive(gpuTotals.memUsed, metrics?.vram_used_gb),
    vramCapacity: firstPositive(gpuTotals.memCapacity, metrics?.vram_capacity_gb),
    totalPower: firstPositive(gpuTotals.power, metrics?.current_power_watts),
    powerLimit: firstPositive(gpuTotals.powerLimit, metrics?.power_limit_watts),
  };
}

function resolveThroughput(
  metrics: Metrics | null,
  kind: Exclude<PeakKind, "ttft">,
): { source: ThroughputSource; value: number | null } {
  const current =
    kind === "generation"
      ? firstPositive(metrics?.generation_throughput, metrics?.session_avg_generation)
      : firstPositive(metrics?.prompt_throughput, metrics?.session_avg_prefill);
  const reportedStatus =
    kind === "generation"
      ? metrics?.generation_throughput_status
      : metrics?.prompt_throughput_status;
  if (current) {
    const active =
      finiteCount(metrics?.running_requests) + finiteCount(metrics?.pending_requests) > 0;
    return {
      source: reportedStatus === "live" || (reportedStatus !== "last" && active) ? "live" : "last",
      value: current,
    };
  }
  const peak = peakFor(metrics, kind);
  return peak ? { source: "peak", value: peak } : { source: "unavailable", value: null };
}

function resolveGpuTotals(gpus: GPU[]) {
  return gpus.reduce(
    (totals, gpu) => ({
      memCapacity: totals.memCapacity + gpuMemoryTotal(gpu),
      memUsed: totals.memUsed + gpuMemoryUsed(gpu),
      power: totals.power + (gpu.power_draw || 0),
      powerLimit: totals.powerLimit + (gpu.power_limit || 0),
    }),
    { memCapacity: 0, memUsed: 0, power: 0, powerLimit: 0 },
  );
}

function metricColumnViews(
  metrics: Metrics | null,
  perf: ReturnType<typeof resolvePerformanceMetrics>,
): MetricColumnView[] {
  return [
    {
      label: "Decode",
      value: metricValue(perf.genTps, 1),
      unit: "tok/s",
      ...throughputDetailFor(metrics, "generation", perf.genSource),
    },
    {
      label: "TTFT",
      value: metricValue(perf.ttftMs, 0),
      unit: "ms",
      ...peakDetailFor(metrics, "ttft"),
    },
    {
      label: "Prefill",
      value: metricValue(perf.prefillTps, 1),
      unit: "t/s",
      ...throughputDetailFor(metrics, "prefill", perf.prefillSource),
    },
  ];
}

function compactMetricViews(
  perf: ReturnType<typeof resolvePerformanceMetrics>,
): CompactMetricView[] {
  return [
    {
      label: "Requests",
      value: perf.totalRequests === null ? null : perf.totalRequests.toLocaleString(),
      detail: `${perf.activeRequests} active · ${perf.queuedRequests} queued`,
      detailTitle:
        perf.totalRequests === null
          ? undefined
          : `${perf.totalRequests.toLocaleString()} completed · ${perf.activeRequests} active · ${perf.queuedRequests} queued`,
    },
    { label: "VRAM", value: ratioMetric(perf.totalMemUsed, perf.vramCapacity, "G", 1) },
    { label: "Power", value: ratioMetric(perf.totalPower, perf.powerLimit, "W") },
  ];
}

function throughputDetailFor(
  metrics: Metrics | null,
  kind: Exclude<PeakKind, "ttft">,
  source: ThroughputSource,
): { detail?: string; detailTitle?: string } {
  const peak = peakDetailFor(metrics, kind);
  if (source === "unavailable") return peak;
  const sourceLabel =
    source === "live" ? "live" : source === "last" ? "last measured" : "recorded peak";
  return {
    detail: source === "peak" || !peak.detail ? sourceLabel : `${sourceLabel} · ${peak.detail}`,
    detailTitle: peak.detailTitle,
  };
}

function readField(metrics: Metrics | null, field: keyof Metrics): number | null {
  const value = metrics?.[field];
  return typeof value === "number" ? value : null;
}

function peakAtTier(metrics: Metrics | null, kind: PeakKind, tier: PeakTier): number | null {
  return firstPositive(...PEAK_FIELDS[kind][tier].map((f) => readField(metrics, f)));
}

function peakFor(metrics: Metrics | null, kind: PeakKind): number | null {
  return firstPositive(
    peakAtTier(metrics, kind, "session"),
    peakAtTier(metrics, kind, "bestSession"),
    peakAtTier(metrics, kind, "all"),
  );
}

function peakDetailFor(metrics: Metrics | null, kind: PeakKind) {
  const { digits, suffix, label } = PEAK_DISPLAY[kind];
  return speedMaxDetail({
    session: peakAtTier(metrics, kind, "session"),
    bestSession: peakAtTier(metrics, kind, "bestSession"),
    all: peakAtTier(metrics, kind, "all"),
    digits,
    suffix,
    label,
  });
}

function metricValue(value: number | null, digits: number): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value.toFixed(digits)
    : null;
}

function ratioMetric(
  value: number | null,
  total: number | null,
  unit: string,
  valueDigits = 0,
): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) return null;
  return `${value.toFixed(valueDigits)}/${total.toFixed(0)}${unit}`;
}

function speedMaxDetail({
  session,
  bestSession,
  all,
  digits,
  suffix = "",
  label = "max",
}: {
  session: number | null;
  bestSession: number | null;
  all: number | null;
  digits: number;
  suffix?: string;
  label?: string;
}): { detail?: string; detailTitle?: string } {
  const sessionText = positiveMetricValue(session, digits);
  const bestSessionText = positiveMetricValue(bestSession, digits);
  const allText = positiveMetricValue(all, digits);
  const rows = [
    sessionText ? `current session ${label}: ${sessionText}${suffix}` : null,
    bestSessionText ? `best session ${label}: ${bestSessionText}${suffix}` : null,
    allText ? `all-time ${label}: ${allText}${suffix}` : null,
  ].filter((row): row is string => Boolean(row));
  const fallbackText = sessionText ?? bestSessionText ?? allText;
  return {
    detail: fallbackText ? `${label} ${fallbackText}${suffix}` : undefined,
    detailTitle: rows.length ? rows.join(" | ") : undefined,
  };
}

function positiveMetricValue(value: number | null, digits: number): string | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value.toFixed(digits)
    : null;
}

function gpuMemoryUsed(gpu: GPU): number {
  return toGBFromMB(gpu.memory_used_mb);
}

function gpuMemoryTotal(gpu: GPU): number {
  return toGBFromMB(gpu.memory_total_mb);
}

function firstPositive(...values: Array<number | null | undefined>): number | null {
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

function finiteCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

function firstFiniteCount(...values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.round(value);
    }
  }
  return null;
}
