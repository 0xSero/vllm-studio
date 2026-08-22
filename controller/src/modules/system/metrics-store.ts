import type { Database } from "bun:sqlite";
import { Effect } from "effect";
import {
  makeDatabaseCloser,
  openInitializedDatabase,
  repositoryEffect,
  type RepositoryError,
} from "../../stores/sqlite";

type Row = Record<string, unknown>;

/** Shared open/close plumbing for the two single-table metrics databases. */
abstract class MetricsDatabase {
  protected readonly db: Database;
  private readonly closeDatabase: () => Effect.Effect<void, RepositoryError>;

  protected constructor(dbPath: string, closeLabel: string) {
    this.db = openInitializedDatabase(dbPath, (db) => this.migrate(db));
    this.closeDatabase = makeDatabaseCloser(this.db, closeLabel);
  }

  protected abstract migrate(db: Database): void;

  protected queryRow(sql: string, parameter: string): Row | null {
    const row = this.db.query(sql).get(parameter) as Row | null;
    return row ? { ...row } : null;
  }

  public close(): Effect.Effect<void, RepositoryError> {
    return this.closeDatabase();
  }
}

/**
 * All-time peaks are stored per column with the direction that counts as "better":
 * throughput peaks climb, time-to-first-token improves downwards.
 */
const PEAK_COLUMNS = [
  { column: "prefill_tps", isBetter: (next: number, best: number): boolean => next > best },
  { column: "generation_tps", isBetter: (next: number, best: number): boolean => next > best },
  { column: "ttft_ms", isBetter: (next: number, best: number): boolean => next < best },
] as const;

export class PeakMetricsStore extends MetricsDatabase {
  public constructor(dbPath: string) {
    super(dbPath, "peak-metrics.close");
  }

  protected migrate(db: Database): void {
    db.run(`
      CREATE TABLE IF NOT EXISTS peak_metrics (
        model_id TEXT PRIMARY KEY,
        prefill_tps REAL,
        generation_tps REAL,
        ttft_ms REAL,
        total_tokens INTEGER DEFAULT 0,
        total_requests INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS peak_metric_sessions (
        session_id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        peak_prefill_tps REAL,
        peak_generation_tps REAL,
        best_ttft_ms REAL,
        started_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_peak_metric_sessions_model_updated ON peak_metric_sessions(model_id, updated_at)`,
    );
  }

  private get(modelId: string): Row | null {
    return this.queryRow("SELECT * FROM peak_metrics WHERE model_id = ?", modelId);
  }

  public getEffect(modelId: string): Effect.Effect<Row | null, RepositoryError> {
    return repositoryEffect("peak-metrics.get", () => this.get(modelId));
  }

  public updateIfBetterEffect(
    modelId: string,
    prefillTps?: number,
    generationTps?: number,
    ttftMs?: number,
  ): Effect.Effect<Row, RepositoryError> {
    return repositoryEffect("peak-metrics.update-if-better", () => {
      const current = this.get(modelId);
      const candidates: Record<string, number | undefined> = {
        prefill_tps: prefillTps,
        generation_tps: generationTps,
        ttft_ms: ttftMs,
      };
      const updates: Record<string, number> = {};
      for (const { column, isBetter } of PEAK_COLUMNS) {
        const candidate = candidates[column];
        if (candidate === undefined) continue;
        const best = current?.[column];
        if (!current || best === null || isBetter(Number(candidate), Number(best))) {
          updates[column] = candidate;
        }
      }

      if (Object.keys(updates).length > 0) {
        if (current) {
          const setClause = Object.keys(updates)
            .map((key) => `${key} = ?`)
            .join(", ");
          this.db
            .query(
              `UPDATE peak_metrics SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE model_id = ?`,
            )
            .run(...Object.values(updates), modelId);
        } else {
          this.db
            .query(
              `
            INSERT INTO peak_metrics (model_id, prefill_tps, generation_tps, ttft_ms)
            VALUES (?, ?, ?, ?)
          `,
            )
            .run(
              modelId,
              updates["prefill_tps"] ?? null,
              updates["generation_tps"] ?? null,
              updates["ttft_ms"] ?? null,
            );
        }
      }

      return this.get(modelId) ?? {};
    });
  }

