import { readFile } from "node:fs/promises";
import { Effect, Schema } from "effect";
import { parseRecipe } from "./recipe-serializer";
import type { Recipe } from "../types";
import { JsonBlobTable, openSqliteDatabase } from "../../../stores/sqlite";

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

export class RecipeStore {
  private readonly db: ReturnType<typeof openSqliteDatabase>;
  private readonly records: JsonBlobTable<Recipe>;

  constructor(dbPath: string) {
    this.db = openSqliteDatabase(dbPath);
    try {
      const column = this.migrate();
      this.records = new JsonBlobTable(this.db, {
        table: "recipes",
        column,
        orderBy: "id",
        idOf: (recipe): string => recipe.id,
        decode: (value): Recipe => parseRecipe(JSON.parse(value)),
      });
    } catch (source) {
      try {
        this.db.close();
      } catch {}
      throw storeError("open", source);
    }
  }

  static open(dbPath: string): Effect.Effect<RecipeStore, RecipeStoreError> {
    return Effect.try({
      try: () => new RecipeStore(dbPath),
      catch: (source) => (source instanceof RecipeStoreError ? source : storeError("open", source)),
    });
  }

  private migrate(): string {
    const table = this.db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='recipes'")
      .get();
    if (table) {
      const columns = this.db.query("PRAGMA table_info(recipes)").all() as Array<{ name: string }>;
      const columnNames = new Set(columns.map((column) => column.name));
      return columnNames.has("data") ? "data" : "json";
    }
    this.db.run(`
      CREATE TABLE IF NOT EXISTS recipes (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    return "data";
  }

  list(): Effect.Effect<Recipe[], RecipeStoreError> {
    return Effect.try({
      try: () => this.records.list(),
      catch: (source) => storeError("list", source),
    });
  }

  get(recipeId: string): Effect.Effect<Recipe | null, RecipeStoreError> {
    return Effect.try({
      try: () => this.records.get(recipeId),
      catch: (source) => storeError("get", source),
    });
  }

  save(recipe: Recipe): Effect.Effect<void, RecipeStoreError> {
    return Effect.try({
      try: () => this.records.save(recipe),
      catch: (source) => storeError("save", source),
    });
  }

  delete(recipeId: string): Effect.Effect<boolean, RecipeStoreError> {
    return Effect.try({
      try: () => this.records.delete(recipeId),
      catch: (source) => storeError("delete", source),
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

  close(): Effect.Effect<void, RecipeStoreError> {
    return Effect.try({
      try: () => this.db.close(),
      catch: (source) => storeError("close", source),
    });
  }
}
