import type { Database, SQLQueryBindings } from "bun:sqlite";
import {
  normalizeControllerUsage,
  usageRate,
  type ControllerUsageStats,
} from "@local-studio/contracts/usage";
import type { Effect } from "effect";
import { repositoryEffect, SqliteStore, type RepositoryError } from "./sqlite";

export interface ControllerRequestRecord {
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  success: boolean;
  error_class?: string | null;
  error_message?: string | null;
  user_agent?: string | null;
}

export interface ControllerFunctionCallRecord {
  function_name: string;
  duration_ms: number;
  success: boolean;
  error_class?: string | null;
  error_message?: string | null;
}

type NumberRow = Record<string, number | string | null>;

const RETENTION_DAYS = 14;
const PRUNE_EVERY_N_RECORDS = 1000;
const TABLES = ["controller_requests", "controller_function_calls"] as const;

const prune = (db: Database): void => {
  for (const table of TABLES) {
    db.run(`DELETE FROM ${table} WHERE created_at < datetime('now', '-${RETENTION_DAYS} days')`);
  }
};

const migrate = (db: Database): void => {
  db.run(`
      CREATE TABLE IF NOT EXISTS controller_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        status INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        success INTEGER NOT NULL,
        error_class TEXT,
        error_message TEXT,
        user_agent TEXT
      )
    `);
  db.run(`
      CREATE TABLE IF NOT EXISTS controller_function_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        function_name TEXT NOT NULL,
        duration_ms INTEGER NOT NULL,
        success INTEGER NOT NULL,
        error_class TEXT,
        error_message TEXT
      )
    `);
  for (const index of [
    "idx_controller_requests_created_at ON controller_requests(created_at)",
    "idx_controller_requests_path_created ON controller_requests(path, created_at)",
    "idx_controller_requests_status_created ON controller_requests(status, created_at)",
    "idx_controller_function_calls_created_at ON controller_function_calls(created_at)",
    "idx_controller_function_calls_name_created ON controller_function_calls(function_name, created_at)",
  ]) {
    db.run(`CREATE INDEX IF NOT EXISTS ${index}`);
  }
};

const initialize = (db: Database): void => {
  migrate(db);
  prune(db);
};

export class ControllerRequestStore extends SqliteStore {
  private recordsSincePrune = 0;

  public constructor(dbPath: string) {
    super(dbPath, "controller-requests", initialize);
  }

  private insert(
    operation: string,
    sql: string,
    values: SQLQueryBindings[],
  ): Effect.Effect<void, RepositoryError> {
    return repositoryEffect(operation, () => {
      this.db.query(sql).run(...values);
      this.recordsSincePrune += 1;
      if (this.recordsSincePrune < PRUNE_EVERY_N_RECORDS) return;
      this.recordsSincePrune = 0;
      prune(this.db);
    });
  }

