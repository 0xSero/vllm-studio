import type { Logger } from "../../core/logger";
import type { LifetimeMetricsStore } from "../system/metrics-store";
import type {
  InferenceRequestRecord,
  InferenceRequestStore,
} from "../../stores/inference-request-store";
import { Effect } from "effect";

interface InferenceAccountingStores {
  lifetimeMetricsStore: Pick<
    LifetimeMetricsStore,
    "addCompletionTokens" | "addPromptTokens" | "addRequests" | "addTokens"
  >;
  inferenceRequestStore: Pick<InferenceRequestStore, "record">;
}

interface InferenceAccountingOptions {
  logger: Pick<Logger, "warn">;
  stores: InferenceAccountingStores;
}
export interface InferenceUsageInput {
  prompt_tokens?: number;
  completion_tokens?: number;
  reasoning_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  prompt_tokens_details?: Record<string, number>;
  completion_tokens_details?: Record<string, number>;
}

export interface InferenceUsageTotals {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** The token columns this module fills in from the upstream usage block. */
type AccountedColumns =
  | "cache_read_tokens"
  | "cache_write_tokens"
  | "completion_tokens"
  | "prompt_tokens"
  | "reasoning_tokens";

interface InferenceRecordInput {
  usage: InferenceUsageInput | undefined;
  record: Omit<InferenceRequestRecord, AccountedColumns | "streamed">;
  streamed: boolean;
}

const hasBillableTokens = (totals: InferenceUsageTotals): boolean =>
  totals.promptTokens > 0 || totals.completionTokens > 0;

const readUsageTotals = (usage: InferenceUsageInput): InferenceUsageTotals => ({
  promptTokens: usage.prompt_tokens ?? 0,
  completionTokens: usage.completion_tokens ?? 0,
  reasoningTokens:
    usage.reasoning_tokens ?? usage.completion_tokens_details?.["reasoning_tokens"] ?? 0,
  cacheReadTokens: usage.prompt_tokens_details?.["cached_tokens"] ?? usage.cache_read_tokens ?? 0,
  cacheWriteTokens: usage.cache_write_tokens ?? 0,
});

const addLifetimeUsage = (
  stores: InferenceAccountingStores,
  totals: InferenceUsageTotals,
): Effect.Effect<void, unknown> => {
  const metrics = stores.lifetimeMetricsStore;
  const updates: Effect.Effect<void, unknown>[] = [];
  if (totals.promptTokens > 0) {
    updates.push(
      metrics.addPromptTokens(totals.promptTokens),
      metrics.addTokens(totals.promptTokens),
    );
  }
  if (totals.completionTokens > 0) {
    updates.push(
      metrics.addCompletionTokens(totals.completionTokens),
      metrics.addTokens(totals.completionTokens),
    );
  }
  if (hasBillableTokens(totals)) updates.push(metrics.addRequests(1));
  return Effect.all(updates, { concurrency: 1, discard: true });
};

export const recordInferenceUsage = (
  options: InferenceAccountingOptions,
  input: InferenceRecordInput,
): Effect.Effect<InferenceUsageTotals | null, unknown> => {
  if (!input.usage) return Effect.succeed(null);
  const totals = readUsageTotals(input.usage);
  const record = hasBillableTokens(totals)
    ? options.stores.inferenceRequestStore
        .record({
          ...input.record,
          prompt_tokens: totals.promptTokens,
          completion_tokens: totals.completionTokens,
          reasoning_tokens: totals.reasoningTokens,
          cache_read_tokens: totals.cacheReadTokens,
          cache_write_tokens: totals.cacheWriteTokens,
          streamed: input.streamed,
        })
        .pipe(
          Effect.catch((recordError) =>
            Effect.sync(() =>
              options.logger.warn(`Failed to record inference request: ${String(recordError)}`),
            ),
          ),
        )
    : Effect.void;
  return addLifetimeUsage(options.stores, totals).pipe(Effect.andThen(record), Effect.as(totals));
};
