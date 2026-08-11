import type { Database } from "bun:sqlite";
import type { Rig } from "@local-studio/contracts/rigs";
import type { Effect } from "effect";
import {
  makeDatabaseCloser,
  JsonBlobTable,
  openInitializedDatabase,
  repositoryEffect,
  type RepositoryError,
} from "./sqlite";

export class RigStore {
  private readonly db: Database;
  private readonly closeDatabase: () => Effect.Effect<void, RepositoryError>;
  private readonly records: JsonBlobTable<Rig>;

  public constructor(dbPath: string) {
    this.db = openInitializedDatabase(dbPath, (db) =>
      db.run(`
        CREATE TABLE IF NOT EXISTS rigs (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `),
    );
    this.closeDatabase = makeDatabaseCloser(this.db, "rigs.close");
    this.records = new JsonBlobTable(this.db, {
      table: "rigs",
      orderBy: "created_at",
      idOf: (rig): string => rig.id,
      decode: (value): Rig => JSON.parse(value) as Rig,
    });
  }

  public list(): Rig[] {
    return this.records.list();
  }

  public listEffect(): Effect.Effect<Rig[], RepositoryError> {
    return repositoryEffect("rigs.list", () => this.list());
  }

  public get(rigId: string): Rig | null {
    return this.records.get(rigId);
  }

  public getEffect(rigId: string): Effect.Effect<Rig | null, RepositoryError> {
    return repositoryEffect("rigs.get", () => this.get(rigId));
  }

  public save(rig: Rig): void {
    this.records.save(rig);
  }

  public saveEffect(rig: Rig): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("rigs.save", () => this.save(rig));
  }

  public delete(rigId: string): boolean {
    return this.records.delete(rigId);
  }

  public deleteEffect(rigId: string): Effect.Effect<boolean, RepositoryError> {
    return repositoryEffect("rigs.delete", () => this.delete(rigId));
  }

  public close(): Effect.Effect<void, RepositoryError> {
    return this.closeDatabase();
  }
}
