import { performance } from "node:perf_hooks";
import { Effect, Schema } from "effect";
import { findObservedInferenceProcess } from "../../core/function-observability";
import { effectRoute, defineRoutes, mergeRoutes } from "../../http/route-registrar";
import { badRequest, serviceUnavailable } from "../../core/errors";
import type { AppContext } from "../../app-context";
import { getGpuInfo } from "./platform/gpu";
import { fetchInference } from "../../http/local-fetch";
import type { UsageAggregate } from "../../stores/inference-request-store";
import type { PeakMetric, PeakMetricWithBestSession } from "./metrics-store";
import {
  SGLANG_METRIC_NAMES,
  VLLM_METRIC_NAMES,
  scrapeEngineMetrics,
} from "./engine-metrics-scrape";
import { firstMetric, positiveOrUndefined } from "./metrics-peaks";
import type { EventData } from "./event-manager";

const throughputSamples = new Map<
  string,
  { promptTokens: number; genTokens: number; ts: number; promptTps: number; genTps: number }
>();
const MIN_RATE_INTERVAL_MS = 1500;
const BenchmarkQuerySchema = Schema.Struct({
  prompt_tokens: Schema.optionalKey(
    Schema.FiniteFromString.pipe(
      Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100_000 })),
    ),
  ),
});
const BenchmarkResponseSchema = Schema.Struct({
  usage: Schema.optionalKey(
    Schema.Struct({
      prompt_tokens: Schema.optionalKey(Schema.Number),
      completion_tokens: Schema.optionalKey(Schema.Number),
    }),
  ),
});

const buildModelKeys = (modelId: string, modelPath: string | null | undefined): Set<string> => {
  const keys = new Set<string>([modelId]);
  if (modelPath) {
    keys.add(modelPath);
    keys.add(modelPath.split("/").pop() ?? modelPath);
  }
  return keys;
};

const buildBaseMetrics = (
  lifetimeData: Record<string, number>,
  gpus: Effect.Success<ReturnType<typeof getGpuInfo>>,
): EventData => {
  const currentPowerWatts = gpus.reduce((sum, gpu) => sum + gpu.power_draw, 0);
  const vramUsedGb = gpus.reduce((sum, gpu) => sum + gpu.memory_used_mb / 1024, 0);
  const vramCapacityGb = gpus.reduce((sum, gpu) => sum + gpu.memory_total_mb / 1024, 0);
  const powerLimitWatts = gpus.reduce((sum, gpu) => sum + gpu.power_limit, 0);
  return {
    lifetime_prompt_tokens: lifetimeData["prompt_tokens_total"] ?? 0,
    lifetime_completion_tokens: lifetimeData["completion_tokens_total"] ?? 0,
    lifetime_requests: lifetimeData["requests_total"] ?? 0,
    lifetime_energy_kwh: (lifetimeData["energy_wh"] ?? 0) / 1000,
    lifetime_uptime_hours: (lifetimeData["uptime_seconds"] ?? 0) / 3600,
    current_power_watts: currentPowerWatts,
    vram_used_gb: Math.round(vramUsedGb * 10) / 10,
    vram_capacity_gb: Math.round(vramCapacityGb * 10) / 10,
    power_limit_watts: Math.round(powerLimitWatts),
  };
};

type MetricNames = typeof VLLM_METRIC_NAMES;
type Throughput = { prompt: number; generation: number };
type ActiveEngine = {
  isSglang: boolean;
  modelId: string;
  modelPath: string | null;
  servedModelName: string | null;
};
const calculateThroughput = (
  modelId: string,
  isSglang: boolean,
  prometheus: Record<string, number>,
  names: MetricNames,
): Throughput => {
  if (isSglang) {
    return {
      prompt: firstMetric(prometheus, names.promptThroughput),
      generation: firstMetric(prometheus, names.generationThroughput),
    };
  }
  const nowMs = Date.now();
  const promptTokens = firstMetric(prometheus, names.promptTokens);
  const genTokens = firstMetric(prometheus, names.generationTokens);
  const previous = throughputSamples.get(modelId);
  if (!previous) {
    throughputSamples.set(modelId, {
      promptTokens,
      genTokens,
      ts: nowMs,
      promptTps: 0,
      genTps: 0,
    });
    return { prompt: 0, generation: 0 };
  }
  if (nowMs - previous.ts < MIN_RATE_INTERVAL_MS) {
    return { prompt: previous.promptTps, generation: previous.genTps };
  }
  const elapsedSeconds = (nowMs - previous.ts) / 1000;
  const prompt = Math.max(0, (promptTokens - previous.promptTokens) / elapsedSeconds);
  const generation = Math.max(0, (genTokens - previous.genTokens) / elapsedSeconds);
  throughputSamples.set(modelId, {
    promptTokens,
    genTokens,
    ts: nowMs,
    promptTps: prompt,
    genTps: generation,
  });
  return { prompt, generation };
};

