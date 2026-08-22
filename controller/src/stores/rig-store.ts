import type { Rig } from "@local-studio/contracts/rigs";
import type { Effect } from "effect";
import { repositoryEffect, SqliteStore, type RepositoryError } from "./sqlite";

type RigRow = {
  data: string;
};

const parseRig = (row: RigRow | null): Rig | null => {
  if (!row) return null;
  try {
    return JSON.parse(row.data) as Rig;
  } catch {
    return null;
  }
};

export class RigStore extends SqliteStore {
  public constructor(dbPath: string) {
    super(dbPath, "rigs", (db) =>
      db.run(`
        CREATE TABLE IF NOT EXISTS rigs (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `),
    );
  }

  public listEffect(): Effect.Effect<Rig[], RepositoryError> {
    return repositoryEffect("rigs.list", () => {
      const rows = this.db.query("SELECT data FROM rigs ORDER BY created_at").all() as RigRow[];
      return rows.flatMap((row) => {
        const rig = parseRig(row);
        return rig ? [rig] : [];
      });
    });
  }

  public getEffect(rigId: string): Effect.Effect<Rig | null, RepositoryError> {
    return repositoryEffect("rigs.get", () =>
      parseRig(this.db.query("SELECT data FROM rigs WHERE id = ?").get(rigId) as RigRow | null),
    );
  }

  public saveEffect(rig: Rig): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("rigs.save", () => {
      this.db
        .query(
          `INSERT INTO rigs (id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP`,
        )
        .run(rig.id, JSON.stringify(rig));
    });
  }

  public deleteEffect(rigId: string): Effect.Effect<boolean, RepositoryError> {
    return repositoryEffect(
      "rigs.delete",
      () => this.db.query("DELETE FROM rigs WHERE id = ?").run(rigId).changes > 0,
    );
  }
}
