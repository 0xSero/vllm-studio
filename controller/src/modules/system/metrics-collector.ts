import type { AppContext } from "../../app-context";
import { Effect, Schedule } from "effect";
import { getGpuInfo } from "./platform/gpu";
import { getSystemRuntimeInfo } from "../engines/runtimes/runtime-info";
import type { UsageAggregate } from "../../stores/inference-request-store";
import {
  SGLANG_METRIC_NAMES,
  VLLM_METRIC_NAMES,
  scrapeEngineMetrics,
} from "./engine-metrics-scrape";
import {
  bumpBestLower,
  bumpPeak,
  emptyPeaks,
  firstMetric,
  positiveOrUndefined,
  type SessionPeaks,
} from "./metrics-peaks";
import type { EventData } from "./event-manager";
import type { PeakMetric, PeakMetricSession } from "./metrics-store";

const METRICS_HTTP_TIMEOUT_MS = 5_000;
const METRICS_RUNTIME_SUMMARY_INTERVAL_MS = 30_000;
const METRICS_COLLECT_INTERVAL_MS = 5_000;
const METRICS_LIFETIME_UPTIME_INCREMENT_SECONDS = 5;

type MetricNames = typeof VLLM_METRIC_NAMES;

type EngineValues = {
  promptThroughput: number;
  generationThroughput: number;
  runningRequests: number;
  pendingRequests: number;
  kvCacheUsage: number;
  promptTokensTotal: number;
  generationTokensTotal: number;
  avgTtftMs: number;
};

const emptyEngineValues = (): EngineValues => ({
  promptThroughput: 0,
  generationThroughput: 0,
  runningRequests: 0,
  pendingRequests: 0,
  kvCacheUsage: 0,
  promptTokensTotal: 0,
  generationTokensTotal: 0,
  avgTtftMs: 0,
});

const calculateThroughput = (
  metrics: Record<string, number>,
  previousMetrics: Record<string, number>,
  names: MetricNames,
  elapsed: number,
): Pick<EngineValues, "promptThroughput" | "generationThroughput"> => {
  let promptThroughput = 0;
  let generationThroughput = 0;
  if (elapsed > 0 && Object.keys(metrics).length > 0 && Object.keys(previousMetrics).length > 0) {
    const previousPromptTokens = firstMetric(previousMetrics, names.promptTokens);
    const currentPromptTokens = firstMetric(metrics, names.promptTokens);
    const previousGenerationTokens = firstMetric(previousMetrics, names.generationTokens);
    const currentGenerationTokens = firstMetric(metrics, names.generationTokens);
    if (currentPromptTokens > previousPromptTokens) {
      promptThroughput = (currentPromptTokens - previousPromptTokens) / elapsed;
    }
    if (currentGenerationTokens > previousGenerationTokens) {
      generationThroughput = (currentGenerationTokens - previousGenerationTokens) / elapsed;
    }
  }
  return { promptThroughput, generationThroughput };
};

const calculateAverageTtft = (
  metrics: Record<string, number>,
  previousMetrics: Record<string, number>,
  names: MetricNames,
): number => {
  const previousSum = previousMetrics[names.ttftSum] ?? 0;
  const previousCount = previousMetrics[names.ttftCount] ?? 0;
  const currentSum = metrics[names.ttftSum] ?? 0;
  const currentCount = metrics[names.ttftCount] ?? 0;
  const count = currentCount - previousCount;
  return count > 0 ? ((currentSum - previousSum) / count) * 1000 : 0;
};

const createBaseMetrics = (
  lifetimeData: Record<string, number>,
  totalPowerWatts: number,
): EventData => ({
  lifetime_prompt_tokens: lifetimeData["prompt_tokens_total"] ?? 0,
  lifetime_completion_tokens: lifetimeData["completion_tokens_total"] ?? 0,
  lifetime_requests: lifetimeData["requests_total"] ?? 0,
  lifetime_energy_kwh: (lifetimeData["energy_wh"] ?? 0) / 1000,
  lifetime_uptime_hours: (lifetimeData["uptime_seconds"] ?? 0) / 3600,
  current_power_watts: totalPowerWatts,
  kwh_per_million_input: lifetimeData["prompt_tokens_total"]
    ? (lifetimeData["energy_wh"] ?? 0) / 1000 / (lifetimeData["prompt_tokens_total"] / 1_000_000)
    : null,
  kwh_per_million_output: lifetimeData["completion_tokens_total"]
    ? (lifetimeData["energy_wh"] ?? 0) /
      1000 /
      (lifetimeData["completion_tokens_total"] / 1_000_000)
    : null,
});