const buildUsageMetrics = (
  usage: UsageAggregate | null,
  promptTokens: number,
  generationTokens: number,
): EventData => ({
  prompt_tokens_total:
    positiveOrUndefined(promptTokens) ?? positiveOrUndefined(usage?.totals.prompt_tokens),
  generation_tokens_total:
    positiveOrUndefined(generationTokens) ?? positiveOrUndefined(usage?.totals.completion_tokens),
  total_tokens: positiveOrUndefined(usage?.totals.total_tokens),
  total_requests: positiveOrUndefined(usage?.totals.total_requests),
  latency_avg: positiveOrUndefined(usage?.latency?.avg_ms),
});

const buildPeakMetrics = (
  peak: PeakMetric | null,
  best: ReturnType<AppContext["stores"]["peakMetricsStore"]["getBestSession"]>,
): EventData => ({
  best_session_peak_id: best?.session_id ?? null,
  best_session_prefill_tps: best?.peak_prefill_tps ?? null,
  best_session_generation_tps: best?.peak_generation_tps ?? null,
  best_session_ttft_ms: best?.best_ttft_ms ?? null,
  peak_prefill_tps: peak?.prefill_tps ?? null,
  peak_generation_tps: peak?.generation_tps ?? null,
  peak_ttft_ms: peak?.ttft_ms ?? null,
});

type ObservedProcess = Effect.Success<ReturnType<typeof findObservedInferenceProcess>>;
type EngineScrape = Effect.Success<ReturnType<typeof scrapeEngineMetrics>>;

const resolveActiveEngine = (current: ObservedProcess, scrape: EngineScrape): ActiveEngine => {
  const isSglang = current?.backend === "sglang" || (!current && scrape.hasSglang);
  const modelId =
    current?.served_model_name ??
    current?.model_path?.split("/").pop() ??
    scrape.modelName ??
    "active";
  return {
    isSglang,
    modelId,
    modelPath: current?.model_path ?? null,
    servedModelName: current?.served_model_name ?? scrape.modelName ?? null,
  };
};

const buildCurrentMetrics = (
  context: AppContext,
): Effect.Effect<Record<string, string | number | boolean | null | undefined>, unknown> =>
  Effect.gen(function* () {
    const current = yield* findObservedInferenceProcess(context, "metrics.current");
    const gpus = yield* getGpuInfo();
    const lifetimeData = yield* context.stores.lifetimeMetricsStore.getAllEffect();
    const baseMetrics = buildBaseMetrics(lifetimeData, gpus);
    const scrape = yield* scrapeEngineMetrics(context.config.inference_port, 1500);
    const engineActive = scrape.hasVllm || scrape.hasSglang || scrape.hasLlamacpp;
    if (!current && !engineActive) {
      return { ...baseMetrics, model_id: null, model_path: null, served_model_name: null };
    }
    const active = resolveActiveEngine(current, scrape);
    const names = active.isSglang ? SGLANG_METRIC_NAMES : VLLM_METRIC_NAMES;
    const usage: UsageAggregate | null =
      yield* context.stores.inferenceRequestStore.aggregateEffect(
        buildModelKeys(active.modelId, active.modelPath),
      );
    const promptTokens = firstMetric(scrape.metrics, names.promptTokens);
    const generationTokens = firstMetric(scrape.metrics, names.generationTokens);
    const throughput = calculateThroughput(active.modelId, active.isSglang, scrape.metrics, names);
    const ttftCount = scrape.metrics[names.ttftCount] ?? 0;
    const avgTtftMs = ttftCount > 0 ? ((scrape.metrics[names.ttftSum] ?? 0) / ttftCount) * 1000 : 0;
    const peak = yield* context.stores.peakMetricsStore.getEffect(active.modelId);
    const best = yield* context.stores.peakMetricsStore.getBestSessionEffect(active.modelId);
    return {
      ...baseMetrics,
      model_id: active.modelId,
      model_path: active.modelPath,
      served_model_name: active.servedModelName,
      running_requests: firstMetric(scrape.metrics, names.runningRequests),
      pending_requests: firstMetric(scrape.metrics, names.pendingRequests),
      kv_cache_usage: firstMetric(scrape.metrics, names.kvCacheUsage),
      ...buildUsageMetrics(usage, promptTokens, generationTokens),
      prompt_throughput: throughput.prompt,
      generation_throughput: throughput.generation,
      avg_ttft_ms: avgTtftMs > 0 ? Math.round(avgTtftMs * 10) / 10 : usage?.ttft.avg_ms,
      ...buildPeakMetrics(peak, best),
    };
  });

