import { readFileSync } from "node:fs";
import { parseRecipe } from "./recipe-serializer";
import type { Recipe } from "../types";
import { openSqliteDatabase } from "../../../stores/sqlite";

export class RecipeStore {
  private readonly db: ReturnType<typeof openSqliteDatabase>;
  private useJsonColumn = false;

  public constructor(dbPath: string) {
    this.db = openSqliteDatabase(dbPath);
    this.migrate();
  }

  private migrate(): void {
    const table = this.db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='recipes'")
      .get();
    if (table) {
      const columns = this.db.query("PRAGMA table_info(recipes)").all() as Array<{ name: string }>;
      const columnNames = new Set(columns.map((column) => column.name));
      if (columnNames.has("json") && !columnNames.has("data")) {
        this.useJsonColumn = true;
      } else {
        this.useJsonColumn = !columnNames.has("data");
      }
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

  public list(): Recipe[] {
    const column = this.useJsonColumn ? "json" : "data";
    const rows = this.db.query(`SELECT ${column} FROM recipes ORDER BY id`).all() as Array<
      Record<string, string>
    >;
    const recipes: Recipe[] = [];
    for (const row of rows) {
      try {
        const raw = row[column];
        if (typeof raw !== "string") {
          continue;
        }
        const parsed = parseRecipe(JSON.parse(raw));
        recipes.push(parsed);
      } catch {
        continue;
      }
    }
    return recipes;
  }

  public get(recipeId: string): Recipe | null {
    const column = this.useJsonColumn ? "json" : "data";
    const row = this.db.query(`SELECT ${column} FROM recipes WHERE id = ?`).get(recipeId) as Record<
      string,
      string
    > | null;
    if (!row) {
      return null;
    }
    try {
      const raw = row[column];
      if (typeof raw !== "string") {
        return null;
      }
      return parseRecipe(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  public save(recipe: Recipe): void {
    const data = JSON.stringify(recipe);
    const column = this.useJsonColumn ? "json" : "data";
    if (this.useJsonColumn) {
      this.db
        .query(
          `
        INSERT INTO recipes (id, ${column}, created_at, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET ${column} = excluded.${column}, updated_at = CURRENT_TIMESTAMP
      `,
        )
        .run(recipe.id, data);
      return;
    }
    this.db
      .query(
        `
      INSERT INTO recipes (id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP
    `,
      )
      .run(recipe.id, data);
  }

  public delete(recipeId: string): boolean {
    const result = this.db.query("DELETE FROM recipes WHERE id = ?").run(recipeId);
    return result.changes > 0;
  }

  public importFromJson(jsonPath: string): number {
    const content = readFileSync(jsonPath, "utf-8");
    const parsed = JSON.parse(content) as unknown;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    let count = 0;
    for (const entry of list) {
      try {
        const recipe = parseRecipe(entry);
        this.save(recipe);
        count += 1;
      } catch {
        continue;
      }
    }
    return count;
  }
}
