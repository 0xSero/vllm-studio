import { Effect, Schema } from "effect";
import { JsonRepository, openSqliteDatabase } from "../../../stores/sqlite";
import type { EngineOperationError } from "../engine-spec";
import { attempt, operationError } from "../engine-operation";
import type { ModelDownload } from "../types";

const DOWNLOAD_OPERATIONS = {
  list: "list-downloads",
  get: "get-download",
  save: "save-download",
  delete: "delete-download",
  close: "close-download-database",
} as const;

const DownloadFileSchema = Schema.Struct({
  path: Schema.String,
  size_bytes: Schema.NullOr(Schema.Number),
  downloaded_bytes: Schema.Number,
  status: Schema.Literals(["pending", "downloading", "completed", "error"]),
});

const ModelDownloadSchema = Schema.Struct({
  id: Schema.String,
  model_id: Schema.String,
  revision: Schema.NullOr(Schema.String),
  status: Schema.Literals(["queued", "downloading", "paused", "completed", "failed", "canceled"]),
  source: Schema.optional(Schema.NullOr(Schema.String)),
  created_at: Schema.String,
  updated_at: Schema.String,
  completed_at: Schema.optional(Schema.NullOr(Schema.String)),
  target_dir: Schema.String,
  total_bytes: Schema.NullOr(Schema.Number),
  downloaded_bytes: Schema.Number,
  speed_bytes_per_second: Schema.optional(Schema.NullOr(Schema.Number)),
  files: Schema.Array(DownloadFileSchema),
  error: Schema.NullOr(Schema.String),
});

const decodeDownload = (value: string): ModelDownload =>
  Schema.decodeUnknownSync(ModelDownloadSchema)(JSON.parse(value)) as ModelDownload;

export class DownloadStore extends JsonRepository<ModelDownload, EngineOperationError> {
  private constructor(db: ReturnType<typeof openSqliteDatabase>) {
    super(
      db,
      {
        table: "model_downloads",
        orderBy: "updated_at DESC",
        idOf: (download): string => download.id,
        decode: decodeDownload,
      },
      (operation, cause) => operationError(DOWNLOAD_OPERATIONS[operation], cause),
    );
  }

  public static make(dbPath: string): Effect.Effect<DownloadStore, EngineOperationError> {
    return Effect.gen(function* () {
      const db = yield* attempt("open-download-database", () => openSqliteDatabase(dbPath));
      const store = new DownloadStore(db);
      return yield* store.migrate().pipe(
        Effect.as(store),
        Effect.onError(() =>
          attempt("close-download-database", () => db.close()).pipe(Effect.ignore),
        ),
      );
    });
  }

  private migrate(): Effect.Effect<void, EngineOperationError> {
    return attempt("migrate-download-store", () => {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS model_downloads (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
    });
  }
}
