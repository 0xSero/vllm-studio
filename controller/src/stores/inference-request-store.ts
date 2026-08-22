import type { Database } from "bun:sqlite";
import {
  normalizeUsageStats,
  usageAverage,
  usageRate,
  type UsageStats,
} from "@local-studio/contracts/usage";
import type { Effect } from "effect";
import {
  repositoryEffect,
  SqliteStore,
  toFiniteNumber,
  toNullableNumber,
  type RepositoryError,
} from "./sqlite";

export interface InferenceRequestRecord {
  model: string;
  source?: string | null;
  session_id?: string | null;
  provider?: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  ttft_ms?: number | null;
  duration_ms?: number | null;
  status?: number;
  streamed?: boolean;
}

export type UsageAggregate = Omit<UsageStats, "controller">;

interface NumberRow {
  [key: string]: number;
}

type Row = Record<string, unknown>;

const migrate = (db: Database): void => {
  db.run(`
      CREATE TABLE IF NOT EXISTS inference_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        model TEXT NOT NULL,
        source TEXT,
        session_id TEXT,
        provider TEXT,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        ttft_ms INTEGER,
        duration_ms INTEGER,
        status INTEGER NOT NULL DEFAULT 200,
        streamed INTEGER NOT NULL DEFAULT 0
      )
    `);
  for (const index of [
    "idx_inference_requests_created_at ON inference_requests(created_at)",
    "idx_inference_requests_model_created ON inference_requests(model, created_at)",
  ]) {
    db.run(`CREATE INDEX IF NOT EXISTS ${index}`);
  }
};

const buildModelFilter = (
  knownModels?: ReadonlySet<string>,
): { clause: string; params: string[] } => {
  if (!knownModels || knownModels.size === 0) return { clause: "", params: [] };
  const params = [...knownModels];
  const placeholders = params.map(() => "?").join(",");
  return { clause: ` AND model IN (${placeholders})`, params };
};

const changePct = (current: number, previous: number): number | null => {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
};

export class InferenceRequestStore extends SqliteStore {
  public constructor(dbPath: string) {
    super(dbPath, "inference-requests", migrate);
  }

