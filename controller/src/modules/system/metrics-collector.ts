import type { AppContext } from "../../app-context";
import type { ProcessInfo } from "@local-studio/contracts/observability";
import { Effect, Schedule } from "effect";
import { getGpuInfo } from "./platform/gpu";
import { getSystemRuntimeInfo } from "../engines/runtimes/runtime-info";
import type { UsageAggregate } from "../../stores/inference-request-store";
import type { PeakMetric, PeakMetricSession } from "./metrics-store";
import {
  SGLANG_METRIC_NAMES,
  LLAMACPP_METRIC_NAMES,
  VLLM_METRIC_NAMES,
  scrapeEngineMetrics,
  type EngineMetricNames,
} from "./engine-metrics-scrape";
import {
  bumpBestLower,
  bumpPeak,
  emptyPeaks,
  firstMetric,
  positiveOrUndefined,
  type SessionPeaks,
} from "./metrics-peaks";

const METRICS_HTTP_TIMEOUT_MS = 5_000;
const METRICS_RUNTIME_SUMMARY_INTERVAL_MS = 30_000;
const METRICS_COLLECT_INTERVAL_MS = 5_000;
const METRICS_LIFETIME_UPTIME_INCREMENT_SECONDS = 5;

interface EngineSample {
  promptThroughput: number;
  generationThroughput: number;
  runningRequests: number;
  pendingRequests: number;
  kvCacheUsage: number;
  promptTokensTotal: number;
  generationTokensTotal: number;
  avgTtftMs: number;
}

const emptyEngineSample = (): EngineSample => ({
  promptThroughput: 0,
  generationThroughput: 0,
  runningRequests: 0,
  pendingRequests: 0,
  kvCacheUsage: 0,
  promptTokensTotal: 0,
  generationTokensTotal: 0,
  avgTtftMs: 0,
});

const metricNamesForBackend = (backend: ProcessInfo["backend"]): EngineMetricNames => {
  if (backend === "sglang") return SGLANG_METRIC_NAMES;
  if (backend === "llamacpp") return LLAMACPP_METRIC_NAMES;
  return VLLM_METRIC_NAMES;
};

const calculateEngineSample = (
  metrics: Record<string, number>,
  previous: Record<string, number>,
  names: EngineMetricNames,
  elapsed: number,
): EngineSample => {
  const sample = emptyEngineSample();
  if (elapsed > 0 && Object.keys(metrics).length > 0 && Object.keys(previous).length > 0) {
    const promptDelta =
      firstMetric(metrics, names.promptTokens) - firstMetric(previous, names.promptTokens);
    const generationDelta =
      firstMetric(metrics, names.generationTokens) - firstMetric(previous, names.generationTokens);
    if (promptDelta > 0) sample.promptThroughput = promptDelta / elapsed;
    if (generationDelta > 0) sample.generationThroughput = generationDelta / elapsed;
  }

  sample.promptThroughput =
    firstMetric(metrics, names.promptThroughput) || sample.promptThroughput;
  sample.generationThroughput =
    firstMetric(metrics, names.generationThroughput) || sample.generationThroughput;
  sample.runningRequests = firstMetric(metrics, names.runningRequests);
  sample.pendingRequests = firstMetric(metrics, names.pendingRequests);
  sample.kvCacheUsage = firstMetric(metrics, names.kvCacheUsage);
  sample.promptTokensTotal = firstMetric(metrics, names.promptTokens);
  sample.generationTokensTotal = firstMetric(metrics, names.generationTokens);

  const ttftCountDelta = (metrics[names.ttftCount] ?? 0) - (previous[names.ttftCount] ?? 0);
  if (ttftCountDelta > 0) {
    const ttftSumDelta = (metrics[names.ttftSum] ?? 0) - (previous[names.ttftSum] ?? 0);
    sample.avgTtftMs = (ttftSumDelta / ttftCountDelta) * 1000;
  }
  return sample;
};