const PEAK_METRICS_CACHE_TTL_MS = 15_000;

export const registerMonitoringRoutes = defineRoutes((app, context) => {
  type PeakMetricsBody = PeakMetric | { error: string } | { metrics: PeakMetricWithBestSession[] };
  const peakMetricsCache = new Map<string, { at: number; body: PeakMetricsBody }>();

  return mergeRoutes(
    effectRoute(app.get, "/v1/metrics/vllm", (ctx) =>
      Effect.gen(function* () {
        const current = yield* buildCurrentMetrics(context).pipe(
          Effect.tap((metrics) => context.eventManager.publishMetrics(metrics)),
          Effect.catch((error) => {
            context.logger.warn(`Failed to build current metrics: ${String(error)}`);
            const latest = context.eventManager.getLatestMetrics();
            return Object.keys(latest).length > 0 ? Effect.succeed(latest) : Effect.fail(error);
          }),
        );
        return ctx.json(current);
      }),
    ),

    effectRoute(app.get, "/peak-metrics", (ctx) =>
      Effect.gen(function* () {
        const modelId = ctx.req.query("model_id");
        const cacheKey = modelId ?? "\u0000all";
        const cached = peakMetricsCache.get(cacheKey);
        if (cached && Date.now() - cached.at < PEAK_METRICS_CACHE_TTL_MS) {
          return ctx.json(cached.body);
        }
        const body = yield* modelId
          ? context.stores.peakMetricsStore
              .getEffect(modelId)
              .pipe(Effect.map((metrics) => metrics ?? { error: "No metrics for this model" }))
          : context.stores.peakMetricsStore
              .getAllEffect()
              .pipe(Effect.map((metrics) => ({ metrics })));
        peakMetricsCache.set(cacheKey, { at: Date.now(), body });
        return ctx.json(body);
      }),
    ),

    effectRoute(app.post, "/benchmark", (ctx) =>
      Effect.gen(function* () {
        const promptTokensRaw = ctx.req.query("prompt_tokens");
        const query = yield* Schema.decodeUnknownEffect(BenchmarkQuerySchema)(
          promptTokensRaw === undefined ? {} : { prompt_tokens: promptTokensRaw },
        ).pipe(Effect.mapError(() => badRequest("Invalid benchmark query")));
        const promptTokens = query.prompt_tokens ?? 1000;
        const current = yield* findObservedInferenceProcess(context, "benchmark");
        if (!current) {
          return ctx.json({ error: "No model running" });
        }
        const modelId =
          current.served_model_name ?? current.model_path?.split("/").pop() ?? "unknown";
        const prompt = `Please count: ${Array.from({ length: Math.floor(promptTokens / 2) })
          .map((_, index) => index.toString())
          .join(" ")}`;

        const start = performance.now();
        const response = yield* fetchInference(context, "/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: modelId,
            messages: [{ role: "user", content: prompt }],
            stream: false,
          }),
        }).pipe(Effect.mapError(() => serviceUnavailable("Benchmark request failed")));
        const totalTime = (performance.now() - start) / 1000;
        if (!response.ok) {
          return ctx.json({ error: `Request failed: ${response.status}` });
        }
        const data = yield* Effect.tryPromise({
          try: () => response.json(),
          catch: (error) => error,
        }).pipe(
          Effect.flatMap((value) => Schema.decodeUnknownEffect(BenchmarkResponseSchema)(value)),
          Effect.mapError(() => serviceUnavailable("Invalid benchmark response")),
        );
        const usage = data.usage ?? {};
        const promptTokensActual = usage["prompt_tokens"] ?? 0;
        const completionTokens = usage["completion_tokens"] ?? 0;

        if (completionTokens > 0 && promptTokensActual > 0) {
          const generationTps = completionTokens / totalTime;

          const result = yield* context.stores.peakMetricsStore
            .updateIfBetterEffect(modelId, undefined, generationTps, undefined)
            .pipe(
              Effect.tap(() =>
                context.stores.peakMetricsStore.addTokensEffect(modelId, completionTokens, 1),
              ),
            );

          return ctx.json({
            success: true,
            model_id: modelId,
            benchmark: {
              prompt_tokens: promptTokensActual,
              completion_tokens: completionTokens,
              total_time_s: Math.round(totalTime * 100) / 100,
              generation_tps: Math.round(generationTps * 10) / 10,
            },
            peak_metrics: result,
          });
        }
        return ctx.json({ error: "No tokens in response" });
      }),
    ),
  );
});