const createUsageMetrics = (
  usageAggregate: UsageAggregate | null,
  values: EngineValues,
): EventData => {
  const totals = usageAggregate?.totals;
  const usageTtft = positiveOrUndefined(usageAggregate?.ttft?.avg_ms);
  return {
    prompt_tokens_total:
      positiveOrUndefined(values.promptTokensTotal) ?? positiveOrUndefined(totals?.prompt_tokens),
    generation_tokens_total:
      positiveOrUndefined(values.generationTokensTotal) ??
      positiveOrUndefined(totals?.completion_tokens),
    total_tokens: positiveOrUndefined(totals?.total_tokens),
    total_requests: positiveOrUndefined(totals?.total_requests),
    latency_avg: positiveOrUndefined(usageAggregate?.latency?.avg_ms),
    avg_ttft_ms: values.avgTtftMs > 0 ? Math.round(values.avgTtftMs * 10) / 10 : (usageTtft ?? 0),
  };
};

const createSessionMetrics = (sessionPeaks: SessionPeaks): EventData => ({
  session_peak_prompt_throughput: Math.round(sessionPeaks.prompt_throughput * 10) / 10,
  session_peak_generation_throughput: Math.round(sessionPeaks.generation_throughput * 10) / 10,
  session_peak_ttft_ms: Math.round(sessionPeaks.ttft_ms * 10) / 10,
  session_peak_kv_cache_usage: sessionPeaks.kv_cache_usage,
  session_peak_running_requests: sessionPeaks.running_requests,
  session_peak_power_watts: Math.round(sessionPeaks.power_watts),
  session_peak_vram_used_gb: Math.round(sessionPeaks.vram_used_gb * 10) / 10,
});