const lifetimeMetrics = (data: Record<string, number>, currentPowerWatts: number) => ({
  lifetime_prompt_tokens: data["prompt_tokens_total"] ?? 0,
  lifetime_completion_tokens: data["completion_tokens_total"] ?? 0,
  lifetime_requests: data["requests_total"] ?? 0,
  lifetime_energy_kwh: (data["energy_wh"] ?? 0) / 1000,
  lifetime_uptime_hours: (data["uptime_seconds"] ?? 0) / 3600,
  current_power_watts: currentPowerWatts,
  kwh_per_million_input: data["prompt_tokens_total"]
    ? (data["energy_wh"] ?? 0) / 1000 / ((data["prompt_tokens_total"] ?? 1) / 1_000_000)
    : null,
  kwh_per_million_output: data["completion_tokens_total"]
    ? (data["energy_wh"] ?? 0) / 1000 / ((data["completion_tokens_total"] ?? 1) / 1_000_000)
    : null,
});

const usageMetrics = (sample: EngineSample, aggregate: UsageAggregate | null) => {
  const totals = aggregate?.totals;
  const usageTtftAvg = positiveOrUndefined(aggregate?.ttft?.avg_ms);
  return {
    prompt_tokens_total:
      positiveOrUndefined(sample.promptTokensTotal) ?? positiveOrUndefined(totals?.prompt_tokens),
    generation_tokens_total:
      positiveOrUndefined(sample.generationTokensTotal) ??
      positiveOrUndefined(totals?.completion_tokens),
    total_tokens: positiveOrUndefined(totals?.total_tokens),
    total_requests: positiveOrUndefined(totals?.total_requests),
    avg_ttft_ms:
      sample.avgTtftMs > 0 ? Math.round(sample.avgTtftMs * 10) / 10 : (usageTtftAvg ?? 0),
    latency_avg: positiveOrUndefined(aggregate?.latency?.avg_ms),
  };
};

const storedSessionPeakMetrics = (
  sessionPeakData: PeakMetricSession | null,
  bestSessionPeakData: PeakMetricSession | null,
) => ({
  session_peak_prefill_tps: sessionPeakData?.peak_prefill_tps ?? null,
  session_peak_generation_tps: sessionPeakData?.peak_generation_tps ?? null,
  session_peak_best_ttft_ms: sessionPeakData?.best_ttft_ms ?? null,
  best_session_peak_id: bestSessionPeakData?.session_id ?? null,
  best_session_prefill_tps: bestSessionPeakData?.peak_prefill_tps ?? null,
  best_session_generation_tps: bestSessionPeakData?.peak_generation_tps ?? null,
  best_session_ttft_ms: bestSessionPeakData?.best_ttft_ms ?? null,
});

const storedModelPeakMetrics = (peakData: PeakMetric | null) => ({
  peak_prefill_tps: peakData?.prefill_tps ?? null,
  peak_generation_tps: peakData?.generation_tps ?? null,
  peak_ttft_ms: peakData?.ttft_ms ?? null,
});

