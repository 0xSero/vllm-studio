import type { Database } from "bun:sqlite";
import { openSqliteDatabase } from "./sqlite";

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

type NumberRow = Record<string, number | string | null>;

const toFiniteNumber = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export class ControllerRequestStore {
  private readonly db: Database;

  public constructor(dbPath: string) {
    this.db = openSqliteDatabase(dbPath);
    this.migrate();
  }

  private migrate(): void {
    this.db.run(`
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
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_controller_requests_created_at ON controller_requests(created_at)`
    );
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_controller_requests_path_created ON controller_requests(path, created_at)`
    );
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_controller_requests_status_created ON controller_requests(status, created_at)`
    );
  }

  public record(record: ControllerRequestRecord): void {
    const durationMs = Math.max(0, Math.round(record.duration_ms));
    this.db
      .query(
        `INSERT INTO controller_requests (
           method, path, status, duration_ms, success, error_class, error_message, user_agent
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.method.toUpperCase(),
        record.path,
        Math.round(record.status),
        durationMs,
        record.success ? 1 : 0,
        record.error_class ?? null,
        record.error_message ?? null,
        record.user_agent ?? null
      );
  }

  public aggregate(): Record<string, unknown> {
    const totals = this.db
      .query<NumberRow, []>(
        `SELECT
           COUNT(*) as total_requests,
           COALESCE(SUM(success), 0) as successful_requests,
           COALESCE(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END), 0) as failed_requests,
           AVG(duration_ms) as avg_duration_ms,
           MAX(duration_ms) as max_duration_ms
         FROM controller_requests`
      )
      .get() as NumberRow | null;

    const totalRequests = toFiniteNumber(totals?.["total_requests"]);
    const successfulRequests = toFiniteNumber(totals?.["successful_requests"]);
    const failedRequests = toFiniteNumber(totals?.["failed_requests"]);

    const byPath = this.db
      .query<NumberRow, []>(
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
         LIMIT 50`
      )
      .all() as NumberRow[];

    const byStatus = this.db
      .query<NumberRow, []>(
        `SELECT
           status,
           COUNT(*) as requests
         FROM controller_requests
         GROUP BY status
         ORDER BY requests DESC, status ASC`
      )
      .all() as NumberRow[];

    const errors = this.db
      .query<NumberRow, []>(
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
         LIMIT 25`
      )
      .all() as NumberRow[];

    const recent = this.db
      .query<NumberRow, []>(
        `SELECT
           SUM(CASE WHEN datetime(created_at) >= datetime('now', '-1 hour') THEN 1 ELSE 0 END) as last_hour,
           SUM(CASE WHEN datetime(created_at) >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) as last_24h,
           SUM(CASE WHEN datetime(created_at) >= datetime('now', '-24 hours') AND success = 0 THEN 1 ELSE 0 END) as last_24h_failed
         FROM controller_requests`
      )
      .get() as NumberRow | null;

    return {
      totals: {
        total_requests: totalRequests,
        successful_requests: successfulRequests,
        failed_requests: failedRequests,
        success_rate: totalRequests ? (successfulRequests / totalRequests) * 100 : 0,
      },
      latency: {
        avg_ms: toNullableNumber(totals?.["avg_duration_ms"]),
        max_ms: toNullableNumber(totals?.["max_duration_ms"]),
      },
      recent_activity: {
        last_hour_requests: toFiniteNumber(recent?.["last_hour"]),
        last_24h_requests: toFiniteNumber(recent?.["last_24h"]),
        last_24h_failed_requests: toFiniteNumber(recent?.["last_24h_failed"]),
      },
      by_path: byPath.map((row) => {
        const requests = toFiniteNumber(row["requests"]);
        const successful = toFiniteNumber(row["successful"]);
        return {
          method: String(row["method"] ?? ""),
          path: String(row["path"] ?? ""),
          requests,
          successful,
          failed: toFiniteNumber(row["failed"]),
          success_rate: requests ? (successful / requests) * 100 : 0,
          avg_duration_ms: toNullableNumber(row["avg_duration_ms"]),
          max_duration_ms: toNullableNumber(row["max_duration_ms"]),
        };
      }),
      by_status: byStatus.map((row) => ({
        status: toFiniteNumber(row["status"]),
        requests: toFiniteNumber(row["requests"]),
      })),
      recent_errors: errors.map((row) => ({
        method: String(row["method"] ?? ""),
        path: String(row["path"] ?? ""),
        status: toFiniteNumber(row["status"]),
        error_class: row["error_class"] ? String(row["error_class"]) : null,
        error_message: row["error_message"] ? String(row["error_message"]) : null,
        created_at: String(row["created_at"] ?? ""),
      })),
    };
  }
}
