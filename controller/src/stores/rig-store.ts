import type { Rig } from "@local-studio/contracts/rigs";
import { JsonRepository, openInitializedDatabase, RepositoryError } from "./sqlite";

export type RigStore = JsonRepository<Rig, RepositoryError>;

export const makeRigStore = (dbPath: string): RigStore => {
  const db = openInitializedDatabase(dbPath, (database) =>
    database.run(`
      CREATE TABLE IF NOT EXISTS rigs (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `),
  );
  return new JsonRepository(
    db,
    {
      table: "rigs",
      orderBy: "created_at",
      idOf: (rig: Rig): string => rig.id,
      decode: (value): Rig => JSON.parse(value) as Rig,
    },
    (operation, cause) => new RepositoryError(`rigs.${operation}`, cause),
  );
};
