import type { EngineMetricNames } from "./engine-metrics-scrape";
import { firstMetric } from "./metrics-peaks";

export type ThroughputStatus = "live" | "last" | "unavailable";

type EngineCounters = {
  completedRequests: number;
  generationDurationSeconds: number;
  generationTokens: number;
  promptDurationSeconds: number;
  promptTokens: number;
  requestGenerationTokens: number;
  requestPromptTokens: number;
};

type TrackedEngineSample = {
  at: number;
  counters: EngineCounters;
  generationThroughput: number;
  promptThroughput: number;
};

export type EnginePerformance = {
  completedRequests: number;
  generationThroughput: number;
  generationThroughputStatus: ThroughputStatus;
  promptThroughput: number;
  promptThroughputStatus: ThroughputStatus;
};

type ObserveEnginePerformanceInput = {
  key: string;
  metrics: Record<string, number>;
  names: EngineMetricNames;
  observedAt?: number;
  pendingRequests: number;
  runningRequests: number;
};

const MIN_LIVE_RATE_INTERVAL_MS = 250;

const positiveRate = (tokens: number, seconds: number): number =>
  tokens > 0 && seconds > 0 ? tokens / seconds : 0;

const delta = (current: number, previous: number): number => Math.max(0, current - previous);

const readCounters = (
  metrics: Record<string, number>,
  names: EngineMetricNames,
): EngineCounters => ({
  completedRequests: firstMetric(metrics, names.completedRequests),
  generationDurationSeconds: firstMetric(metrics, names.generationDurationSeconds),
  generationTokens: firstMetric(metrics, names.generationTokens),
  promptDurationSeconds: firstMetric(metrics, names.promptDurationSeconds),
  promptTokens: firstMetric(metrics, names.promptTokens),
  requestGenerationTokens: firstMetric(metrics, names.requestGenerationTokens),
  requestPromptTokens: firstMetric(metrics, names.requestPromptTokens),
});

const countersReset = (current: EngineCounters, previous: EngineCounters): boolean =>
  current.completedRequests < previous.completedRequests ||
  current.generationDurationSeconds < previous.generationDurationSeconds ||
  current.generationTokens < previous.generationTokens ||
  current.promptDurationSeconds < previous.promptDurationSeconds ||
  current.promptTokens < previous.promptTokens ||
  current.requestGenerationTokens < previous.requestGenerationTokens ||
  current.requestPromptTokens < previous.requestPromptTokens;

const statusFor = (sampled: number, retained: number, active: boolean): ThroughputStatus => {
  if (sampled > 0 && active) return "live";
  return retained > 0 ? "last" : "unavailable";
};

export class EnginePerformanceTracker {
  readonly #samples = new Map<string, TrackedEngineSample>();

  observe({
    key,
    metrics,
    names,
    observedAt = Date.now(),
    pendingRequests,
    runningRequests,
  }: ObserveEnginePerformanceInput): EnginePerformance {
    const previous = this.#samples.get(key);
    if (Object.keys(metrics).length === 0) {
      return {
        completedRequests: previous?.counters.completedRequests ?? 0,
        generationThroughput: previous?.generationThroughput ?? 0,
        generationThroughputStatus: previous?.generationThroughput ? "last" : "unavailable",
        promptThroughput: previous?.promptThroughput ?? 0,
        promptThroughputStatus: previous?.promptThroughput ? "last" : "unavailable",
      };
    }
    const counters = readCounters(metrics, names);
    const reset = previous ? countersReset(counters, previous.counters) : false;
    const directPromptThroughput = firstMetric(metrics, names.promptThroughput);
    const directGenerationThroughput = firstMetric(metrics, names.generationThroughput);
    const active = runningRequests > 0 || pendingRequests > 0;
    let sampledPromptThroughput = directPromptThroughput;
    let sampledGenerationThroughput = directGenerationThroughput;
    let promptThroughput = reset ? 0 : (previous?.promptThroughput ?? 0);
    let generationThroughput = reset ? 0 : (previous?.generationThroughput ?? 0);

    if (previous && !reset) {
      const elapsedSeconds = (observedAt - previous.at) / 1000;
      const completedPromptThroughput = positiveRate(
        delta(counters.requestPromptTokens, previous.counters.requestPromptTokens),
        delta(counters.promptDurationSeconds, previous.counters.promptDurationSeconds),
      );
      const completedGenerationThroughput = positiveRate(
        delta(counters.requestGenerationTokens, previous.counters.requestGenerationTokens),
        delta(counters.generationDurationSeconds, previous.counters.generationDurationSeconds),
      );
      const liveGenerationThroughput =
        elapsedSeconds >= MIN_LIVE_RATE_INTERVAL_MS / 1000
          ? positiveRate(
              delta(counters.generationTokens, previous.counters.generationTokens),
              elapsedSeconds,
            )
          : 0;
      sampledPromptThroughput ||= completedPromptThroughput;
      sampledGenerationThroughput ||=
        (active ? liveGenerationThroughput : completedGenerationThroughput) ||
        (active ? completedGenerationThroughput : liveGenerationThroughput);
    }

    if (sampledPromptThroughput > 0) promptThroughput = sampledPromptThroughput;
    if (sampledGenerationThroughput > 0) generationThroughput = sampledGenerationThroughput;

    const shouldAdvance =
      !previous ||
      reset ||
      observedAt - previous.at >= MIN_LIVE_RATE_INTERVAL_MS ||
      counters.completedRequests !== previous.counters.completedRequests;
    if (shouldAdvance) {
      this.#samples.set(key, {
        at: observedAt,
        counters,
        generationThroughput,
        promptThroughput,
      });
    }

    return {
      completedRequests: counters.completedRequests,
      generationThroughput,
      generationThroughputStatus: statusFor(
        sampledGenerationThroughput,
        generationThroughput,
        active,
      ),
      promptThroughput,
      promptThroughputStatus: statusFor(sampledPromptThroughput, promptThroughput, active),
    };
  }
}

export const enginePerformanceTracker = new EnginePerformanceTracker();