  public recordEffect(record: ControllerRequestRecord): Effect.Effect<void, RepositoryError> {
    return this.insert(
      "controller-requests.record",
      `INSERT INTO controller_requests (
             method, path, status, duration_ms, success, error_class, error_message, user_agent
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.method.toUpperCase(),
        record.path,
        Math.round(record.status),
        Math.max(0, Math.round(record.duration_ms)),
        record.success ? 1 : 0,
        record.error_class ?? null,
        record.error_message ?? null,
        record.user_agent ?? null,
      ],
    );
  }

  public recordFunctionCallEffect(
    record: ControllerFunctionCallRecord,
  ): Effect.Effect<void, RepositoryError> {
    return this.insert(
      "controller-function-calls.record",
      `INSERT INTO controller_function_calls (
             function_name, duration_ms, success, error_class, error_message
           ) VALUES (?, ?, ?, ?, ?)`,
      [
        record.function_name,
        Math.max(0, Math.round(record.duration_ms)),
        record.success ? 1 : 0,
        record.error_class ?? null,
        record.error_message ?? null,
      ],
    );
  }

  public aggregateEffect(): Effect.Effect<ControllerUsageStats, RepositoryError> {
    return repositoryEffect("controller-requests.aggregate", () => {
      const one = (sql: string): NumberRow | null =>
        this.db.query<NumberRow, []>(sql).get() as NumberRow | null;
      const all = (sql: string): NumberRow[] => this.db.query<NumberRow, []>(sql).all();

      const totals = one(
        `SELECT
             COUNT(*) as total_requests,
             COALESCE(SUM(success), 0) as successful_requests,
             COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) as failed_requests,
             AVG(duration_ms) as avg_duration_ms,
             MAX(duration_ms) as max_duration_ms
           FROM controller_requests`,
      );

      const byPath = all(
        `SELECT
             method,
             path,
             COUNT(*) as requests,
             COALESCE(SUM(success), 0) as successful,
             COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) as failed,
             AVG(duration_ms) as avg_duration_ms,
             MAX(duration_ms) as max_duration_ms
           FROM controller_requests
           GROUP BY method, path
           ORDER BY requests DESC, path ASC
           LIMIT 50`,
      );

      const byStatus = all(
        `SELECT
             status,
             COUNT(*) as requests
           FROM controller_requests
           GROUP BY status
           ORDER BY requests DESC, status ASC`,
      );

      const errors = all(
        `SELECT
             method,
             path,
             status,
             error_class,
             error_message,
             created_at
           FROM controller_requests
           WHERE success = 0
           ORDER BY created_at DESC
           LIMIT 25`,
      );

      const recent = one(
        `SELECT
             SUM(CASE WHEN datetime(created_at) >= datetime('now', '-1 hour') THEN 1 ELSE 0 END) as last_hour,
             SUM(CASE WHEN datetime(created_at) >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) as last_24h,
             SUM(CASE WHEN datetime(created_at) >= datetime('now', '-24 hours') AND success = 0 THEN 1 ELSE 0 END) as last_24h_failed
           FROM controller_requests`,
      );

      const functionTotals = one(
        `SELECT
             COUNT(*) as total_calls,
             COALESCE(SUM(success), 0) as successful_calls,
             COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) as failed_calls,
             AVG(duration_ms) as avg_duration_ms,
             MAX(duration_ms) as max_duration_ms
           FROM controller_function_calls`,
      );

      const byFunction = all(
        `SELECT
             function_name,
             COUNT(*) as calls,
             COALESCE(SUM(success), 0) as successful,
             COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) as failed,
             AVG(duration_ms) as avg_duration_ms,
             MAX(duration_ms) as max_duration_ms
           FROM controller_function_calls
           GROUP BY function_name
           ORDER BY calls DESC, function_name ASC
           LIMIT 50`,
      );

      const functionErrors = all(
        `SELECT
             function_name,
             error_class,
             error_message,
             created_at
           FROM controller_function_calls
           WHERE success = 0
           ORDER BY created_at DESC
           LIMIT 25`,
      );

      return normalizeControllerUsage({
        totals: {
          ...totals,
          success_rate: usageRate(totals?.["successful_requests"], totals?.["total_requests"]),
        },
        latency: {
          avg_ms: totals?.["avg_duration_ms"],
          max_ms: totals?.["max_duration_ms"],
        },
        recent_activity: {
          last_hour_requests: recent?.["last_hour"],
          last_24h_requests: recent?.["last_24h"],
          last_24h_failed_requests: recent?.["last_24h_failed"],
        },
        by_path: byPath.map((row) => ({
          ...row,
          success_rate: usageRate(row["successful"], row["requests"]),
        })),
        by_status: byStatus,
        recent_errors: errors,
        function_calls: {
          totals: {
            ...functionTotals,
            success_rate: usageRate(
              functionTotals?.["successful_calls"],
              functionTotals?.["total_calls"],
            ),
          },
          latency: {
            avg_ms: functionTotals?.["avg_duration_ms"],
            max_ms: functionTotals?.["max_duration_ms"],
          },
          by_function: byFunction.map((row) => ({
            ...row,
            success_rate: usageRate(row["successful"], row["calls"]),
          })),
          recent_errors: functionErrors,
        },
      }) as ControllerUsageStats;
    });
  }
}