  public addTokensEffect(
    modelId: string,
    tokens: number,
    requests = 1,
  ): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("peak-metrics.add-tokens", () => {
      this.db
        .query(
          `
        INSERT INTO peak_metrics (model_id, total_tokens, total_requests)
        VALUES (?, ?, ?)
        ON CONFLICT(model_id) DO UPDATE SET
          total_tokens = total_tokens + excluded.total_tokens,
          total_requests = total_requests + excluded.total_requests,
          updated_at = CURRENT_TIMESTAMP
      `,
        )
        .run(modelId, tokens, requests);
    });
  }

  public updateSessionPeakEffect(
    sessionId: string,
    modelId: string,
    prefillTps?: number,
    generationTps?: number,
    ttftMs?: number,
  ): Effect.Effect<Row, RepositoryError> {
    return repositoryEffect("peak-metric-sessions.update", () => {
      this.db
        .query(
          `
          INSERT INTO peak_metric_sessions (
            session_id,
            model_id,
            peak_prefill_tps,
            peak_generation_tps,
            best_ttft_ms
          )
          VALUES (?, ?, ?, ?, ?)
          -- Scalar MAX/MIN over mutually COALESCEd operands keeps the better of the two
          -- readings and leaves the column NULL only while both sides are still NULL.
          ON CONFLICT(session_id) DO UPDATE SET
            model_id = excluded.model_id,
            peak_prefill_tps = MAX(
              COALESCE(excluded.peak_prefill_tps, peak_metric_sessions.peak_prefill_tps),
              COALESCE(peak_metric_sessions.peak_prefill_tps, excluded.peak_prefill_tps)
            ),
            peak_generation_tps = MAX(
              COALESCE(excluded.peak_generation_tps, peak_metric_sessions.peak_generation_tps),
              COALESCE(peak_metric_sessions.peak_generation_tps, excluded.peak_generation_tps)
            ),
            best_ttft_ms = MIN(
              COALESCE(excluded.best_ttft_ms, peak_metric_sessions.best_ttft_ms),
              COALESCE(peak_metric_sessions.best_ttft_ms, excluded.best_ttft_ms)
            ),
            updated_at = CURRENT_TIMESTAMP
        `,
        )
        .run(sessionId, modelId, prefillTps ?? null, generationTps ?? null, ttftMs ?? null);

      return this.getSession(sessionId) ?? {};
    });
  }

  private getSession(sessionId: string): Row | null {
    return this.queryRow("SELECT * FROM peak_metric_sessions WHERE session_id = ?", sessionId);
  }

  public getSessionEffect(sessionId: string): Effect.Effect<Row | null, RepositoryError> {
    return repositoryEffect("peak-metric-sessions.get", () => this.getSession(sessionId));
  }

  private getBestSession(modelId: string): Row | null {
    return this.queryRow(
      `
        SELECT * FROM peak_metric_sessions
        WHERE model_id = ?
        ORDER BY
          COALESCE(peak_generation_tps, 0) DESC,
          COALESCE(peak_prefill_tps, 0) DESC,
          updated_at DESC
        LIMIT 1
      `,
      modelId,
    );
  }

  public getBestSessionEffect(modelId: string): Effect.Effect<Row | null, RepositoryError> {
    return repositoryEffect("peak-metric-sessions.get-best", () => this.getBestSession(modelId));
  }

  public getAllEffect(): Effect.Effect<Row[], RepositoryError> {
    return repositoryEffect("peak-metrics.get-all", () => {
      const rows = this.db.query("SELECT * FROM peak_metrics ORDER BY model_id").all() as Row[];
      return rows.map((row) => {
        const modelId = String(row["model_id"] ?? "");
        const bestSession = modelId ? this.getBestSession(modelId) : null;
        return {
          ...row,
          best_session_id: bestSession?.["session_id"] ?? null,
          best_session_prefill_tps: bestSession?.["peak_prefill_tps"] ?? null,
          best_session_generation_tps: bestSession?.["peak_generation_tps"] ?? null,
          best_session_ttft_ms: bestSession?.["best_ttft_ms"] ?? null,
        };
      });
    });
  }
}

const LIFETIME_METRIC_KEYS = [
  "tokens_total",
  "prompt_tokens_total",
  "completion_tokens_total",
  "energy_wh",
  "uptime_seconds",
  "requests_total",
  "first_started_at",
] as const;

export class LifetimeMetricsStore extends MetricsDatabase {
  public constructor(dbPath: string) {
    super(dbPath, "lifetime-metrics.close");
  }

  protected migrate(db: Database): void {
    db.run(`
      CREATE TABLE IF NOT EXISTS lifetime_metrics (
        key TEXT PRIMARY KEY,
        value REAL NOT NULL DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    for (const key of LIFETIME_METRIC_KEYS) {
      db.query("INSERT OR IGNORE INTO lifetime_metrics (key, value) VALUES (?, ?)").run(key, 0);
    }
  }

  private get(key: string): number {
    const row = this.queryRow("SELECT value FROM lifetime_metrics WHERE key = ?", key);
    return (row?.["value"] as number | undefined) ?? 0;
  }

  public getEffect(key: string): Effect.Effect<number, RepositoryError> {
    return repositoryEffect("lifetime-metrics.get", () => this.get(key));
  }

  public getAllEffect(): Effect.Effect<Record<string, number>, RepositoryError> {
    return repositoryEffect("lifetime-metrics.get-all", () => {
      const rows = this.db.query("SELECT key, value FROM lifetime_metrics").all() as Array<{
        key: string;
        value: number;
      }>;
      return Object.fromEntries(rows.map((row) => [row.key, row.value]));
    });
  }

  public incrementEffect(key: string, delta: number): Effect.Effect<number, RepositoryError> {
    return repositoryEffect("lifetime-metrics.increment", () => {
      this.db
        .query(
          `INSERT INTO lifetime_metrics (key, value, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = value + excluded.value, updated_at = CURRENT_TIMESTAMP`,
        )
        .run(key, delta);
      return this.get(key);
    });
  }

  public ensureFirstStartedEffect(): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("lifetime-metrics.ensure-first-started", () => {
      if (this.get("first_started_at") !== 0) return;
      this.db
        .query(
          `INSERT INTO lifetime_metrics (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        )
        .run("first_started_at", Date.now() / 1000);
    });
  }

  private add(key: string): (amount: number) => Effect.Effect<void, RepositoryError> {
    return (amount) => this.incrementEffect(key, amount).pipe(Effect.asVoid);
  }

  public readonly addEnergy = this.add("energy_wh");
  public readonly addTokens = this.add("tokens_total");
  public readonly addPromptTokens = this.add("prompt_tokens_total");
  public readonly addCompletionTokens = this.add("completion_tokens_total");
  public readonly addUptime = this.add("uptime_seconds");
  public readonly addRequests = (count = 1): Effect.Effect<void, RepositoryError> =>
    this.incrementEffect("requests_total", count).pipe(Effect.asVoid);
}
