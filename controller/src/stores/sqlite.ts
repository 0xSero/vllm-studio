import { Database } from "bun:sqlite";

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
  dropObsoleteTables(db);
  return db;
};