export const startMetricsCollector = (context: AppContext): Effect.Effect<never> => {
  let lastVllmMetrics: Record<string, number> = {};
  let lastMetricsTime = 0;
  let lastRuntimeSummaryAt = 0;
  type MetricsSession = { modelId: string; peakId: string };
  let metricsSession: MetricsSession | null = null;
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

  const collectSystem = Effect.gen(function* () {
    const current = yield* context.compute.model.findInferenceProcess();
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
      launching: context.compute.model.launchingRecipeId(),
    });
    yield* context.eventManager.publishGpu(gpuList.map((gpu) => ({ ...gpu })));
    return {
      current,
      lifetimeStore,
      totalPowerWatts,
      totalVramUsedGb: gpuList.reduce((sum, gpu) => sum + gpu.memory_used_mb / 1024, 0),
      totalVramCapacityGb: gpuList.reduce((sum, gpu) => sum + gpu.memory_total_mb / 1024, 0),
      totalPowerLimitWatts: gpuList.reduce((sum, gpu) => sum + gpu.power_limit, 0),
    };
  });

  type InitialSnapshot = Effect.Success<typeof collectSystem>;
  type SystemSnapshot = InitialSnapshot & { baseMetrics: ReturnType<typeof createBaseMetrics> };

  const completeSystemSnapshot = (
    snapshot: InitialSnapshot,
  ): Effect.Effect<SystemSnapshot, unknown> =>
    Effect.gen(function* () {
      const lifetimeData = yield* snapshot.lifetimeStore.getAllEffect();
      return {
        ...snapshot,
        baseMetrics: createBaseMetrics(lifetimeData, snapshot.totalPowerWatts),
      };
    });

  const publishRuntimeSummary = (current: InitialSnapshot["current"]): Effect.Effect<void> => {
    if (Date.now() - lastRuntimeSummaryAt <= METRICS_RUNTIME_SUMMARY_INTERVAL_MS) {
      return Effect.void;
    }
    return context.compute.host().pipe(
      Effect.flatMap(getSystemRuntimeInfo),
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

  const collectEngineValues = (
    current: NonNullable<SystemSnapshot["current"]>,
    modelId: string,
  ): Effect.Effect<EngineValues, unknown> =>
    Effect.gen(function* () {
      if (current.backend !== "vllm" && current.backend !== "sglang") {
        lastVllmMetrics = {};
        lastMetricsTime = 0;
        return emptyEngineValues();
      }
      const metrics = yield* scrapeVllmMetrics(context.config.inference_port);
      const now = Date.now() / 1000;
      const elapsed =
        lastMetricsTime > 0 ? now - lastMetricsTime : METRICS_LIFETIME_UPTIME_INCREMENT_SECONDS;
      const names = current.backend === "sglang" ? SGLANG_METRIC_NAMES : VLLM_METRIC_NAMES;
      const calculated = calculateThroughput(metrics, lastVllmMetrics, names, elapsed);
      const values = {
        promptThroughput:
          firstMetric(metrics, names.promptThroughput) || calculated.promptThroughput,
        generationThroughput:
          firstMetric(metrics, names.generationThroughput) || calculated.generationThroughput,
        runningRequests: firstMetric(metrics, names.runningRequests),
        pendingRequests: firstMetric(metrics, names.pendingRequests),
        kvCacheUsage: firstMetric(metrics, names.kvCacheUsage),
        promptTokensTotal: firstMetric(metrics, names.promptTokens),
        generationTokensTotal: firstMetric(metrics, names.generationTokens),
        avgTtftMs: calculateAverageTtft(metrics, lastVllmMetrics, names),
      };
      lastVllmMetrics = metrics;
      lastMetricsTime = now;
      if (values.promptThroughput > 0 || values.generationThroughput > 0 || values.avgTtftMs > 0) {
        yield* context.stores.peakMetricsStore.updateIfBetterEffect(
          modelId,
          values.promptThroughput > 0 ? values.promptThroughput : undefined,
          values.generationThroughput > 0 ? values.generationThroughput : undefined,
          values.avgTtftMs > 0 ? values.avgTtftMs : undefined,
        );
      }
      return values;
    });

  const updateSessionPeaks = (
    values: EngineValues,
    totalPowerWatts: number,
    totalVramUsedGb: number,
  ): void => {
    bumpPeak(sessionPeaks, "prompt_throughput", values.promptThroughput);
    bumpPeak(sessionPeaks, "generation_throughput", values.generationThroughput);
    bumpBestLower(sessionPeaks, "ttft_ms", values.avgTtftMs);
    bumpPeak(sessionPeaks, "kv_cache_usage", values.kvCacheUsage);
    bumpPeak(sessionPeaks, "running_requests", values.runningRequests);
    bumpPeak(sessionPeaks, "power_watts", totalPowerWatts);
    bumpPeak(sessionPeaks, "vram_used_gb", totalVramUsedGb);
  };

  type RunningMetricData = {
    peak: PeakMetric | null;
    sessionPeak: PeakMetricSession | null;
    bestSessionPeak: PeakMetricSession | null;
    usage: UsageAggregate | null;
  };

  const ensureSession = (modelId: string): MetricsSession => {
    if (metricsSession?.modelId === modelId) return metricsSession;
    const session = { modelId, peakId: `${modelId}:${Date.now()}` };
    metricsSession = session;
    sessionPeaks = emptyPeaks();
    metricsUnavailableUntil = 0;
    return session;
  };

  const collectRunningMetricData = (
    sessionId: string,
    modelId: string,
  ): Effect.Effect<RunningMetricData, unknown> =>
    Effect.gen(function* () {
      yield* context.stores.peakMetricsStore.updateSessionPeakEffect(
        sessionId,
        modelId,
        sessionPeaks.prompt_throughput > 0 ? sessionPeaks.prompt_throughput : undefined,
        sessionPeaks.generation_throughput > 0 ? sessionPeaks.generation_throughput : undefined,
        sessionPeaks.ttft_ms > 0 ? sessionPeaks.ttft_ms : undefined,
      );
      const peak = yield* context.stores.peakMetricsStore.getEffect(modelId);
      const sessionPeak = yield* context.stores.peakMetricsStore.getSessionEffect(sessionId);
      const bestSessionPeak = yield* context.stores.peakMetricsStore.getBestSessionEffect(modelId);
      const usage: UsageAggregate | null =
        yield* context.stores.inferenceRequestStore.aggregateEffect(new Set([modelId]));
      return { peak, sessionPeak, bestSessionPeak, usage };
    });

  const createStoredPeakMetrics = (data: RunningMetricData): EventData => {
    const sessionPeak = data.sessionPeak
      ? {
          session_peak_prefill_tps: data.sessionPeak.peak_prefill_tps,
          session_peak_generation_tps: data.sessionPeak.peak_generation_tps,
          session_peak_best_ttft_ms: data.sessionPeak.best_ttft_ms,
        }
      : {
          session_peak_prefill_tps: null,
          session_peak_generation_tps: null,
          session_peak_best_ttft_ms: null,
        };
    const bestSessionPeak = data.bestSessionPeak
      ? {
          best_session_peak_id: data.bestSessionPeak.session_id,
          best_session_prefill_tps: data.bestSessionPeak.peak_prefill_tps,
          best_session_generation_tps: data.bestSessionPeak.peak_generation_tps,
          best_session_ttft_ms: data.bestSessionPeak.best_ttft_ms,
        }
      : {
          best_session_peak_id: null,
          best_session_prefill_tps: null,
          best_session_generation_tps: null,
          best_session_ttft_ms: null,
        };
    const lifetimePeak = data.peak
      ? {
          peak_prefill_tps: data.peak.prefill_tps,
          peak_generation_tps: data.peak.generation_tps,
          peak_ttft_ms: data.peak.ttft_ms,
        }
      : { peak_prefill_tps: null, peak_generation_tps: null, peak_ttft_ms: null };
    return { ...sessionPeak, ...bestSessionPeak, ...lifetimePeak };
  };

  const createRunningMetrics = (
    snapshot: SystemSnapshot,
    current: NonNullable<SystemSnapshot["current"]>,
    modelId: string,
    sessionId: string,
    values: EngineValues,
    data: RunningMetricData,
  ): EventData => ({
    ...snapshot.baseMetrics,
    ...createUsageMetrics(data.usage, values),
    ...createSessionMetrics(sessionPeaks),
    ...createStoredPeakMetrics(data),
    model_id: modelId,
    model_path: current.model_path ?? null,
    served_model_name: current.served_model_name ?? null,
    running_requests: values.runningRequests,
    pending_requests: values.pendingRequests,
    kv_cache_usage: values.kvCacheUsage,
    prompt_throughput: Math.round(values.promptThroughput * 10) / 10,
    generation_throughput: Math.round(values.generationThroughput * 10) / 10,
    vram_used_gb: Math.round(snapshot.totalVramUsedGb * 10) / 10,
    vram_capacity_gb: Math.round(snapshot.totalVramCapacityGb * 10) / 10,
    power_limit_watts: Math.round(snapshot.totalPowerLimitWatts),
    session_peak_id: sessionId,
  });

  const collectRunning = (
    snapshot: SystemSnapshot,
    current: NonNullable<SystemSnapshot["current"]>,
  ): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      const modelId =
        current.served_model_name ?? current.model_path?.split("/").pop() ?? "unknown";
      const session = ensureSession(modelId);
      const values = yield* collectEngineValues(current, modelId);
      updateSessionPeaks(values, snapshot.totalPowerWatts, snapshot.totalVramUsedGb);
      const data = yield* collectRunningMetricData(session.peakId, modelId);
      yield* context.eventManager.publishMetrics(
        createRunningMetrics(snapshot, current, modelId, session.peakId, values, data),
      );
    });

  const collectIdle = (snapshot: SystemSnapshot): Effect.Effect<void, unknown> => {
    metricsSession = null;
    sessionPeaks = emptyPeaks();
    bumpPeak(sessionPeaks, "power_watts", snapshot.totalPowerWatts);
    bumpPeak(sessionPeaks, "vram_used_gb", snapshot.totalVramUsedGb);
    return context.eventManager.publishMetrics({
      ...snapshot.baseMetrics,
      model_id: null,
      model_path: null,
      served_model_name: null,
      vram_used_gb: Math.round(snapshot.totalVramUsedGb * 10) / 10,
      vram_capacity_gb: Math.round(snapshot.totalVramCapacityGb * 10) / 10,
      power_limit_watts: Math.round(snapshot.totalPowerLimitWatts),
      session_peak_power_watts: Math.round(sessionPeaks.power_watts),
      session_peak_vram_used_gb: Math.round(sessionPeaks.vram_used_gb * 10) / 10,
    });
  };

  const collect = Effect.gen(function* () {
    const initialSnapshot = yield* collectSystem;
    yield* publishRuntimeSummary(initialSnapshot.current);
    const snapshot = yield* completeSystemSnapshot(initialSnapshot);
    if (snapshot.current) {
      yield* collectRunning(snapshot, snapshot.current);
    } else {
      yield* collectIdle(snapshot);
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
