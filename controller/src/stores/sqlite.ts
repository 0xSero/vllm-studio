import { Database } from "bun:sqlite";
import { chmodSync } from "node:fs";

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

const dropObsoleteTables = (db: Database): void => {
  for (const table of OBSOLETE_TABLES) {
    db.run(`DROP TABLE IF EXISTS ${table}`);
  }
};

export const openSqliteDatabase = (dbPath: string): Database => {
  const db = new Database(dbPath);
  db.run("PRAGMA busy_timeout = 5000");
  // The DB can hold recipe env_vars / launch_command (potential secrets); keep
  // it owner-only rather than relying on the process umask.
  if (dbPath !== ":memory:") {
    try {
      chmodSync(dbPath, 0o600);
    } catch {
      // Best effort: some filesystems (or in-memory paths) do not support chmod.
    }
  }
  dropObsoleteTables(db);
  return db;
};
