import { copyFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const SETTINGS_FILENAME = "api-settings.json";
const LEGACY_DOT_DIR = [".v", "llm-studio"].join("");
const LEGACY_APP_DATA_DIR = ["v", "LLM Studio"].join("");
const LEGACY_APP_DATA_SLUG = ["v", "llm-studio-app"].join("");

let cachedDataDir: string | null = null;
let cachedDataDirEnv: string | undefined;
let migrated = false;

function legacySettingsFileCandidates(): string[] {
  return [
    path.join(process.cwd(), "data", SETTINGS_FILENAME),
    path.join(process.cwd(), "..", "data", SETTINGS_FILENAME),
    path.join(process.cwd(), "frontend", "data", SETTINGS_FILENAME),
    path.join(homedir(), ".local-studio", SETTINGS_FILENAME),
    path.join(homedir(), LEGACY_DOT_DIR, SETTINGS_FILENAME),
    path.join(tmpdir(), "local-studio", SETTINGS_FILENAME),
    path.join(homedir(), "Library", "Application Support", "local-studio-app", SETTINGS_FILENAME),
    path.join(homedir(), "Library", "Application Support", LEGACY_APP_DATA_SLUG, SETTINGS_FILENAME),
    path.join(homedir(), "Library", "Application Support", LEGACY_APP_DATA_DIR, SETTINGS_FILENAME),
    path.join(homedir(), "Library", "Application Support", "Electron", SETTINGS_FILENAME),
    path.join(homedir(), "Library", "Application Support", "frontend", SETTINGS_FILENAME),
  ];
}

export function resolveDataDir(): string {
  const envDir = process.env.LOCAL_STUDIO_DATA_DIR?.trim();
  if (cachedDataDir && cachedDataDirEnv === envDir) return cachedDataDir;

  const dir = envDir && envDir.length > 0 ? envDir : path.join(homedir(), ".local-studio");

  mkdirSync(dir, { recursive: true });
  try {
    chmodSync(dir, 0o700);
  } catch {}

  cachedDataDir = dir;
  cachedDataDirEnv = envDir;
  migrateLegacySettings(dir);
  return dir;
}

export function resolveSettingsFilePath(): string {
  return path.join(resolveDataDir(), SETTINGS_FILENAME);
}

function migrateLegacySettings(targetDir: string): void {
  if (migrated) return;
  migrated = true;

  const targetFile = path.join(targetDir, SETTINGS_FILENAME);
  if (existsSync(targetFile)) return;

  for (const legacyFile of legacySettingsFileCandidates()) {
    if (path.resolve(legacyFile) === path.resolve(targetFile)) continue;
    if (!existsSync(legacyFile)) continue;
    try {
      copyFileSync(legacyFile, targetFile);
      try {
        chmodSync(targetFile, 0o600);
      } catch {}
      console.log(`[data-dir] Migrated api-settings.json from ${legacyFile} -> ${targetFile}`);
      return;
    } catch (error) {
      console.warn(`[data-dir] Failed to migrate from ${legacyFile}:`, error);
    }
  }
}
