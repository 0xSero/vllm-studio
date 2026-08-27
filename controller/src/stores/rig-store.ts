import type { Database } from "bun:sqlite";
import type { Rig } from "@local-studio/contracts/rigs";
import type { Effect } from "effect";
import { Schema } from "effect";
import {
  makeDatabaseCloser,
  openInitializedDatabase,
  repositoryEffect,
  type RepositoryError,
} from "./sqlite";

type RigRow = {
  data: string;
};

const RigSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  nodes: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      hardware_type: Schema.Literals([
        "dgx-spark",
        "gpu-desktop",
        "gpu-server",
        "mac",
        "laptop",
        "mini-pc",
        "custom",
      ]),
      role: Schema.Literals(["head", "worker", "standalone"]),
      source: Schema.Literals(["detected", "manual"]),
      hostname: Schema.NullOr(Schema.String),
      address: Schema.NullOr(Schema.String),
      os: Schema.NullOr(Schema.String),
      cpu_model: Schema.NullOr(Schema.String),
      cpu_cores: Schema.NullOr(Schema.Number),
      memory_gb: Schema.NullOr(Schema.Number),
      accelerators: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          count: Schema.Number,
          memory_gb: Schema.NullOr(Schema.Number),
          memory_type: Schema.NullOr(Schema.String),
          memory_bandwidth_gbs: Schema.NullOr(Schema.Number),
          unified_memory: Schema.Boolean,
        }),
      ),
      notes: Schema.NullOr(Schema.String),
    }),
  ),
  created_at: Schema.String,
  updated_at: Schema.String,
});

const parseRig = (data: string): Rig => {
  const parsed = Schema.decodeUnknownSync(Schema.fromJsonString(RigSchema))(data);
  return {
    ...parsed,
    nodes: parsed.nodes.map((node) => ({
      ...node,
      accelerators: node.accelerators.map((accelerator) => ({ ...accelerator })),
    })),
  };
};

export class RigStore {
  private readonly db: Database;
  private readonly closeDatabase: () => Effect.Effect<void, RepositoryError>;

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
  }

  public list(): Rig[] {
    const rows = this.db.query<RigRow, []>("SELECT data FROM rigs ORDER BY created_at").all();
    const rigs: Rig[] = [];
    for (const row of rows) {
      try {
        rigs.push(parseRig(row.data));
      } catch {
        continue;
      }
    }
    return rigs;
  }

  public listEffect(): Effect.Effect<Rig[], RepositoryError> {
    return repositoryEffect("rigs.list", () => this.list());
  }

  public get(rigId: string): Rig | null {
    const row = this.db
      .query<RigRow, [string]>("SELECT data FROM rigs WHERE id = ?")
      .get(rigId);
    if (!row) return null;
    try {
      return parseRig(row.data);
    } catch {
      return null;
    }
  }

  public getEffect(rigId: string): Effect.Effect<Rig | null, RepositoryError> {
    return repositoryEffect("rigs.get", () => this.get(rigId));
  }

  public save(rig: Rig): void {
    this.db
      .query(
        `INSERT INTO rigs (id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP`,
      )
      .run(rig.id, JSON.stringify(rig));
  }

  public saveEffect(rig: Rig): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("rigs.save", () => this.save(rig));
  }

  public delete(rigId: string): boolean {
    const result = this.db.query("DELETE FROM rigs WHERE id = ?").run(rigId);
    return result.changes > 0;
  }

  public deleteEffect(rigId: string): Effect.Effect<boolean, RepositoryError> {
    return repositoryEffect("rigs.delete", () => this.delete(rigId));
  }

  public close(): Effect.Effect<void, RepositoryError> {
    return this.closeDatabase();
  }
}