export const startMetricsCollector = (context: AppContext): Effect.Effect<never> => {
  let lastEngineMetrics: Record<string, number> = {};
  let lastMetricsTime = 0;
  let lastRuntimeSummaryAt = 0;
  let sessionModelId: string | null = null;
  let sessionPeakId: string | null = null;
  let sessionPeaks: SessionPeaks = emptyPeaks();
  let metricsUnavailableUntil = 0;

  const scrapeMetrics = (port: number): Effect.Effect<Record<string, number>> =>
    Effect.gen(function* () {
      if (Date.now() < metricsUnavailableUntil) return {};
      const scrape = yield* scrapeEngineMetrics(port, METRICS_HTTP_TIMEOUT_MS);
      if (scrape.status === 404) metricsUnavailableUntil = Date.now() + 60_000;
      else if (scrape.status === 200) metricsUnavailableUntil = 0;
      return scrape.metrics;
    });

  const publishRuntimeSummary = (current: ProcessInfo | null) => {
    if (Date.now() - lastRuntimeSummaryAt <= METRICS_RUNTIME_SUMMARY_INTERVAL_MS) {
      return Effect.void;
    }
    return getSystemRuntimeInfo(context.config).pipe(
      Effect.flatMap((runtime) => {
        const leaseHolder = current
          ? (current.served_model_name ?? current.model_path?.split("/").pop() ?? "inference")
          : null;
        return context.eventManager.publishRuntimeSummary({
          platform: runtime.platform,
          gpu_monitoring: runtime.gpu_monitoring,
          backends: runtime.backends,
          lease: { holder: leaseHolder, since: leaseHolder ? new Date().toISOString() : null },
        });
      }),
      Effect.tap(() =>
        Effect.sync(() => {
          lastRuntimeSummaryAt = Date.now();
        }),
      ),
      Effect.catch((error) =>
        Effect.sync(() => {
          context.logger.debug("Runtime summary publish failed", { error: String(error) });
        }),
      ),
    );
  };

  const collectEngineSample = (current: ProcessInfo, modelId: string) =>
    Effect.gen(function* () {
      if (
        current.backend !== "vllm" &&
        current.backend !== "sglang" &&
        current.backend !== "llamacpp"
      ) {
        lastEngineMetrics = {};
        lastMetricsTime = 0;
        return emptyEngineSample();
      }
      const metrics = yield* scrapeMetrics(context.config.inference_port);
      const now = Date.now() / 1000;
      const elapsed =
        lastMetricsTime > 0 ? now - lastMetricsTime : METRICS_LIFETIME_UPTIME_INCREMENT_SECONDS;
      const sample = calculateEngineSample(
        metrics,
        lastEngineMetrics,
        metricNamesForBackend(current.backend),
        elapsed,
      );
      lastEngineMetrics = metrics;
      lastMetricsTime = now;
      if (sample.promptThroughput > 0 || sample.generationThroughput > 0 || sample.avgTtftMs > 0) {
        yield* context.stores.peakMetricsStore.updateIfBetterEffect(
          modelId,
          positiveOrUndefined(sample.promptThroughput),
          positiveOrUndefined(sample.generationThroughput),
          positiveOrUndefined(sample.avgTtftMs),
        );
      }
      return sample;
    });

  const publishActiveMetrics = (
    current: ProcessInfo,
    baseMetrics: ReturnType<typeof lifetimeMetrics>,
    totalVramUsedGb: number,
    totalVramCapacityGb: number,
    totalPowerWatts: number,
    totalPowerLimitWatts: number,
  ) =>
    Effect.gen(function* () {
      const modelId =
        current.served_model_name ?? current.model_path?.split("/").pop() ?? "unknown";
      if (sessionModelId !== modelId) {
        sessionModelId = modelId;
        sessionPeakId = `${modelId}:${Date.now()}`;
        sessionPeaks = emptyPeaks();
        metricsUnavailableUntil = 0;
      }
      const sample = yield* collectEngineSample(current, modelId);
      bumpPeak(sessionPeaks, "prompt_throughput", sample.promptThroughput);
      bumpPeak(sessionPeaks, "generation_throughput", sample.generationThroughput);
      bumpBestLower(sessionPeaks, "ttft_ms", sample.avgTtftMs);
      bumpPeak(sessionPeaks, "kv_cache_usage", sample.kvCacheUsage);
      bumpPeak(sessionPeaks, "running_requests", sample.runningRequests);
      bumpPeak(sessionPeaks, "power_watts", totalPowerWatts);
      bumpPeak(sessionPeaks, "vram_used_gb", totalVramUsedGb);

      if (sessionPeakId) {
        yield* context.stores.peakMetricsStore.updateSessionPeakEffect(
          sessionPeakId,
          modelId,
          positiveOrUndefined(sessionPeaks.prompt_throughput),
          positiveOrUndefined(sessionPeaks.generation_throughput),
          positiveOrUndefined(sessionPeaks.ttft_ms),
        );
      }
      const peakData = yield* context.stores.peakMetricsStore.getEffect(modelId);
      const sessionPeakData = sessionPeakId
        ? yield* context.stores.peakMetricsStore.getSessionEffect(sessionPeakId)
        : null;
      const bestSessionPeakData =
        yield* context.stores.peakMetricsStore.getBestSessionEffect(modelId);
      const aggregate =
        yield* context.stores.inferenceRequestStore.aggregateEffect(new Set([modelId]));

      yield* context.eventManager.publishMetrics({
        ...baseMetrics,
        ...usageMetrics(sample, aggregate),
        ...storedModelPeakMetrics(peakData),
        ...storedSessionPeakMetrics(sessionPeakData, bestSessionPeakData),
        model_id: modelId,
        model_path: current.model_path ?? null,
        served_model_name: current.served_model_name ?? null,
        running_requests: sample.runningRequests,
        pending_requests: sample.pendingRequests,
        kv_cache_usage: sample.kvCacheUsage,
        prompt_throughput: Math.round(sample.promptThroughput * 10) / 10,
        generation_throughput: Math.round(sample.generationThroughput * 10) / 10,
        vram_used_gb: Math.round(totalVramUsedGb * 10) / 10,
        vram_capacity_gb: Math.round(totalVramCapacityGb * 10) / 10,
        power_limit_watts: Math.round(totalPowerLimitWatts),
        session_peak_prompt_throughput: Math.round(sessionPeaks.prompt_throughput * 10) / 10,
        session_peak_generation_throughput:
          Math.round(sessionPeaks.generation_throughput * 10) / 10,
        session_peak_ttft_ms: Math.round(sessionPeaks.ttft_ms * 10) / 10,
        session_peak_kv_cache_usage: sessionPeaks.kv_cache_usage,
        session_peak_running_requests: sessionPeaks.running_requests,
        session_peak_power_watts: Math.round(sessionPeaks.power_watts),
        session_peak_vram_used_gb: Math.round(sessionPeaks.vram_used_gb * 10) / 10,
        session_peak_id: sessionPeakId,
      });
    });

  const publishIdleMetrics = (
    baseMetrics: ReturnType<typeof lifetimeMetrics>,
    totalVramUsedGb: number,
    totalVramCapacityGb: number,
    totalPowerWatts: number,
    totalPowerLimitWatts: number,
  ) => {
    sessionModelId = null;
    sessionPeakId = null;
    sessionPeaks = emptyPeaks();
    bumpPeak(sessionPeaks, "power_watts", totalPowerWatts);
    bumpPeak(sessionPeaks, "vram_used_gb", totalVramUsedGb);
    return context.eventManager.publishMetrics({
      ...baseMetrics,
      model_id: null,
      model_path: null,
      served_model_name: null,
      vram_used_gb: Math.round(totalVramUsedGb * 10) / 10,
      vram_capacity_gb: Math.round(totalVramCapacityGb * 10) / 10,
      power_limit_watts: Math.round(totalPowerLimitWatts),
      session_peak_power_watts: Math.round(sessionPeaks.power_watts),
      session_peak_vram_used_gb: Math.round(sessionPeaks.vram_used_gb * 10) / 10,
    });
  };

  const collect = Effect.gen(function* () {
    const current = yield* context.bridge.findInferenceProcess();
    const gpuList = yield* getGpuInfo();
    const lifetimeStore = context.stores.lifetimeMetricsStore;
    const totalPowerWatts = gpuList.reduce((sum, gpu) => sum + gpu.power_draw, 0);
    yield* lifetimeStore.incrementEffect("energy_wh", totalPowerWatts * (5 / 3600));
    yield* lifetimeStore.incrementEffect(
      "uptime_seconds",
      METRICS_LIFETIME_UPTIME_INCREMENT_SECONDS,
    );
    yield* context.eventManager.publishStatus({
      running: Boolean(current),
      process: current,
      inference_port: context.config.inference_port,
      launching: context.bridge.launchingRecipeId(),
    });
    yield* context.eventManager.publishGpu(gpuList.map((gpu) => ({ ...gpu })));
    yield* publishRuntimeSummary(current);

    const baseMetrics = lifetimeMetrics(yield* lifetimeStore.getAllEffect(), totalPowerWatts);
    const totalVramUsedGb = gpuList.reduce((sum, gpu) => sum + gpu.memory_used_mb / 1024, 0);
    const totalVramCapacityGb = gpuList.reduce((sum, gpu) => sum + gpu.memory_total_mb / 1024, 0);
    const totalPowerLimitWatts = gpuList.reduce((sum, gpu) => sum + gpu.power_limit, 0);
    if (current) {
      yield* publishActiveMetrics(
        current,
        baseMetrics,
        totalVramUsedGb,
        totalVramCapacityGb,
        totalPowerWatts,
        totalPowerLimitWatts,
      );
    } else {
      yield* publishIdleMetrics(
        baseMetrics,
        totalVramUsedGb,
        totalVramCapacityGb,
        totalPowerWatts,
        totalPowerLimitWatts,
      );
    }
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        context.logger.error("Metrics collection error", { error: String(error) });
      }),
    ),
  );

  return collect.pipe(
    Effect.repeat(Schedule.spaced(METRICS_COLLECT_INTERVAL_MS)),
    Effect.andThen(Effect.never),
  );
};
