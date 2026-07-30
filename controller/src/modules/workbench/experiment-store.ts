import type { Database } from "bun:sqlite";
import type { Effect } from "effect";
import type { ExperimentRecord } from "@local-studio/contracts/experiment-tracking";
import {
  makeDatabaseCloser,
  openInitializedDatabase,
  repositoryEffect,
  type RepositoryError,
} from "../../stores/sqlite";

type DataRow = { data: string };

const decodeRow = <A>(row: DataRow | null): A | null => {
  if (!row) return null;
  try {
    return JSON.parse(row.data) as A;
  } catch {
    return null;
  }
};

export class ExperimentTrackingStore {
  private readonly db: Database;
  private readonly closeDatabase: () => Effect.Effect<void, RepositoryError>;

  public constructor(dbPath: string) {
    this.db = openInitializedDatabase(dbPath, (db) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS experiments (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      db.run("CREATE INDEX IF NOT EXISTS idx_experiments_project ON experiments(project_id)");
    });
    this.closeDatabase = makeDatabaseCloser(this.db, "experiment-tracking-store.close");
  }

  public close(): Effect.Effect<void, RepositoryError> {
    return this.closeDatabase();
  }

  public listExperiments(
    projectId?: string,
  ): Effect.Effect<ExperimentRecord[], RepositoryError> {
    return repositoryEffect("experiments.list", () => {
      const rows = projectId
        ? (this.db
            .query("SELECT data FROM experiments WHERE project_id = ? ORDER BY created_at DESC")
            .all(projectId) as DataRow[])
        : (this.db
            .query("SELECT data FROM experiments ORDER BY created_at DESC")
            .all() as DataRow[]);
      return rows.flatMap((row) => {
        const value = decodeRow<ExperimentRecord>(row);
        return value ? [value] : [];
      });
    });
  }

  public getExperiment(
    experimentId: string,
  ): Effect.Effect<ExperimentRecord | null, RepositoryError> {
    return repositoryEffect("experiments.get", () =>
      decodeRow<ExperimentRecord>(
        this.db.query("SELECT data FROM experiments WHERE id = ?").get(experimentId) as
          | DataRow
          | null,
      ),
    );
  }

  public saveExperiment(
    experiment: ExperimentRecord,
  ): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("experiments.save", () => {
      this.db
        .query(
          `INSERT INTO experiments (id, project_id, data, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, data = excluded.data`,
        )
        .run(
          experiment.id,
          experiment.project_id,
          JSON.stringify(experiment),
          experiment.created_at,
        );
    });
  }

  public deleteExperiment(experimentId: string): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("experiments.delete", () => {
      this.db.query("DELETE FROM experiments WHERE id = ?").run(experimentId);
    });
  }

  public listExperimentLineage(
    experimentId: string,
  ): Effect.Effect<ExperimentRecord[], RepositoryError> {
    return repositoryEffect("experiments.lineage", () => {
      const visited = new Set<string>();
      const lineage: ExperimentRecord[] = [];
      let currentId: string | undefined = experimentId;
      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const row = this.db
          .query("SELECT data FROM experiments WHERE id = ?")
          .get(currentId) as DataRow | null;
        const record = decodeRow<ExperimentRecord>(row);
        if (!record) break;
        lineage.unshift(record);
        currentId = record.parent_experiment_id;
      }
      return lineage;
    });
  }
}
