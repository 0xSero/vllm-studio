import type { Database } from "bun:sqlite";
import type { SessionMetadata } from "@local-studio/contracts/federation";
import type { Effect } from "effect";
import {
  makeDatabaseCloser,
  openInitializedDatabase,
  repositoryEffect,
  type RepositoryError,
} from "./sqlite";

type SessionMetadataRow = { data: string };

export class SessionMetadataStore {
  private readonly db: Database;
  private readonly closeDatabase: () => Effect.Effect<void, RepositoryError>;

  public constructor(dbPath: string) {
    this.db = openInitializedDatabase(dbPath, (db) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS federated_session_metadata (
          desktop_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          data TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (desktop_id, session_id)
        )
      `);
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_federated_sessions_updated ON federated_session_metadata(updated_at DESC)",
      );
    });
    this.closeDatabase = makeDatabaseCloser(this.db, "session-metadata.close");
  }

  public list(): SessionMetadata[] {
    const rows = this.db
      .query("SELECT data FROM federated_session_metadata ORDER BY updated_at DESC")
      .all() as SessionMetadataRow[];
    const sessions: SessionMetadata[] = [];
    for (const row of rows) {
      try {
        sessions.push(JSON.parse(row.data) as SessionMetadata);
      } catch {}
    }
    return sessions;
  }

  public save(metadata: SessionMetadata): void {
    this.db
      .query(
        `INSERT INTO federated_session_metadata (desktop_id, session_id, data, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(desktop_id, session_id) DO UPDATE SET
           data = excluded.data,
           updated_at = excluded.updated_at`,
      )
      .run(metadata.desktop_id, metadata.session_id, JSON.stringify(metadata), metadata.updated_at);
  }

  public listEffect(): Effect.Effect<SessionMetadata[], RepositoryError> {
    return repositoryEffect("session-metadata.list", () => this.list());
  }

  public saveEffect(metadata: SessionMetadata): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("session-metadata.save", () => this.save(metadata));
  }

  public close(): Effect.Effect<void, RepositoryError> {
    return this.closeDatabase();
  }
}
