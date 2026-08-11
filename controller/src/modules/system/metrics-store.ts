import type { Database } from "bun:sqlite";
import { Effect } from "effect";
import {
  makeDatabaseCloser,
  openInitializedDatabase,
  repositoryEffect,
  type RepositoryError,
} from "../../stores/sqlite";

const PEAK_FIELDS = [
  ["prefill_tps", "peak_prefill_tps", ">"],
  ["generation_tps", "peak_generation_tps", ">"],
  ["ttft_ms", "best_ttft_ms", "<"],
] as const;

const peakAssignment = (
  table: string,
  column: string,
  operator: string,
): string => `${column} = CASE
    WHEN excluded.${column} IS NULL THEN ${table}.${column}
    WHEN ${table}.${column} IS NULL THEN excluded.${column}
    WHEN excluded.${column} ${operator} ${table}.${column}
      THEN excluded.${column}
    ELSE ${table}.${column}
  END`;

const peakUpdates = PEAK_FIELDS.map(([column, , operator]) =>
  peakAssignment("peak_metrics", column, operator),
).join(",\n");
const peakImproved = PEAK_FIELDS.map(
  ([column, , operator]) =>
    `(excluded.${column} IS NOT NULL AND (peak_metrics.${column} IS NULL OR excluded.${column} ${operator} peak_metrics.${column}))`,
).join(" OR ");
const sessionPeakUpdates = PEAK_FIELDS.map(([, column, operator]) =>
  peakAssignment("peak_metric_sessions", column, operator),
).join(",\n");

const recordRow = (db: Database, query: string, value: string): Record<string, unknown> | null => {
  const row = db.query(query).get(value) as Record<string, unknown> | null;
  return row ? { ...row } : null;
};

export class PeakMetricsStore {
  private readonly db: Database;
  private readonly closeDatabase: () => Effect.Effect<void, RepositoryError>;

  public constructor(dbPath: string) {
    this.db = openInitializedDatabase(dbPath, (db) => this.migrate(db));
    this.closeDatabase = makeDatabaseCloser(this.db, "peak-metrics.close");
  }

  private migrate(db: Database): void {
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

  public get(modelId: string): Record<string, unknown> | null {
    return recordRow(this.db, "SELECT * FROM peak_metrics WHERE model_id = ?", modelId);
  }

  public getEffect(
    modelId: string,
  ): Effect.Effect<Record<string, unknown> | null, RepositoryError> {
    return repositoryEffect("peak-metrics.get", () => this.get(modelId));
  }

  public updateIfBetter(
    modelId: string,
    prefillTps?: number,
    generationTps?: number,
    ttftMs?: number,
  ): Record<string, unknown> {
    if ([prefillTps, generationTps, ttftMs].every((value) => value === undefined)) return {};
    this.db
      .query(
        `INSERT INTO peak_metrics (model_id, prefill_tps, generation_tps, ttft_ms)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(model_id) DO UPDATE SET
           ${peakUpdates},
           updated_at = CURRENT_TIMESTAMP
         WHERE ${peakImproved}`,
      )
      .run(modelId, prefillTps ?? null, generationTps ?? null, ttftMs ?? null);
    return this.get(modelId) ?? {};
  }

  public updateIfBetterEffect(
    modelId: string,
    prefillTps?: number,
    generationTps?: number,
    ttftMs?: number,
  ): Effect.Effect<Record<string, unknown>, RepositoryError> {
    return repositoryEffect("peak-metrics.update-if-better", () =>
      this.updateIfBetter(modelId, prefillTps, generationTps, ttftMs),
    );
  }

  public addTokens(modelId: string, tokens: number, requests = 1): void {
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
  }

  public addTokensEffect(
    modelId: string,
    tokens: number,
    requests = 1,
  ): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("peak-metrics.add-tokens", () =>
      this.addTokens(modelId, tokens, requests),
    );
  }

