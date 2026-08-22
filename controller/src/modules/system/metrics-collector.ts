import type { AppContext } from "../../app-context";
import { Effect, Schedule } from "effect";
import { getGpuInfo } from "./platform/gpu";
import { getSystemRuntimeInfo } from "../engines/runtimes/runtime-info";
import type { UsageAggregate } from "../../stores/inference-request-store";
import { ENGINE_METRIC_NAMES, scrapeEngineMetrics } from "./engine-metrics-scrape";
import {
  bumpBestLower,
  bumpPeak,
  emptyPeaks,
  firstMetric,
  gpuFields,
  lifetimeFields,
  peakFields,
  positiveOrUndefined,
  rollupGpus,
  round1,
  tokenTotalFields,
  type SessionPeaks,
} from "./metrics-peaks";

const METRICS_HTTP_TIMEOUT_MS = 5_000;
const METRICS_RUNTIME_SUMMARY_INTERVAL_MS = 30_000;
const METRICS_COLLECT_INTERVAL_MS = 5_000;
const METRICS_LIFETIME_UPTIME_INCREMENT_SECONDS = 5;

export const startMetricsCollector = (context: AppContext): Effect.Effect<never> => {
  let lastVllmMetrics: Record<string, number> = {};
  let lastMetricsTime = 0;
  let lastRuntimeSummaryAt = 0;
  let sessionModelId: string | null = null;
  let sessionPeakId: string | null = null;
  let sessionPeaks: SessionPeaks = emptyPeaks();
  let metricsUnavailableUntil = 0;

  const scrapeVllmMetrics = (port: number): Effect.Effect<Record<string, number>> =>
    Effect.gen(function* () {
      if (Date.now() < metricsUnavailableUntil) return {};
      const scrape = yield* scrapeEngineMetrics(port, METRICS_HTTP_TIMEOUT_MS);
      if (scrape.status === 404) metricsUnavailableUntil = Date.now() + 60_000;
      else if (scrape.status === 200) metricsUnavailableUntil = 0;
      return scrape.metrics;
    });

  const collect = Effect.gen(function* () {
    const current = yield* context.bridge.findInferenceProcess();
    const gpuList = yield* getGpuInfo();

    const lifetimeStore = context.stores.lifetimeMetricsStore;
    const gpuTotals = rollupGpus(gpuList);
    const totalPowerWatts = gpuTotals.powerWatts;
    const energyWh = totalPowerWatts * (5 / 3600);
    yield* lifetimeStore.incrementEffect("energy_wh", energyWh);
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

    if (Date.now() - lastRuntimeSummaryAt > METRICS_RUNTIME_SUMMARY_INTERVAL_MS) {
      yield* Effect.gen(function* () {
        const runtime = yield* getSystemRuntimeInfo(context.config);
        const leaseHolder = current
          ? (current.served_model_name ?? current.model_path?.split("/").pop() ?? "inference")
          : null;
        yield* context.eventManager.publishRuntimeSummary({
          platform: runtime.platform,
          gpu_monitoring: runtime.gpu_monitoring,
          backends: runtime.backends,
          lease: { holder: leaseHolder, since: leaseHolder ? new Date().toISOString() : null },
        });
        lastRuntimeSummaryAt = Date.now();
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            context.logger.debug("Runtime summary publish failed", { error: String(error) });
          }),
        ),
      );
    }

    const lifetimeData = yield* lifetimeStore.getAllEffect();
    const kwhPerMillion = (tokenKey: string): number | null => {
      const tokens = lifetimeData[tokenKey];
      return tokens ? (lifetimeData["energy_wh"] ?? 0) / 1000 / (tokens / 1_000_000) : null;
    };
    const baseMetrics = {
      ...lifetimeFields(lifetimeData, totalPowerWatts),
      kwh_per_million_input: kwhPerMillion("prompt_tokens_total"),
      kwh_per_million_output: kwhPerMillion("completion_tokens_total"),
    };

    if (current) {
      const modelId =
        current.served_model_name ?? current.model_path?.split("/").pop() ?? "unknown";

      if (sessionModelId !== modelId) {
        sessionModelId = modelId;
        sessionPeakId = `${modelId}:${Date.now()}`;
        sessionPeaks = emptyPeaks();
        metricsUnavailableUntil = 0;
      }

      let promptThroughput = 0;
      let generationThroughput = 0;
      let runningRequests = 0;
      let pendingRequests = 0;
      let kvCacheUsage = 0;
      let promptTokensTotal = 0;
      let generationTokensTotal = 0;
      let avgTtftMs = 0;

      const names = ENGINE_METRIC_NAMES[current.backend ?? ""];
      if (names) {
        const vllmMetrics = yield* scrapeVllmMetrics(context.config.inference_port);
        const now = Date.now() / 1000;
        const elapsed =
          lastMetricsTime > 0 ? now - lastMetricsTime : METRICS_LIFETIME_UPTIME_INCREMENT_SECONDS;
        /** Rate of a monotonic counter across the gap since the previous scrape. */
        const counterRate = (metricNames: string[]): number => {
          const previous = firstMetric(lastVllmMetrics, metricNames);
          const latest = firstMetric(vllmMetrics, metricNames);
          return latest > previous ? (latest - previous) / elapsed : 0;
        };
        if (
          elapsed > 0 &&
          Object.keys(vllmMetrics).length > 0 &&
          Object.keys(lastVllmMetrics).length > 0
        ) {
          promptThroughput = counterRate(names.promptTokens);
          generationThroughput = counterRate(names.generationTokens);
        }

        promptThroughput = firstMetric(vllmMetrics, names.promptThroughput) || promptThroughput;
        generationThroughput =
          firstMetric(vllmMetrics, names.generationThroughput) || generationThroughput;

        runningRequests = firstMetric(vllmMetrics, names.runningRequests);
        pendingRequests = firstMetric(vllmMetrics, names.pendingRequests);
        kvCacheUsage = firstMetric(vllmMetrics, names.kvCacheUsage);
        promptTokensTotal = firstMetric(vllmMetrics, names.promptTokens);
        generationTokensTotal = firstMetric(vllmMetrics, names.generationTokens);

        const ttftCountDelta =
          (vllmMetrics[names.ttftCount] ?? 0) - (lastVllmMetrics[names.ttftCount] ?? 0);
        if (ttftCountDelta > 0) {
          const ttftSumDelta =
            (vllmMetrics[names.ttftSum] ?? 0) - (lastVllmMetrics[names.ttftSum] ?? 0);
          avgTtftMs = (ttftSumDelta / ttftCountDelta) * 1000;
        }

        lastVllmMetrics = vllmMetrics;
        lastMetricsTime = now;

        if (promptThroughput > 0 || generationThroughput > 0 || avgTtftMs > 0) {
          yield* context.stores.peakMetricsStore.updateIfBetterEffect(
            modelId,
            positiveOrUndefined(promptThroughput),
            positiveOrUndefined(generationThroughput),
            positiveOrUndefined(avgTtftMs),
          );
        }
      } else {
        lastVllmMetrics = {};
        lastMetricsTime = 0;
      }

      bumpPeak(sessionPeaks, "prompt_throughput", promptThroughput);
      bumpPeak(sessionPeaks, "generation_throughput", generationThroughput);
      bumpBestLower(sessionPeaks, "ttft_ms", avgTtftMs);
      bumpPeak(sessionPeaks, "kv_cache_usage", kvCacheUsage);
      bumpPeak(sessionPeaks, "running_requests", runningRequests);
      bumpPeak(sessionPeaks, "power_watts", totalPowerWatts);
      bumpPeak(sessionPeaks, "vram_used_gb", gpuTotals.vramUsedGb);

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
      const usageAggregate: UsageAggregate | null =
        yield* context.stores.inferenceRequestStore.aggregateEffect(new Set([modelId]));
      const usageTotals = usageAggregate?.totals;
      const usageLatencyAvg = positiveOrUndefined(usageAggregate?.latency?.avg_ms);
      const usageTtftAvg = positiveOrUndefined(usageAggregate?.ttft?.avg_ms);
      const avgTtftDisplay = avgTtftMs > 0 ? round1(avgTtftMs) : (usageTtftAvg ?? 0);

      yield* context.eventManager.publishMetrics({
        ...baseMetrics,
        model_id: modelId,
        model_path: current.model_path ?? null,
        served_model_name: current.served_model_name ?? null,
        running_requests: runningRequests,
        pending_requests: pendingRequests,
        kv_cache_usage: kvCacheUsage,
        ...tokenTotalFields(usageTotals, promptTokensTotal, generationTokensTotal),
        prompt_throughput: round1(promptThroughput),
        generation_throughput: round1(generationThroughput),
        avg_ttft_ms: avgTtftDisplay,
        latency_avg: usageLatencyAvg,
        ...gpuFields(gpuTotals),
        session_peak_prompt_throughput: round1(sessionPeaks.prompt_throughput),
        session_peak_generation_throughput: round1(sessionPeaks.generation_throughput),
        session_peak_ttft_ms: round1(sessionPeaks.ttft_ms),
        session_peak_kv_cache_usage: sessionPeaks.kv_cache_usage,
        session_peak_running_requests: sessionPeaks.running_requests,
        session_peak_power_watts: Math.round(sessionPeaks.power_watts),
        session_peak_vram_used_gb: round1(sessionPeaks.vram_used_gb),
        session_peak_id: sessionPeakId,
        session_peak_prefill_tps: sessionPeakData?.["peak_prefill_tps"] ?? null,
        session_peak_generation_tps: sessionPeakData?.["peak_generation_tps"] ?? null,
        session_peak_best_ttft_ms: sessionPeakData?.["best_ttft_ms"] ?? null,
        ...peakFields(peakData, bestSessionPeakData),
      });
    } else {
      sessionModelId = null;
      sessionPeakId = null;
      sessionPeaks = emptyPeaks();
      bumpPeak(sessionPeaks, "power_watts", totalPowerWatts);
      bumpPeak(sessionPeaks, "vram_used_gb", gpuTotals.vramUsedGb);
      yield* context.eventManager.publishMetrics({
        ...baseMetrics,
        model_id: null,
        model_path: null,
        served_model_name: null,
        ...gpuFields(gpuTotals),
        session_peak_power_watts: Math.round(sessionPeaks.power_watts),
        session_peak_vram_used_gb: round1(sessionPeaks.vram_used_gb),
      });
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
