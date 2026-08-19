import type { GPU, Metrics, ProcessInfo, RecipeWithStatus, RuntimePlatformKind } from "@/lib/types";
import { formatCompactTokens, toGBFromMB } from "@/lib/formatters";

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

/**
 * One cell of the metric strip.
 *
 * Every number on the strip is this shape — there is no second-class cell that
 * shows a bare figure with no unit and no sub-line. A reader scanning down the
 * strip should be able to answer "what is this, in what units, and how does it
 * compare" for all of them, or the cell should not be on the strip at all.
 *
 * `fill` (0–1) opts a cell into the hairline meter: only meaningful for values
 * that are a share of a stated cap, which is why VRAM, power and KV cache carry
 * one and throughput does not.
 */
export type MetricColumnView = {
  label: string;
  value: string | null;
  unit: string;
  detail?: string;
  detailTitle?: string;
  fill?: number;
};

type PeakKind = "generation" | "prefill" | "ttft";
type PeakTier = "session" | "bestSession" | "all";

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
    displayPlatformKind: platformKind ?? null,
    displayPort: inferencePort || currentProcess?.port || undefined,
    isRunning,
    liveMetrics: liveMetricViews(metrics, perf),
    steadyMetrics: steadyMetricViews(metrics, perf),
    modelName: resolveModelName(currentProcess, currentRecipe),
    pid: currentProcess?.pid,
    sampleInput: {
      key: resolveModelSampleKey(currentProcess, currentRecipe),
      generation: perf.genTps ?? 0,
      generationPeak: peakFor(metrics, "generation") ?? perf.genTps ?? 0,
      prefill: perf.prefillTps ?? 0,
      prefillPeak: peakFor(metrics, "prefill") ?? perf.prefillTps ?? 0,
      ttft: perf.ttftMs ?? 0,
      ttftPeak: peakFor(metrics, "ttft") ?? perf.ttftMs ?? 0,
      requests: perf.sessions,
      requestPeak: perf.peakReq || perf.sessions,
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
  return {
    genTps: firstPositive(metrics?.generation_throughput, metrics?.session_avg_generation),
    prefillTps: firstPositive(metrics?.prompt_throughput, metrics?.session_avg_prefill),
    ttftMs: firstPositive(metrics?.avg_ttft_ms),
    sessions: metrics?.running_requests ?? 0,
    peakReq: metrics?.session_peak_running_requests ?? 0,
    pending: metrics?.pending_requests ?? 0,
    kvCache: asPercent(metrics?.kv_cache_usage),
    kvCachePeak: asPercent(metrics?.session_peak_kv_cache_usage),
    totalMemUsed: firstPositive(gpuTotals.memUsed, metrics?.vram_used_gb),
    vramCapacity: firstPositive(gpuTotals.memCapacity, metrics?.vram_capacity_gb),
    totalPower: firstPositive(gpuTotals.power, metrics?.current_power_watts),
    powerLimit: firstPositive(gpuTotals.powerLimit, metrics?.power_limit_watts),
  };
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

type Perf = ReturnType<typeof resolvePerformanceMetrics>;

/**
 * Row one: what the engine is doing right now.
 *
 * The three shares (requests, VRAM, power) used to be rendered as `409/512G`
 * composites. A composite cannot be scanned down a column of big tabular
 * figures — the eye has to parse a separator before it can compare — so the
 * numerator is the value and the ratio moved to the sub-line, where it belongs.
 */
function liveMetricViews(metrics: Metrics | null, perf: Perf): MetricColumnView[] {
  const vramShare = share(perf.totalMemUsed, perf.vramCapacity);
  const powerShare = share(perf.totalPower, perf.powerLimit);
  return [
    {
      label: "Decode",
      value: metricValue(perf.genTps, 1),
      unit: "tok/s",
      ...peakDetailFor(metrics, "generation"),
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
      ...peakDetailFor(metrics, "prefill"),
    },
    {
      label: "Requests",
      value: String(perf.sessions),
      unit: "live",
      detail: perf.peakReq > 0 ? `peak ${perf.peakReq}` : "peak —",
      detailTitle: "Requests the engine is decoding right now, and the peak this session",
    },
    {
      label: "VRAM",
      value: positiveMetricValue(perf.totalMemUsed, 0),
      unit: "GB",
      detail: capDetail(vramShare, perf.vramCapacity, "GB"),
      detailTitle: "GPU memory in use across every visible device",
      fill: vramShare ?? undefined,
    },
    {
      label: "Power",
      value: positiveMetricValue(perf.totalPower, 0),
      unit: "W",
      detail: capDetail(powerShare, perf.powerLimit, "W cap"),
      detailTitle: "Board power draw against the enforced limit",
      fill: powerShare ?? undefined,
    },
  ];
}

/**
 * Row two: the numbers that predict a stall, plus the lifetime counters.
 *
 * KV-cache utilisation and queue depth are the two figures a vLLM operator
 * watches before throughput moves — throughput drops *after* the cache fills
 * and the queue backs up, so a dashboard that only shows tok/s reports the
 * problem one poll late. Both were already on the wire and thrown away.
 */
function steadyMetricViews(metrics: Metrics | null, perf: Perf): MetricColumnView[] {
  return [
    kvCacheView(perf),
    queueView(perf.pending),
    {
      label: "Uptime",
      value: fixed(firstPositive(metrics?.lifetime_uptime_hours), 1),
      unit: "h",
      detail: "lifetime",
      detailTitle: "Hours this controller has had an engine running, across sessions",
    },
    tokensView(metrics),
    {
      label: "Served",
      value: compact(
        firstPositive(metrics?.lifetime_requests, metrics?.total_requests, metrics?.requests_total),
      ),
      unit: "reqs",
      detail: "since first launch",
      detailTitle: "Total requests completed",
    },
    {
      label: "Energy",
      value: fixed(firstPositive(metrics?.kwh_per_million_tokens), 2),
      unit: "kWh/Mtok",
      detail: energyDetail(metrics),
      detailTitle: "Measured board energy per million tokens — the cost-per-token of this rig",
    },
  ];
}

function kvCacheView(perf: Perf): MetricColumnView {
  return {
    label: "KV cache",
    value: fixed(perf.kvCache, 0),
    unit: "%",
    detail: perf.kvCachePeak != null ? `peak ${perf.kvCachePeak.toFixed(0)}%` : "peak —",
    detailTitle: "Share of paged KV blocks allocated; sustained highs precede preemption",
    fill: perf.kvCache != null ? clamp01(perf.kvCache / 100) : undefined,
  };
}

function queueView(pending: number): MetricColumnView {
  return {
    label: "Queue",
    value: String(pending),
    unit: "waiting",
    detail: pending > 0 ? "not yet scheduled" : "nothing waiting",
    detailTitle: "Requests admitted but not yet running",
  };
}

function tokensView(metrics: Metrics | null): MetricColumnView {
  const prompt = metrics?.lifetime_prompt_tokens ?? metrics?.prompt_tokens_total ?? 0;
  const output = metrics?.lifetime_completion_tokens ?? metrics?.generation_tokens_total ?? 0;
  return {
    label: "Tokens",
    value: compact(
      firstPositive(metrics?.lifetime_tokens, metrics?.total_tokens, metrics?.tokens_total),
    ),
    unit: "total",
    detail:
      prompt > 0 || output > 0
        ? `${formatCompactTokens(prompt)} in · ${formatCompactTokens(output)} out`
        : undefined,
    detailTitle: "Prompt and completion tokens counted across every session",
  };
}

function energyDetail(metrics: Metrics | null): string | undefined {
  const kwh = firstPositive(metrics?.lifetime_energy_kwh);
  return kwh != null ? `${kwh.toFixed(1)} kWh used` : undefined;
}

function fixed(value: number | null, digits: number): string | null {
  return value != null ? value.toFixed(digits) : null;
}

function compact(value: number | null): string | null {
  return value != null ? formatCompactTokens(value) : null;
}

function capDetail(shareValue: number | null, cap: number | null, unit: string): string | undefined {
  if (shareValue === null || cap === null) return undefined;
  return `${Math.round(shareValue * 100)}% of ${cap.toFixed(0)} ${unit}`;
}

function share(value: number | null, total: number | null): number | null {
  if (value === null || total === null || total <= 0) return null;
  return clamp01(value / total);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** vLLM reports a 0–1 ratio, llama.cpp a percentage. Normalise to percent. */
function asPercent(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value <= 1 ? value * 100 : Math.min(100, value);
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
    : (0).toFixed(digits);
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