  public record(record: InferenceRequestRecord): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("inference-requests.record", () => {
      const promptTokens = Math.max(0, Math.round(record.prompt_tokens));
      const completionTokens = Math.max(0, Math.round(record.completion_tokens));
      this.db
        .query(
          `INSERT INTO inference_requests (
           model, source, session_id, provider,
           prompt_tokens, completion_tokens, reasoning_tokens,
           cache_read_tokens, cache_write_tokens, total_tokens,
           ttft_ms, duration_ms, status, streamed
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.model,
          record.source ?? null,
          record.session_id ?? null,
          record.provider ?? null,
          promptTokens,
          completionTokens,
          Math.max(0, Math.round(record.reasoning_tokens ?? 0)),
          Math.max(0, Math.round(record.cache_read_tokens ?? 0)),
          Math.max(0, Math.round(record.cache_write_tokens ?? 0)),
          promptTokens + completionTokens,
          record.ttft_ms ?? null,
          record.duration_ms ?? null,
          record.status ?? 200,
          record.streamed ? 1 : 0,
        );
    });
  }

  public aggregateEffect(
    knownModels?: ReadonlySet<string>,
  ): Effect.Effect<UsageAggregate | null, RepositoryError> {
    return repositoryEffect("inference-requests.aggregate", () => {
      const filter = buildModelFilter(knownModels);
      const params = filter.params;
      const rows = (sql: string): Row[] =>
        this.db.query<Row, string[]>(sql).all(...params) as Row[];

      const summary = this.db
        .query<NumberRow, string[]>(
          `SELECT
             COUNT(*) as total_requests,
             COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
             COALESCE(SUM(completion_tokens), 0) as completion_tokens,
             COALESCE(SUM(reasoning_tokens), 0) as reasoning_tokens,
             COALESCE(SUM(cache_read_tokens), 0) as cache_read,
             COALESCE(SUM(cache_write_tokens), 0) as cache_write,
             COUNT(DISTINCT session_id) as unique_sessions,
             SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as ok,
             AVG(duration_ms) as avg_dur,
             AVG(ttft_ms) as avg_ttft,
             SUM(CASE WHEN datetime(created_at) >= datetime('now', '-1 hour') THEN 1 ELSE 0 END) as last_hour,
             SUM(CASE WHEN datetime(created_at) >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) as last_24h,
             SUM(CASE WHEN datetime(created_at) >= datetime('now', '-48 hours') AND datetime(created_at) < datetime('now', '-24 hours') THEN 1 ELSE 0 END) as prev_24h,
             COALESCE(SUM(CASE WHEN datetime(created_at) >= datetime('now', '-24 hours') THEN prompt_tokens + completion_tokens ELSE 0 END), 0) as last_24h_tokens,
             SUM(CASE WHEN datetime(created_at) >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as this_week_requests,
             SUM(CASE WHEN datetime(created_at) >= datetime('now', '-7 days') THEN prompt_tokens + completion_tokens ELSE 0 END) as this_week_tokens,
             SUM(CASE WHEN datetime(created_at) >= datetime('now', '-7 days') AND status >= 200 AND status < 300 THEN 1 ELSE 0 END) as this_week_ok,
             SUM(CASE WHEN datetime(created_at) >= datetime('now', '-14 days') AND datetime(created_at) < datetime('now', '-7 days') THEN 1 ELSE 0 END) as last_week_requests,
             SUM(CASE WHEN datetime(created_at) >= datetime('now', '-14 days') AND datetime(created_at) < datetime('now', '-7 days') THEN prompt_tokens + completion_tokens ELSE 0 END) as last_week_tokens,
             SUM(CASE WHEN datetime(created_at) >= datetime('now', '-14 days') AND datetime(created_at) < datetime('now', '-7 days') AND status >= 200 AND status < 300 THEN 1 ELSE 0 END) as last_week_ok
           FROM inference_requests
           WHERE 1=1${filter.clause}`,
        )
        .get(...params) as NumberRow | null;

      const total = (key: string): number => toFiniteNumber(summary?.[key]);
      const totalRequests = total("total_requests");
      if (totalRequests === 0) return null;

      const promptTokens = total("prompt_tokens");
      const completionTokens = total("completion_tokens");
      const totalTokens = promptTokens + completionTokens;
      const cacheHits = total("cache_read");
      const cacheMisses = total("cache_write");
      const successful = total("ok");

      const byModel = rows(
        `SELECT
             model,
             COUNT(*) as requests,
             SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as successful,
             COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
             COALESCE(SUM(completion_tokens), 0) as completion_tokens,
             COALESCE(SUM(prompt_tokens), 0) + COALESCE(SUM(completion_tokens), 0) as total_tokens,
             AVG(duration_ms) as avg_latency_ms,
             AVG(ttft_ms) as avg_ttft_ms
           FROM inference_requests
           WHERE 1=1${filter.clause}
           GROUP BY model
           ORDER BY total_tokens DESC
           LIMIT 25`,
      );

      const daily = rows(
        `SELECT
             DATE(created_at) as date,
             COUNT(*) as requests,
             SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as successful,
             COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
             COALESCE(SUM(completion_tokens), 0) as completion_tokens,
             COALESCE(SUM(prompt_tokens), 0) + COALESCE(SUM(completion_tokens), 0) as total_tokens,
             AVG(duration_ms) as avg_latency_ms
           FROM inference_requests
           WHERE DATE(created_at) >= DATE('now', '-366 days')${filter.clause}
           GROUP BY DATE(created_at)
           ORDER BY date DESC
           LIMIT 400`,
      );

      const dailyByModel = rows(
        `SELECT
             DATE(created_at) as date,
             model,
             COUNT(*) as requests,
             SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as successful,
             COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
             COALESCE(SUM(completion_tokens), 0) as completion_tokens,
             COALESCE(SUM(prompt_tokens), 0) + COALESCE(SUM(completion_tokens), 0) as total_tokens
           FROM inference_requests
           WHERE DATE(created_at) >= DATE('now', '-366 days')${filter.clause}
           GROUP BY DATE(created_at), model
           ORDER BY date DESC
           LIMIT 10000`,
      );

      const hourly = rows(
        `SELECT
             CAST(strftime('%H', created_at) AS INTEGER) as hour,
             COUNT(*) as requests,
             SUM(CASE WHEN status >= 200 AND status < 300 THEN 1 ELSE 0 END) as successful,
             COALESCE(SUM(prompt_tokens + completion_tokens), 0) as tokens
           FROM inference_requests
           WHERE 1=1${filter.clause}
           GROUP BY strftime('%H', created_at)
           ORDER BY hour`,
      );

      const peakDays = rows(
        `SELECT
             DATE(created_at) as date,
             COUNT(*) as requests,
             COALESCE(SUM(prompt_tokens + completion_tokens), 0) as tokens
           FROM inference_requests
           WHERE 1=1${filter.clause}
           GROUP BY DATE(created_at)
           ORDER BY requests DESC
           LIMIT 5`,
      );

      const peakHours = rows(
        `SELECT
             CAST(strftime('%H', created_at) AS INTEGER) as hour,
             COUNT(*) as requests
           FROM inference_requests
           WHERE DATE(created_at) >= DATE('now', '-7 days')${filter.clause}
           GROUP BY strftime('%H', created_at)
           ORDER BY requests DESC
           LIMIT 5`,
      );

      const withSuccessRate = (row: Row): Row => ({
        ...row,
        success_rate: usageRate(row["successful"], row["requests"]),
      });

      // Fields normalizeUsageStats fills on its own are left out here: percentile
      // slots decode to null and uncomputed counters to 0.
      return normalizeUsageStats({
        totals: {
          total_tokens: totalTokens,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_requests: totalRequests,
          successful_requests: successful,
          failed_requests: totalRequests - successful,
          success_rate: usageRate(successful, totalRequests),
          unique_sessions: total("unique_sessions"),
        },
        latency: { avg_ms: toNullableNumber(summary?.["avg_dur"]) },
        ttft: { avg_ms: toNullableNumber(summary?.["avg_ttft"]) },
        tokens_per_request: {
          avg: usageAverage(totalTokens, totalRequests),
          avg_prompt: usageAverage(promptTokens, totalRequests),
          avg_completion: usageAverage(completionTokens, totalRequests),
          max: byModel.reduce(
            (max, row) => Math.max(max, usageAverage(row["total_tokens"], row["requests"])),
            0,
          ),
        },
        cache: {
          hits: cacheHits,
          misses: cacheMisses,
          hit_tokens: cacheHits,
          miss_tokens: cacheMisses,
          hit_rate: usageRate(cacheHits, cacheHits + cacheMisses),
        },
        week_over_week: {
          this_week: {
            requests: total("this_week_requests"),
            tokens: total("this_week_tokens"),
            successful: total("this_week_ok"),
          },
          last_week: {
            requests: total("last_week_requests"),
            tokens: total("last_week_tokens"),
            successful: total("last_week_ok"),
          },
          change_pct: {
            requests: changePct(total("this_week_requests"), total("last_week_requests")),
            tokens: changePct(total("this_week_tokens"), total("last_week_tokens")),
          },
        },
        recent_activity: {
          last_hour_requests: total("last_hour"),
          last_24h_requests: total("last_24h"),
          prev_24h_requests: total("prev_24h"),
          last_24h_tokens: total("last_24h_tokens"),
          change_24h_pct: changePct(total("last_24h"), total("prev_24h")),
        },
        peak_days: peakDays,
        peak_hours: peakHours,
        by_model: byModel.map((row) => ({
          ...withSuccessRate(row),
          avg_tokens: usageAverage(row["total_tokens"], row["requests"]),
          avg_latency_ms: toNullableNumber(row["avg_latency_ms"]),
          avg_ttft_ms: toNullableNumber(row["avg_ttft_ms"]),
        })),
        daily: daily.map(withSuccessRate),
        daily_by_model: dailyByModel.map(withSuccessRate),
        hourly_pattern: hourly,
      });
    });
  }
}
