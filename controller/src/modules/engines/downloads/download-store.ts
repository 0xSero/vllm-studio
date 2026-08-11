import { Effect, Schema } from "effect";
import { JsonBlobTable, openSqliteDatabase } from "../../../stores/sqlite";
import type { EngineOperationError } from "../engine-spec";
import { attempt } from "../engine-operation";
import type { ModelDownload } from "../types";

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

export class DownloadStore {
  private readonly records: JsonBlobTable<ModelDownload>;

  private constructor(private readonly db: ReturnType<typeof openSqliteDatabase>) {
    this.records = new JsonBlobTable(db, {
      table: "model_downloads",
      orderBy: "updated_at DESC",
      idOf: (download): string => download.id,
      decode: decodeDownload,
    });
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

  public list(): Effect.Effect<ModelDownload[], EngineOperationError> {
    return attempt("list-downloads", () => this.records.list());
  }

  public get(id: string): Effect.Effect<ModelDownload | null, EngineOperationError> {
    return attempt("get-download", () => this.records.get(id));
  }

  public save(download: ModelDownload): Effect.Effect<void, EngineOperationError> {
    return attempt("save-download", () => this.records.save(download));
  }

  public delete(id: string): Effect.Effect<boolean, EngineOperationError> {
    return attempt("delete-download", () => this.records.delete(id));
  }

  public close(): Effect.Effect<void, EngineOperationError> {
    return attempt("close-download-database", () => this.db.close());
  }
}
