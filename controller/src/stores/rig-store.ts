import type { Database } from "bun:sqlite";
import type { Rig } from "@local-studio/contracts/rigs";
import { openSqliteDatabase } from "./sqlite";

type RigRow = {
  data: string;
};

export class RigStore {
  private readonly db: Database;

  public constructor(dbPath: string) {
    this.db = openSqliteDatabase(dbPath);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS rigs (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  public list(): Rig[] {
    const rows = this.db.query("SELECT data FROM rigs ORDER BY created_at").all() as RigRow[];
    const rigs: Rig[] = [];
    for (const row of rows) {
      try {
        rigs.push(JSON.parse(row.data) as Rig);
      } catch {
        continue;
      }
    }
    return rigs;
  }

  public get(rigId: string): Rig | null {
    const row = this.db.query("SELECT data FROM rigs WHERE id = ?").get(rigId) as RigRow | null;
    if (!row) return null;
    try {
      return JSON.parse(row.data) as Rig;
    } catch {
      return null;
    }
  }

  public save(rig: Rig): void {
    this.db
      .query(
        `INSERT INTO rigs (id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP`,
      )
      .run(rig.id, JSON.stringify(rig));
  }

  public delete(rigId: string): boolean {
    const result = this.db.query("DELETE FROM rigs WHERE id = ?").run(rigId);
    return result.changes > 0;
  }
}
