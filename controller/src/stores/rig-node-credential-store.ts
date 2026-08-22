import type { Database } from "bun:sqlite";
import type { Effect } from "effect";
import {
  makeDatabaseCloser,
  openInitializedDatabase,
  repositoryEffect,
  type RepositoryError,
} from "./sqlite";

type CredentialRow = { api_key: string };

export class RigNodeCredentialStore {
  private readonly db: Database;
  private readonly closeDatabase: () => Effect.Effect<void, RepositoryError>;

  public constructor(dbPath: string) {
    this.db = openInitializedDatabase(dbPath, (db) =>
      db.run(`
        CREATE TABLE IF NOT EXISTS rig_node_credentials (
          node_id TEXT PRIMARY KEY,
          api_key TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `),
    );
    this.closeDatabase = makeDatabaseCloser(this.db, "rig-node-credentials.close");
  }

  public get(nodeId: string): string {
    const row = this.db
      .query("SELECT api_key FROM rig_node_credentials WHERE node_id = ?")
      .get(nodeId) as CredentialRow | null;
    return row?.api_key ?? "";
  }

  public save(nodeId: string, apiKey: string): void {
    const normalized = apiKey.trim();
    if (!normalized) return;
    this.db
      .query(
        `INSERT INTO rig_node_credentials (node_id, api_key, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(node_id) DO UPDATE SET
           api_key = excluded.api_key,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(nodeId, normalized);
  }

  public delete(nodeId: string): void {
    this.db.query("DELETE FROM rig_node_credentials WHERE node_id = ?").run(nodeId);
  }

  public close(): Effect.Effect<void, RepositoryError> {
    return this.closeDatabase();
  }

  public saveEffect(nodeId: string, apiKey: string): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("rig-node-credentials.save", () => this.save(nodeId, apiKey));
  }

  public deleteEffect(nodeId: string): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("rig-node-credentials.delete", () => this.delete(nodeId));
  }
}
