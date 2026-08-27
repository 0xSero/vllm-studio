import { Predicate } from "effect";
import type { ControllerUsageStatsSchema, UsageStatsSchema } from "./usage-schema";

type JsonValue = string | number | boolean | bigint | null | undefined | JsonObject | JsonValue[];

interface JsonObject {
  [key: string]: JsonValue;
}

const isJsonObject = (value: JsonValue): value is JsonObject =>
  value !== null && !Array.isArray(value) && Object(value) === value;

const objectOrEmpty = (value: JsonValue): JsonObject => (isJsonObject(value) ? value : {});

const nonEmptyObject = (value: JsonValue): JsonObject | undefined => {
  const object = objectOrEmpty(value);
  return Object.keys(object).length > 0 ? object : undefined;
};

const rows = (value: JsonValue): JsonObject[] =>
  Array.isArray(value) ? value.map(objectOrEmpty) : [];

const finiteNumber = (value: JsonValue, fallback = 0): number => {
  try {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  } catch {
    return fallback;
  }
};

const nullableNumber = (value: JsonValue): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const number = finiteNumber(value, NaN);
  return Number.isFinite(number) ? number : null;
};

const stringValue = (value: JsonValue, fallback = ""): string =>
  Predicate.isString(value) && value.length > 0 ? value : fallback;

const nullableString = (value: JsonValue): string | null => stringValue(value) || null;

const fields = <const Key extends string, Value>(
  source: JsonObject,
  keys: readonly Key[],
  decode: (value: JsonValue) => Value,
): Record<Key, Value> => {
  const output: Record<Key, Value> = Object.create(null);
  for (const key of keys) output[key] = decode(source[key]);
  return output;
};

const numbers = <const Key extends string>(
  source: JsonObject,
  keys: readonly Key[],
): Record<Key, number> => fields(source, keys, finiteNumber);

const nullableNumbers = <const Key extends string>(
  source: JsonObject,
  keys: readonly Key[],
): Record<Key, number | null> => fields(source, keys, nullableNumber);

const strings = <const Key extends string>(
  source: JsonObject,
  keys: readonly Key[],
): Record<Key, string> => fields(source, keys, stringValue);

export function normalizeControllerUsage(value: JsonObject): ControllerUsageStats;
export function normalizeControllerUsage(value: JsonValue): ControllerUsageStats | undefined;
export function normalizeControllerUsage(value: JsonValue): ControllerUsageStats | undefined {
  const controller = nonEmptyObject(value);
  if (!controller) return undefined;
  const totals = objectOrEmpty(controller["totals"]);
  const latency = objectOrEmpty(controller["latency"]);
  const recent = objectOrEmpty(controller["recent_activity"]);
  const functionCalls = nonEmptyObject(controller["function_calls"]);

  const normalized: ControllerUsageStats = {
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
    by_path: rows(controller["by_path"]).map((path) => ({
      ...strings(path, ["method", "path"]),
      ...numbers(path, ["requests", "successful", "failed", "success_rate"]),
      ...nullableNumbers(path, ["avg_duration_ms", "max_duration_ms"]),
    })),
    by_status: rows(controller["by_status"]).map((status) =>
      numbers(status, ["status", "requests"]),
    ),
    recent_errors: rows(controller["recent_errors"]).map((error) => ({
      ...strings(error, ["method", "path"]),
      status: finiteNumber(error["status"]),
      error_class: nullableString(error["error_class"]),
      error_message: nullableString(error["error_message"]),
      created_at: stringValue(error["created_at"]),
    })),
  };
  if (functionCalls) {
    return {
      ...normalized,
      function_calls: {
        totals: numbers(objectOrEmpty(functionCalls["totals"]), [
          "total_calls",
          "successful_calls",
          "failed_calls",
          "success_rate",
        ]),
        latency: nullableNumbers(objectOrEmpty(functionCalls["latency"]), ["avg_ms", "max_ms"]),
        by_function: rows(functionCalls["by_function"]).map((entry) => ({
          function_name: stringValue(entry["function_name"]),
          ...numbers(entry, ["calls", "successful", "failed", "success_rate"]),
          ...nullableNumbers(entry, ["avg_duration_ms", "max_duration_ms"]),
        })),
        recent_errors: rows(functionCalls["recent_errors"]).map((error) => ({
          function_name: stringValue(error["function_name"]),
          error_class: nullableString(error["error_class"]),
          error_message: nullableString(error["error_message"]),
          created_at: stringValue(error["created_at"]),
        })),
      },
    };
  }
  return normalized;
}

