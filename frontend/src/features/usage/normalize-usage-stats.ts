import type { UsageStats } from "@/lib/types";

type UnknownRecord = Record<string, unknown>;

const record = (value: unknown): UnknownRecord =>
  value && typeof value === "object" ? (value as UnknownRecord) : {};

const array = (value: unknown): UnknownRecord[] => (Array.isArray(value) ? value.map(record) : []);

const num = (value: unknown, fallback = 0): number => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const nullableNum = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const text = (value: unknown, fallback = ""): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;

const project = <const Key extends string, Value>(
  source: UnknownRecord,
  keys: readonly Key[],
  decode: (value: unknown) => Value,
): Record<Key, Value> =>
  Object.fromEntries(keys.map((key) => [key, decode(source[key])])) as Record<Key, Value>;

const numbers = <const Key extends string>(source: UnknownRecord, keys: readonly Key[]) =>
  project(source, keys, num);

const nullableNumbers = <const Key extends string>(source: UnknownRecord, keys: readonly Key[]) =>
  project(source, keys, nullableNum);

const texts = <const Key extends string>(source: UnknownRecord, keys: readonly Key[]) =>
  project(source, keys, text);

function normalizeControllerUsage(value: unknown): UsageStats["controller"] {
  const controller = record(value);
  if (Object.keys(controller).length === 0) return undefined;
  const totals = record(controller.totals);
  const latency = record(controller.latency);
  const recent = record(controller.recent_activity);
  const functionCalls = record(controller.function_calls);
  const functionTotals = record(functionCalls.totals);
  const functionLatency = record(functionCalls.latency);

  return {
    totals: numbers(totals, [
      "total_requests",
      "successful_requests",
      "failed_requests",
      "success_rate",
    ]),
    latency: nullableNumbers(latency, ["avg_ms", "max_ms"]),
    recent_activity: numbers(recent, [
      "last_hour_requests",
      "last_24h_requests",
      "last_24h_failed_requests",
    ]),
    by_path: array(controller.by_path).map((path) => ({
      ...texts(path, ["method", "path"]),
      ...numbers(path, ["requests", "successful", "failed", "success_rate"]),
      ...nullableNumbers(path, ["avg_duration_ms", "max_duration_ms"]),
    })),
    by_status: array(controller.by_status).map((status) => numbers(status, ["status", "requests"])),
    recent_errors: array(controller.recent_errors).map((error) => ({
      ...texts(error, ["method", "path", "created_at"]),
      status: num(error.status),
      error_class: text(error.error_class) || null,
      error_message: text(error.error_message) || null,
    })),
    function_calls:
      Object.keys(functionCalls).length === 0
        ? undefined
        : {
            totals: numbers(functionTotals, [
              "total_calls",
              "successful_calls",
              "failed_calls",
              "success_rate",
            ]),
            latency: nullableNumbers(functionLatency, ["avg_ms", "max_ms"]),
            by_function: array(functionCalls.by_function).map((entry) => ({
              function_name: text(entry.function_name),
              ...numbers(entry, ["calls", "successful", "failed", "success_rate"]),
              ...nullableNumbers(entry, ["avg_duration_ms", "max_duration_ms"]),
            })),
            recent_errors: array(functionCalls.recent_errors).map((error) => ({
              function_name: text(error.function_name),
              error_class: text(error.error_class) || null,
              error_message: text(error.error_message) || null,
              created_at: text(error.created_at),
            })),
          },
  };
}

export function normalizeUsageStats(input: UsageStats | null | undefined): UsageStats {
  const usage = record(input);
  const weekOverWeek = record(usage.week_over_week);
  return {
    totals: numbers(record(usage.totals), [
      "total_tokens",
      "prompt_tokens",
      "completion_tokens",
      "total_requests",
      "successful_requests",
      "failed_requests",
      "success_rate",
      "unique_sessions",
      "unique_users",
    ]),
    latency: nullableNumbers(record(usage.latency), [
      "avg_ms",
      "p50_ms",
      "p95_ms",
      "p99_ms",
      "min_ms",
      "max_ms",
    ]),
    ttft: nullableNumbers(record(usage.ttft), ["avg_ms", "p50_ms", "p95_ms", "p99_ms"]),
    tokens_per_request: numbers(record(usage.tokens_per_request), [
      "avg",
      "avg_prompt",
      "avg_completion",
      "max",
      "p50",
      "p95",
    ]),
    cache: numbers(record(usage.cache), [
      "hits",
      "misses",
      "hit_tokens",
      "miss_tokens",
      "hit_rate",
    ]),
    week_over_week: {
      this_week: numbers(record(weekOverWeek.this_week), ["requests", "tokens", "successful"]),
      last_week: numbers(record(weekOverWeek.last_week), ["requests", "tokens", "successful"]),
      change_pct: nullableNumbers(record(weekOverWeek.change_pct), ["requests", "tokens"]),
    },
    recent_activity: {
      ...numbers(record(usage.recent_activity), [
        "last_hour_requests",
        "last_24h_requests",
        "prev_24h_requests",
        "last_24h_tokens",
      ]),
      change_24h_pct: nullableNum(record(usage.recent_activity).change_24h_pct),
    },
    peak_days: array(usage.peak_days).map((day) => ({
      date: text(day.date),
      ...numbers(day, ["requests", "tokens"]),
    })),
    peak_hours: array(usage.peak_hours).map((hour) => numbers(hour, ["hour", "requests"])),
    by_model: array(usage.by_model).map((model, index) => ({
      model: text(model.model, `unknown-${index + 1}`),
      ...numbers(model, [
        "requests",
        "successful",
        "success_rate",
        "total_tokens",
        "prompt_tokens",
        "completion_tokens",
        "avg_tokens",
      ]),
      ...nullableNumbers(model, [
        "avg_latency_ms",
        "p50_latency_ms",
        "avg_ttft_ms",
        "tokens_per_sec",
        "prefill_tps",
        "generation_tps",
      ]),
    })),
    daily: array(usage.daily).map((day) => ({
      date: text(day.date),
      ...numbers(day, [
        "requests",
        "successful",
        "success_rate",
        "total_tokens",
        "prompt_tokens",
        "completion_tokens",
        "avg_latency_ms",
      ]),
    })),
    daily_by_model: array(usage.daily_by_model).map((day, index) => ({
      date: text(day.date),
      model: text(day.model, `unknown-${index + 1}`),
      ...numbers(day, [
        "requests",
        "successful",
        "success_rate",
        "total_tokens",
        "prompt_tokens",
        "completion_tokens",
      ]),
    })),
    hourly_pattern: array(usage.hourly_pattern).map((hour) =>
      numbers(hour, ["hour", "requests", "successful", "tokens"]),
    ),
    controller: normalizeControllerUsage(usage.controller),
  };
}
