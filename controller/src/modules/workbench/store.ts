import type { Database } from "bun:sqlite";
import type {
  ScientificExperimentReceipt,
  ScientificComputeLease,
  ScientificDatasetAttachment,
  ScientificNotebookSession,
  ScientificRayJobSubmission,
} from "@local-studio/contracts/scientific-workbench";
import type { Effect } from "effect";
import {
  makeDatabaseCloser,
  openInitializedDatabase,
  repositoryEffect,
  type RepositoryError,
} from "../../stores/sqlite";
import type { ScientificFoundryInvocationEvidence, ScientificRayJobRecord } from "./types";

type DataRow = { data: string };

const decodeRow = <A>(row: DataRow | null): A | null => {
  if (!row) return null;
  try {
    return JSON.parse(row.data) as A;
  } catch {
    return null;
  }
};

export class ScientificWorkbenchStore {
  private readonly db: Database;
  private readonly closeDatabase: () => Effect.Effect<void, RepositoryError>;

  public constructor(dbPath: string) {
    this.db = openInitializedDatabase(dbPath, (db) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS scientific_notebooks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS scientific_compute_leases (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          notebook_id TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS scientific_dataset_attachments (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS scientific_ray_jobs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          notebook_id TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS scientific_experiment_receipts (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          submission_id TEXT NOT NULL UNIQUE,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS scientific_foundry_invocation_evidence (
          id TEXT PRIMARY KEY,
          submission_id TEXT NOT NULL,
          data TEXT NOT NULL,
          created_at TEXT NOT NULL
        )
      `);
    });
    this.closeDatabase = makeDatabaseCloser(this.db, "scientific-workbench.close");
  }

  public listNotebooks(
    projectId?: string,
  ): Effect.Effect<ScientificNotebookSession[], RepositoryError> {
    return repositoryEffect("scientific-workbench.notebooks.list", () => {
      const rows = projectId
        ? (this.db
            .query(
              "SELECT data FROM scientific_notebooks WHERE project_id = ? ORDER BY created_at DESC",
            )
            .all(projectId) as DataRow[])
        : (this.db
            .query("SELECT data FROM scientific_notebooks ORDER BY created_at DESC")
            .all() as DataRow[]);
      return rows.flatMap((row) => {
        const value = decodeRow<ScientificNotebookSession>(row);
        return value ? [value] : [];
      });
    });
  }

  public getNotebook(
    notebookId: string,
  ): Effect.Effect<ScientificNotebookSession | null, RepositoryError> {
    return repositoryEffect("scientific-workbench.notebooks.get", () =>
      decodeRow<ScientificNotebookSession>(
        this.db
          .query("SELECT data FROM scientific_notebooks WHERE id = ?")
          .get(notebookId) as DataRow | null,
      ),
    );
  }

  public saveNotebook(notebook: ScientificNotebookSession): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("scientific-workbench.notebooks.save", () => {
      this.db
        .query(
          `INSERT INTO scientific_notebooks (id, project_id, data, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, data = excluded.data`,
        )
        .run(notebook.id, notebook.project_id, JSON.stringify(notebook), notebook.created_at);
    });
  }

  public getComputeLease(
    leaseId: string,
  ): Effect.Effect<ScientificComputeLease | null, RepositoryError> {
    return repositoryEffect("scientific-workbench.compute-leases.get", () =>
      decodeRow<ScientificComputeLease>(
        this.db
          .query("SELECT data FROM scientific_compute_leases WHERE id = ?")
          .get(leaseId) as DataRow | null,
      ),
    );
  }

  public saveComputeLease(lease: ScientificComputeLease): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("scientific-workbench.compute-leases.save", () => {
      this.db
        .query(
          `INSERT INTO scientific_compute_leases (id, project_id, notebook_id, data, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
        )
        .run(
          lease.id,
          lease.project_id,
          lease.notebook_id,
          JSON.stringify(lease),
          lease.requested_at,
        );
    });
  }

  public getDatasetAttachment(
    attachmentId: string,
  ): Effect.Effect<ScientificDatasetAttachment | null, RepositoryError> {
    return repositoryEffect("scientific-workbench.dataset-attachments.get", () =>
      decodeRow<ScientificDatasetAttachment>(
        this.db
          .query("SELECT data FROM scientific_dataset_attachments WHERE id = ?")
          .get(attachmentId) as DataRow | null,
      ),
    );
  }

  public saveDatasetAttachment(
    attachment: ScientificDatasetAttachment,
  ): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("scientific-workbench.dataset-attachments.save", () => {
      this.db
        .query(
          `INSERT INTO scientific_dataset_attachments (id, project_id, data, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
        )
        .run(
          attachment.attachment_id,
          attachment.project_id,
          JSON.stringify(attachment),
          attachment.issued_at,
        );
    });
  }

  public listRayJobs(projectId?: string): Effect.Effect<ScientificRayJobRecord[], RepositoryError> {
    return repositoryEffect("scientific-workbench.ray-jobs.list", () => {
      const rows = projectId
        ? (this.db
            .query(
              "SELECT data FROM scientific_ray_jobs WHERE project_id = ? ORDER BY created_at DESC",
            )
            .all(projectId) as DataRow[])
        : (this.db
            .query("SELECT data FROM scientific_ray_jobs ORDER BY created_at DESC")
            .all() as DataRow[]);
      return rows.flatMap((row) => {
        const value = decodeRow<ScientificRayJobRecord>(row);
        return value ? [value] : [];
      });
    });
  }

  public getRayJob(jobId: string): Effect.Effect<ScientificRayJobRecord | null, RepositoryError> {
    return repositoryEffect("scientific-workbench.ray-jobs.get", () =>
      decodeRow<ScientificRayJobRecord>(
        this.db
          .query("SELECT data FROM scientific_ray_jobs WHERE id = ?")
          .get(jobId) as DataRow | null,
      ),
    );
  }

  public saveRayJob(
    submission: ScientificRayJobSubmission,
    record: ScientificRayJobRecord,
  ): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("scientific-workbench.ray-jobs.save", () => {
      this.db
        .query(
          `INSERT INTO scientific_ray_jobs (id, project_id, notebook_id, data, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
        )
        .run(
          record.id,
          submission.project_id,
          submission.notebook_id,
          JSON.stringify(record),
          submission.requested_at,
        );
    });
  }

  public listReceipts(
    projectId?: string,
  ): Effect.Effect<ScientificExperimentReceipt[], RepositoryError> {
    return repositoryEffect("scientific-workbench.receipts.list", () => {
      const rows = projectId
        ? (this.db
            .query(
              "SELECT data FROM scientific_experiment_receipts WHERE project_id = ? ORDER BY created_at DESC",
            )
            .all(projectId) as DataRow[])
        : (this.db
            .query("SELECT data FROM scientific_experiment_receipts ORDER BY created_at DESC")
            .all() as DataRow[]);
      return rows.flatMap((row) => {
        const value = decodeRow<ScientificExperimentReceipt>(row);
        return value ? [value] : [];
      });
    });
  }

  public getReceipt(
    receiptId: string,
  ): Effect.Effect<ScientificExperimentReceipt | null, RepositoryError> {
    return repositoryEffect("scientific-workbench.receipts.get", () =>
      decodeRow<ScientificExperimentReceipt>(
        this.db
          .query("SELECT data FROM scientific_experiment_receipts WHERE id = ?")
          .get(receiptId) as DataRow | null,
      ),
    );
  }

  public getReceiptBySubmission(
    submissionId: string,
  ): Effect.Effect<ScientificExperimentReceipt | null, RepositoryError> {
    return repositoryEffect("scientific-workbench.receipts.get-by-submission", () =>
      decodeRow<ScientificExperimentReceipt>(
        this.db
          .query("SELECT data FROM scientific_experiment_receipts WHERE submission_id = ?")
          .get(submissionId) as DataRow | null,
      ),
    );
  }

  public saveReceipt(
    projectId: string,
    receipt: ScientificExperimentReceipt,
  ): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("scientific-workbench.receipts.save", () => {
      this.db
        .query(
          `INSERT INTO scientific_experiment_receipts
             (id, project_id, submission_id, data, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          receipt.id,
          projectId,
          receipt.submission_id,
          JSON.stringify(receipt),
          receipt.completed_at ?? receipt.started_at,
        );
    });
  }

  public listFoundryInvocationEvidence(
    submissionId: string,
  ): Effect.Effect<ScientificFoundryInvocationEvidence[], RepositoryError> {
    return repositoryEffect("scientific-workbench.foundry-evidence.list", () => {
      const rows = this.db
        .query(
          `SELECT data FROM scientific_foundry_invocation_evidence
           WHERE submission_id = ? ORDER BY created_at ASC`,
        )
        .all(submissionId) as DataRow[];
      return rows.flatMap((row) => {
        const value = decodeRow<ScientificFoundryInvocationEvidence>(row);
        return value ? [value] : [];
      });
    });
  }

  public saveFoundryInvocationEvidence(
    evidence: ScientificFoundryInvocationEvidence,
  ): Effect.Effect<void, RepositoryError> {
    return repositoryEffect("scientific-workbench.foundry-evidence.save", () => {
      this.db
        .query(
          `INSERT INTO scientific_foundry_invocation_evidence
             (id, submission_id, data, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`,
        )
        .run(evidence.id, evidence.submission_id, JSON.stringify(evidence), evidence.observed_at);
    });
  }

  public close(): Effect.Effect<void, RepositoryError> {
    return this.closeDatabase();
  }
}
