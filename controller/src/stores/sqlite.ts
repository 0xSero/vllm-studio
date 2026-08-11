import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";
import { Effect } from "effect";

const OBSOLETE_TABLES = [
  "jobs",
  "chat_sessions",
  "chat_messages",
  "chat_runs",
  "chat_usage",
  "sessions",
  "messages",
  "runs",
  "usage",
] as const;

const sweptPaths = new Set<string>();

const dropObsoleteTables = (db: Database, dbPath: string): void => {
  if (sweptPaths.has(dbPath)) return;
  for (const table of OBSOLETE_TABLES) {
    db.run(`DROP TABLE IF EXISTS ${table}`);
  }
  sweptPaths.add(dbPath);
};

export const toFiniteNumber = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export class RepositoryError extends Error {
  readonly _tag = "RepositoryError";

  public constructor(
    readonly operation: string,
    override readonly cause: unknown,
  ) {
    super(`Repository operation failed: ${operation}`, { cause });
    this.name = "RepositoryError";
  }
}

export const repositoryEffect = <A>(
  operation: string,
  execute: () => A,
): Effect.Effect<A, RepositoryError> =>
  Effect.try({
    try: execute,
    catch: (cause) => new RepositoryError(operation, cause),
  });

export const makeDatabaseCloser = (
  db: Database,
  operation: string,
): (() => Effect.Effect<void, RepositoryError>) => {
  let closed = false;
  return () =>
    repositoryEffect(operation, () => {
      if (closed) return;
      db.close();
      closed = true;
    });
};

export const toNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const openSqliteDatabase = (dbPath: string): Database => {
  const db = new Database(dbPath);
  try {
    db.run("PRAGMA busy_timeout = 5000");
    if (dbPath !== ":memory:") {
      try {
        chmodSync(dbPath, 0o600);
      } catch {}
    }
    dropObsoleteTables(db, dbPath);
    return db;
  } catch (cause) {
    try {
      db.close();
    } catch {}
    throw cause;
  }
};

export const openInitializedDatabase = (
  dbPath: string,
  initialize: (db: Database) => void,
): Database => {
  const db = openSqliteDatabase(dbPath);
  try {
    initialize(db);
    return db;
  } catch (cause) {
    try {
      db.close();
    } catch {}
    throw cause;
  }
};

type JsonBlobTableOptions<T> = {
  table: string;
  column?: string;
  orderBy: string;
  idOf: (value: T) => string;
  decode: (value: string) => T;
};

export class JsonBlobTable<T> {
  public constructor(
    private readonly db: Database,
    private readonly options: JsonBlobTableOptions<T>,
  ) {}

  public list(): T[] {
    const { table, column = "data", orderBy, decode } = this.options;
    const rows = this.db.query(`SELECT ${column} FROM ${table} ORDER BY ${orderBy}`).all() as Array<
      Record<string, string>
    >;
    return rows.flatMap((row) => {
      try {
        const value = row[column];
        return typeof value === "string" ? [decode(value)] : [];
      } catch {
        return [];
      }
    });
  }

  public get(id: string): T | null {
    const { table, column = "data", decode } = this.options;
    const row = this.db.query(`SELECT ${column} FROM ${table} WHERE id = ?`).get(id) as Record<
      string,
      string
    > | null;
    const value = row?.[column];
    if (typeof value !== "string") return null;
    try {
      return decode(value);
    } catch {
      return null;
    }
  }

  public save(value: T): void {
    const { table, column = "data", idOf } = this.options;
    this.db
      .query(
        `INSERT INTO ${table} (id, ${column}, created_at, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET ${column} = excluded.${column}, updated_at = CURRENT_TIMESTAMP`,
      )
      .run(idOf(value), JSON.stringify(value));
  }

  public delete(id: string): boolean {
    return this.db.query(`DELETE FROM ${this.options.table} WHERE id = ?`).run(id).changes > 0;
  }
}
