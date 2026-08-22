import { Schema, type Effect } from "effect";
import { repositoryEffect, SqliteStore, type RepositoryError } from "./sqlite";

const UI_PREFERENCES_KEY = "ui_preferences";

type SettingRow = {
  value: string;
};

const UiPreferencesSchema = Schema.Record(Schema.String, Schema.String);

export class ControllerSettingsStore extends SqliteStore {
  public constructor(dbPath: string) {
    super(dbPath, "controller-settings", (db) =>
      db.run(`
      CREATE TABLE IF NOT EXISTS controller_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `),
    );
  }

  public getUiPreferencesEffect(): Effect.Effect<Record<string, string>, RepositoryError> {
    return repositoryEffect("controller-settings.get-ui-preferences", () => {
      const row = this.db
        .query("SELECT value FROM controller_settings WHERE key = ?")
        .get(UI_PREFERENCES_KEY) as SettingRow | null;
      if (!row) return {};
      try {
        return Schema.decodeUnknownSync(UiPreferencesSchema)(JSON.parse(row.value) as unknown);
      } catch {
        return {};
      }
    });
  }

  public saveUiPreferencesEffect(
    preferences: Record<string, string>,
  ): Effect.Effect<Record<string, string>, RepositoryError> {
    return repositoryEffect("controller-settings.save-ui-preferences", () => {
      const clean = Object.fromEntries(
        Object.entries(preferences).filter(
          (entry): entry is [string, string] =>
            typeof entry[0] === "string" && entry[0].length > 0 && typeof entry[1] === "string",
        ),
      );
      this.db
        .query(
          `INSERT INTO controller_settings (key, value, updated_at)
           VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
        )
        .run(UI_PREFERENCES_KEY, JSON.stringify(clean));
      return clean;
    });
  }
}
