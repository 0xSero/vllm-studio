import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Effect, Schema } from "effect";
import { parseRecipe, recipeExtraArgumentSchema } from "./recipe-serializer";
import type { Recipe } from "../types";
import type { RecipeExtraArgument } from "@local-studio/contracts/recipes";
import { openSqliteDatabase } from "../../../stores/sqlite";
import { ModelIndexEntrySchema, type ModelIndexEntry } from "../../../../contracts/model-index";

export class RecipeStoreError extends Schema.TaggedErrorClass<RecipeStoreError>()(
  "RecipeStoreError",
  {
    operation: Schema.Literals(["open", "list", "get", "save", "delete", "import", "close"]),
    message: Schema.String,
    source: Schema.Unknown,
  },
) {}

const storeError = (
  operation: RecipeStoreError["operation"],
  source: RecipeStoreError["source"],
): RecipeStoreError =>
  new RecipeStoreError({
    operation,
    message: `Recipe ${operation} failed: ${String(source)}`,
    source,
  });

interface RegistryOverlay {
  version: number;
  updated: string;
  intelligence_source?: string | undefined;
  tiers: RecipeExtraArgument[];
  entries: ModelIndexEntry[];
  migrated_from_sqlite?: string | undefined;
}

const RegistryOverlaySchema = Schema.Struct({
  version: Schema.Number,
  updated: Schema.String,
  intelligence_source: Schema.optional(Schema.String),
  tiers: Schema.Array(recipeExtraArgumentSchema),
  entries: Schema.Array(ModelIndexEntrySchema),
  migrated_from_sqlite: Schema.optional(Schema.String),
});
const decodeRegistryOverlay = Schema.decodeUnknownSync(RegistryOverlaySchema, {
  onExcessProperty: "preserve",
});

const emptyOverlay = (): RegistryOverlay => ({
  version: 1,
  updated: new Date().toISOString().slice(0, 10),
  tiers: [],
  entries: [],
});

const entryFromRecipe = (recipe: Recipe): ModelIndexEntry => {
  const { id, name, ...serve } = recipe;
  return { id, name, serve };
};

const recipeFromEntry = (entry: ModelIndexEntry): Recipe | null => {
  try {
    return parseRecipe({ id: entry.id, name: entry.name, ...entry.serve });
  } catch {
    return null;
  }
};

export class RecipeStore {
  private readonly overlayPath: string;

  constructor(dataDirectory: string, sqliteDatabasePath: string) {
    this.overlayPath = resolve(dataDirectory, "model-index.json");
    try {
      this.migrateFromSqlite(sqliteDatabasePath);
      // Entries the current roster cannot serve (e.g. legacy llamacpp/mlx
      // recipes) stay in the registry file untouched but are not served;
      // say so once instead of hiding them silently.
      const unservable = this.readOverlay().entries.filter((entry) => !recipeFromEntry(entry));
      if (unservable.length > 0) {
        console.warn(
          `[recipes] ${unservable.length} registry entr${unservable.length === 1 ? "y is" : "ies are"} not servable by this roster and will not be listed: ${unservable.map((entry) => entry.id).join(", ")}`,
        );
      }
    } catch (source) {
      throw storeError("open", source);
    }
  }

  static open(
    dataDirectory: string,
    sqliteDatabasePath: string,
  ): Effect.Effect<RecipeStore, RecipeStoreError> {
    return Effect.try({
      try: () => new RecipeStore(dataDirectory, sqliteDatabasePath),
      catch: (source) => (source instanceof RecipeStoreError ? source : storeError("open", source)),
    });
  }

  private readOverlay(): RegistryOverlay {
    if (!existsSync(this.overlayPath)) return emptyOverlay();
    const decoded = decodeRegistryOverlay({
      ...emptyOverlay(),
      ...JSON.parse(readFileSync(this.overlayPath, "utf-8")),
    });
    return { ...decoded, tiers: [...decoded.tiers], entries: [...decoded.entries] };
  }

  private writeOverlay(overlay: RegistryOverlay): void {
    mkdirSync(resolve(this.overlayPath, ".."), { recursive: true });
    const temporary = `${this.overlayPath}.tmp-${process.pid}`;
    writeFileSync(temporary, `${JSON.stringify(overlay, null, 2)}\n`, "utf-8");
    renameSync(temporary, this.overlayPath);
  }

  private migrateFromSqlite(sqliteDatabasePath: string): void {
    const overlay = this.readOverlay();
    if (overlay.migrated_from_sqlite) return;
    let imported = 0;
    if (existsSync(sqliteDatabasePath)) {
      const db = openSqliteDatabase(sqliteDatabasePath);
      try {
        const table = db
          .query("SELECT name FROM sqlite_master WHERE type='table' AND name='recipes'")
          .get();
        if (table) {
          const columns = db.query<{ name: string }, []>("PRAGMA table_info(recipes)").all();
          const names = new Set(columns.map((column) => column.name));
          const column = names.has("data") ? "data" : names.has("json") ? "json" : null;
          if (column) {
            const rows = db
              .query<
                { data?: string; json?: string },
                []
              >(`SELECT ${column} FROM recipes ORDER BY id`)
              .all();
            const known = new Set(overlay.entries.map((entry) => entry.id));
            for (const row of rows) {
              const raw = row[column];
              if (!raw) continue;
              let recipe: Recipe | null = null;
              try {
                recipe = parseRecipe(JSON.parse(raw));
              } catch {
                continue;
              }
              if (known.has(recipe.id)) continue;
              overlay.entries.push(entryFromRecipe(recipe));
              known.add(recipe.id);
              imported += 1;
            }
          }
        }
      } finally {
        try {
          db.close();
        } catch {
          // The database was only needed for the read; a failed close is
          // irrelevant to the migration outcome.
        }
      }
    }
    overlay.migrated_from_sqlite = new Date().toISOString();
    this.writeOverlay(overlay);
    if (imported > 0) {
      console.log(`[recipes] migrated ${imported} recipe(s) from sqlite into the model registry`);
    }
  }

  list(): Effect.Effect<Recipe[], RecipeStoreError> {
    return Effect.try({
      try: () =>
        this.readOverlay()
          .entries.map(recipeFromEntry)
          .filter((recipe): recipe is Recipe => recipe !== null),
      catch: (source) => storeError("list", source),
    });
  }

  get(recipeId: string): Effect.Effect<Recipe | null, RecipeStoreError> {
    return Effect.try({
      try: () => {
        const entry = this.readOverlay().entries.find((candidate) => candidate.id === recipeId);
        return entry ? recipeFromEntry(entry) : null;
      },
      catch: (source) => storeError("get", source),
    });
  }

  save(recipe: Recipe): Effect.Effect<void, RecipeStoreError> {
    return Effect.try({
      try: () => {
        const overlay = this.readOverlay();
        const entry = entryFromRecipe(recipe);
        const index = overlay.entries.findIndex((candidate) => candidate.id === recipe.id);
        if (index === -1) overlay.entries.push(entry);
        else overlay.entries[index] = entry;
        this.writeOverlay(overlay);
      },
      catch: (source) => storeError("save", source),
    });
  }

  delete(recipeId: string): Effect.Effect<boolean, RecipeStoreError> {
    return Effect.try({
      try: () => {
        const overlay = this.readOverlay();
        const next = overlay.entries.filter((candidate) => candidate.id !== recipeId);
        if (next.length === overlay.entries.length) return false;
        overlay.entries = next;
        this.writeOverlay(overlay);
        return true;
      },
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
          try: () => JSON.parse(content),
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
    // The registry file is opened per operation; nothing is held.
    return Effect.void;
  }
}
