import { parseEnvironment } from "./environment-serializer";
import type { Environment } from "./types";
import { openSqliteDatabase } from "../../stores/sqlite";

/** Persists environment definitions (recipe + pinned engine version + image). */
export class EnvironmentStore {
  private readonly db: ReturnType<typeof openSqliteDatabase>;

  public constructor(dbPath: string) {
    this.db = openSqliteDatabase(dbPath);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS environments (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  public list(): Environment[] {
    const rows = this.db.query("SELECT data FROM environments ORDER BY id").all() as Array<{
      data: string;
    }>;
    const environments: Environment[] = [];
    for (const row of rows) {
      try {
        environments.push(parseEnvironment(JSON.parse(row.data)));
      } catch {
        continue;
      }
    }
    return environments;
  }

  public get(environmentId: string): Environment | null {
    const row = this.db.query("SELECT data FROM environments WHERE id = ?").get(environmentId) as {
      data: string;
    } | null;
    if (!row) return null;
    try {
      return parseEnvironment(JSON.parse(row.data));
    } catch {
      return null;
    }
  }

  public save(environment: Environment): void {
    const normalized: Environment = { ...environment, updatedAt: new Date().toISOString() };
    const data = JSON.stringify(normalized);
    this.db
      .query(
        `
      INSERT INTO environments (id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP
    `,
      )
      .run(environment.id, data);
  }

  public delete(environmentId: string): boolean {
    const result = this.db.query("DELETE FROM environments WHERE id = ?").run(environmentId);
    return result.changes > 0;
  }
}