  public updateSessionPeak(
    sessionId: string,
    modelId: string,
    prefillTps?: number,
    generationTps?: number,
    ttftMs?: number,
  ): Record<string, unknown> {
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
        ON CONFLICT(session_id) DO UPDATE SET
          model_id = excluded.model_id,
          ${sessionPeakUpdates},
          updated_at = CURRENT_TIMESTAMP
      `,
      )
      .run(sessionId, modelId, prefillTps ?? null, generationTps ?? null, ttftMs ?? null);

    return this.getSession(sessionId) ?? {};
  }

  public updateSessionPeakEffect(
    sessionId: string,
    modelId: string,
    prefillTps?: number,
    generationTps?: number,
    ttftMs?: number,
  ): Effect.Effect<Record<string, unknown>, RepositoryError> {
    return repositoryEffect("peak-metric-sessions.update", () =>
      this.updateSessionPeak(sessionId, modelId, prefillTps, generationTps, ttftMs),
    );
  }

  public getSession(sessionId: string): Record<string, unknown> | null {
    return recordRow(this.db, "SELECT * FROM peak_metric_sessions WHERE session_id = ?", sessionId);
  }

  public getSessionEffect(
    sessionId: string,
  ): Effect.Effect<Record<string, unknown> | null, RepositoryError> {
    return repositoryEffect("peak-metric-sessions.get", () => this.getSession(sessionId));
  }

  public getBestSession(modelId: string): Record<string, unknown> | null {
    return recordRow(
      this.db,
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

  public getBestSessionEffect(
    modelId: string,
  ): Effect.Effect<Record<string, unknown> | null, RepositoryError> {
    return repositoryEffect("peak-metric-sessions.get-best", () => this.getBestSession(modelId));
  }

  public getAll(): Array<Record<string, unknown>> {
    const rows = this.db.query("SELECT * FROM peak_metrics ORDER BY model_id").all() as Array<
      Record<string, unknown>
    >;
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
  }

  public getAllEffect(): Effect.Effect<Array<Record<string, unknown>>, RepositoryError> {
    return repositoryEffect("peak-metrics.get-all", () => this.getAll());
  }

  public close(): Effect.Effect<void, RepositoryError> {
    return this.closeDatabase();
  }
}

export class LifetimeMetricsStore {
  private readonly db: Database;
  private readonly closeDatabase: () => Effect.Effect<void, RepositoryError>;

  public constructor(dbPath: string) {
    this.db = openInitializedDatabase(dbPath, (db) => this.migrate(db));
    this.closeDatabase = makeDatabaseCloser(this.db, "lifetime-metrics.close");
  }

  private migrate(db: Database): void {
    db.run(`
      CREATE TABLE IF NOT EXISTS lifetime_metrics (
        key TEXT PRIMARY KEY,
        value REAL NOT NULL DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const defaults: Array<[string, number]> = [
      ["tokens_total", 0],
      ["prompt_tokens_total", 0],
      ["completion_tokens_total", 0],
      ["energy_wh", 0],
      ["uptime_seconds", 0],
      ["requests_total", 0],
      ["first_started_at", 0],
    ];
    for (const [key, value] of defaults) {
      db.query("INSERT OR IGNORE INTO lifetime_metrics (key, value) VALUES (?, ?)").run(key, value);
    }
  }

  public get(key: string): number {
    const row = this.db.query("SELECT value FROM lifetime_metrics WHERE key = ?").get(key) as {
      value?: number;
    } | null;
    return row?.value ?? 0;
  }

  public getEffect(key: string): Effect.Effect<number, RepositoryError> {
    return repositoryEffect("lifetime-metrics.get", () => this.get(key));
  }

  public getAll(): Record<string, number> {
    const rows = this.db.query("SELECT key, value FROM lifetime_metrics").all() as Array<{
      key: string;
      value: number;
    }>;
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  public getAllEffect(): Effect.Effect<Record<string, number>, RepositoryError> {
    return repositoryEffect("lifetime-metrics.get-all", () => this.getAll());
  }

  public set(key: string, value: number): void {
    this.db
      .query(
        `INSERT INTO lifetime_metrics (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      )
      .run(key, value);
  }

  public setEffect(key: string, value: number): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("lifetime-metrics.set", () => this.set(key, value));
  }

  public increment(key: string, delta: number): number {
    this.db
      .query(
        `INSERT INTO lifetime_metrics (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = value + excluded.value, updated_at = CURRENT_TIMESTAMP`,
      )
      .run(key, delta);
    return this.get(key);
  }

  public incrementEffect(key: string, delta: number): Effect.Effect<number, RepositoryError> {
    return repositoryEffect("lifetime-metrics.increment", () => this.increment(key, delta));
  }

  public ensureFirstStarted(): void {
    const current = this.get("first_started_at");
    if (current === 0) {
      this.set("first_started_at", Date.now() / 1000);
    }
  }

  public ensureFirstStartedEffect(): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("lifetime-metrics.ensure-first-started", () =>
      this.ensureFirstStarted(),
    );
  }

  public addEnergy(wattHours: number): Effect.Effect<void, RepositoryError> {
    return this.incrementEffect("energy_wh", wattHours).pipe(Effect.asVoid);
  }

  public addTokens(tokens: number): Effect.Effect<void, RepositoryError> {
    return this.incrementEffect("tokens_total", tokens).pipe(Effect.asVoid);
  }

  public addPromptTokens(tokens: number): Effect.Effect<void, RepositoryError> {
    return this.incrementEffect("prompt_tokens_total", tokens).pipe(Effect.asVoid);
  }

  public addCompletionTokens(tokens: number): Effect.Effect<void, RepositoryError> {
    return this.incrementEffect("completion_tokens_total", tokens).pipe(Effect.asVoid);
  }

  public addUptime(seconds: number): Effect.Effect<void, RepositoryError> {
    return this.incrementEffect("uptime_seconds", seconds).pipe(Effect.asVoid);
  }

  public addRequests(count = 1): Effect.Effect<void, RepositoryError> {
    return this.incrementEffect("requests_total", count).pipe(Effect.asVoid);
  }

  public close(): Effect.Effect<void, RepositoryError> {
    return this.closeDatabase();
  }
}
