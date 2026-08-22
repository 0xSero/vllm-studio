import { readFile } from "node:fs/promises";
import { Effect, Schema } from "effect";
import { parseRecipe } from "./recipe-serializer";
import type { Recipe } from "../types";
import { openSqliteDatabase } from "../../../stores/sqlite";

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

const tryParseRecipe = (raw: unknown): Recipe | null => {
  try {
    return parseRecipe(raw);
  } catch {
    return null;
  }
};

export class RecipeStore {
  private readonly db: ReturnType<typeof openSqliteDatabase>;
  private useJsonColumn = false;

  constructor(dbPath: string) {
    this.db = openSqliteDatabase(dbPath);
    try {
      this.migrate();
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

  private migrate(): void {
    const table = this.db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='recipes'")
      .get();
    if (table) {
      const columns = this.db.query("PRAGMA table_info(recipes)").all() as Array<{ name: string }>;
      const columnNames = new Set(columns.map((column) => column.name));
      this.useJsonColumn = columnNames.has("json") && !columnNames.has("data");
      if (!columnNames.has("json") && !columnNames.has("data")) this.useJsonColumn = true;
      return;
    }
    this.db.run(`
      CREATE TABLE IF NOT EXISTS recipes (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this.useJsonColumn = false;
  }

  private get column(): string {
    return this.useJsonColumn ? "json" : "data";
  }

  /** Rows with unreadable or unparseable payloads are skipped, never thrown. */
  private decodeRow(row: Record<string, string> | null): Recipe | null {
    const raw = row?.[this.column];
    if (typeof raw !== "string") return null;
    try {
      return parseRecipe(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  list(): Effect.Effect<Recipe[], RecipeStoreError> {
    return Effect.try({
      try: () => {
        const rows = this.db.query(`SELECT ${this.column} FROM recipes ORDER BY id`).all() as Array<
          Record<string, string>
        >;
        return rows.flatMap((row) => {
          const recipe = this.decodeRow(row);
          return recipe ? [recipe] : [];
        });
      },
      catch: (source) => storeError("list", source),
    });
  }

  get(recipeId: string): Effect.Effect<Recipe | null, RecipeStoreError> {
    return Effect.try({
      try: () =>
        this.decodeRow(
          this.db.query(`SELECT ${this.column} FROM recipes WHERE id = ?`).get(recipeId) as Record<
            string,
            string
          > | null,
        ),
      catch: (source) => storeError("get", source),
    });
  }

  save(recipe: Recipe): Effect.Effect<void, RecipeStoreError> {
    return Effect.try({
      try: () => {
        const column = this.column;
        // The legacy "json" schema also owns created_at; the "data" schema defaults it.
        const insert = this.useJsonColumn
          ? `INSERT INTO recipes (id, json, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
          : `INSERT INTO recipes (id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`;
        this.db
          .query(
            `${insert} ON CONFLICT(id) DO UPDATE SET ${column} = excluded.${column}, updated_at = CURRENT_TIMESTAMP`,
          )
          .run(recipe.id, JSON.stringify(recipe));
      },
      catch: (source) => storeError("save", source),
    });
  }

  delete(recipeId: string): Effect.Effect<boolean, RecipeStoreError> {
    return Effect.try({
      try: () => this.db.query("DELETE FROM recipes WHERE id = ?").run(recipeId).changes > 0,
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
      Effect.flatMap((parsed) =>
        Effect.forEach(Array.isArray(parsed) ? parsed : [parsed], (entry) => {
          const recipe = tryParseRecipe(entry);
          return recipe ? this.save(recipe).pipe(Effect.as(1)) : Effect.succeed(0);
        }),
      ),
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