export const normalizeUsageStats = (input: JsonValue): UsageStats => {
  const usage = objectOrEmpty(input);
  const weekOverWeek = objectOrEmpty(usage["week_over_week"]);
  const recent = objectOrEmpty(usage["recent_activity"]);
  const controller = normalizeControllerUsage(usage["controller"]);

  const normalized: UsageStats = {
    totals: numbers(objectOrEmpty(usage["totals"]), [
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
    latency: nullableNumbers(objectOrEmpty(usage["latency"]), [
      "avg_ms",
      "p50_ms",
      "p95_ms",
      "p99_ms",
      "min_ms",
      "max_ms",
    ]),
    ttft: nullableNumbers(objectOrEmpty(usage["ttft"]), ["avg_ms", "p50_ms", "p95_ms", "p99_ms"]),
    tokens_per_request: numbers(objectOrEmpty(usage["tokens_per_request"]), [
      "avg",
      "avg_prompt",
      "avg_completion",
      "max",
      "p50",
      "p95",
    ]),
    cache: numbers(objectOrEmpty(usage["cache"]), [
      "hits",
      "misses",
      "hit_tokens",
      "miss_tokens",
      "hit_rate",
    ]),
    week_over_week: {
      this_week: numbers(objectOrEmpty(weekOverWeek["this_week"]), [
        "requests",
        "tokens",
        "successful",
      ]),
      last_week: numbers(objectOrEmpty(weekOverWeek["last_week"]), [
        "requests",
        "tokens",
        "successful",
      ]),
      change_pct: nullableNumbers(objectOrEmpty(weekOverWeek["change_pct"]), [
        "requests",
        "tokens",
      ]),
    },
    recent_activity: {
      ...numbers(recent, [
        "last_hour_requests",
        "last_24h_requests",
        "prev_24h_requests",
        "last_24h_tokens",
      ]),
      change_24h_pct: nullableNumber(recent["change_24h_pct"]),
    },
    peak_days: rows(usage["peak_days"]).map((day) => ({
      date: stringValue(day["date"]),
      ...numbers(day, ["requests", "tokens"]),
    })),
    peak_hours: rows(usage["peak_hours"]).map((hour) => numbers(hour, ["hour", "requests"])),
    by_model: rows(usage["by_model"]).map((model, index) => ({
      model: stringValue(model["model"], `unknown-${index + 1}`),
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
    daily: rows(usage["daily"]).map((day) => ({
      date: stringValue(day["date"]),
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
    daily_by_model: rows(usage["daily_by_model"]).map((day, index) => ({
      date: stringValue(day["date"]),
      model: stringValue(day["model"], `unknown-${index + 1}`),
      ...numbers(day, [
        "requests",
        "successful",
        "success_rate",
        "total_tokens",
        "prompt_tokens",
        "completion_tokens",
      ]),
    })),
    hourly_pattern: rows(usage["hourly_pattern"]).map((hour) =>
      numbers(hour, ["hour", "requests", "successful", "tokens"]),
    ),
  };
  if (controller) return { ...normalized, controller };
  return normalized;
};

export type ControllerUsageStats = typeof ControllerUsageStatsSchema.Type;
export type UsageStats = typeof UsageStatsSchema.Type;

export const usageRate = (successful: JsonValue, total: JsonValue): number => {
  const count = finiteNumber(total);
  return count ? (finiteNumber(successful) / count) * 100 : 0;
};

export const usageAverage = (value: JsonValue, total: JsonValue): number => {
  const count = finiteNumber(total);
  return count ? Math.round(finiteNumber(value) / count) : 0;
};
