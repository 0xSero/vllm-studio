import { readFile } from "node:fs/promises";
import type { Database } from "bun:sqlite";
import { Effect, Schema } from "effect";
import { parseRecipe } from "./recipe-serializer";
import type { Recipe } from "../types";
import { JsonRepository, openSqliteDatabase } from "../../../stores/sqlite";

export class RecipeStoreError extends Schema.TaggedErrorClass<RecipeStoreError>()(
  "RecipeStoreError",
  {
    operation: Schema.Literals(["open", "list", "get", "save", "delete", "import", "close"]),
    message: Schema.String,
    source: Schema.Unknown,
  },
) {}

const storeError = (operation: RecipeStoreError["operation"], source: unknown): RecipeStoreError =>
  new RecipeStoreError({
    operation,
    message: `Recipe ${operation} failed: ${String(source)}`,
    source,
  });

const migrateRecipes = (db: Database): string => {
  const table = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='recipes'")
    .get();
  if (table) {
    const columns = db.query("PRAGMA table_info(recipes)").all() as Array<{ name: string }>;
    return columns.some((column) => column.name === "data") ? "data" : "json";
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  return "data";
};

export class RecipeStore extends JsonRepository<Recipe, RecipeStoreError> {
  private constructor(db: Database, column: string) {
    super(
      db,
      {
        table: "recipes",
        column,
        orderBy: "id",
        idOf: (recipe): string => recipe.id,
        decode: (value): Recipe => parseRecipe(JSON.parse(value)),
      },
      storeError,
    );
  }

  static open(dbPath: string): Effect.Effect<RecipeStore, RecipeStoreError> {
    return Effect.try({
      try: () => {
        const db = openSqliteDatabase(dbPath);
        try {
          return new RecipeStore(db, migrateRecipes(db));
        } catch (source) {
          try {
            db.close();
          } catch {}
          throw source;
        }
      },
      catch: (source) => (source instanceof RecipeStoreError ? source : storeError("open", source)),
    });
  }

  importFromJson(jsonPath: string): Effect.Effect<number, RecipeStoreError> {
    return Effect.tryPromise({
      try: () => readFile(jsonPath, "utf-8"),
      catch: (source) => storeError("import", source),
    }).pipe(
      Effect.flatMap((content) =>
        Effect.try({
          try: () => JSON.parse(content) as unknown,
          catch: (source) => storeError("import", source),
        }),
      ),
      Effect.flatMap((parsed) => {
        const entries = Array.isArray(parsed) ? parsed : [parsed];
        return Effect.forEach(entries, (entry) =>
          Effect.sync(() => {
            try {
              return parseRecipe(entry);
            } catch {
              return null;
            }
          }).pipe(
            Effect.flatMap((recipe) =>
              recipe ? this.save(recipe).pipe(Effect.as(1)) : Effect.succeed(0),
            ),
          ),
        );
      }),
      Effect.map((counts) => counts.reduce((total, count) => total + count, 0)),
    );
  }
}
