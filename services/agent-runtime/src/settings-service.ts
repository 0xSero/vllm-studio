import { chmod, readFile, rename, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { resolveSettingsDefaultBackendUrl } from "../../../shared/agent/backend-url";
import { resolveDataDir, resolveSettingsFilePath } from "./data-dir";
import { Schema } from "effect";

export interface ApiSettings {
  backendUrl: string;
  apiKey: string;
}

const MASKED_KEY_MARKER = "••••";

const SavedApiSettingsSchema = Schema.Struct({
  backendUrl: Schema.optional(Schema.String),
  apiKey: Schema.optional(Schema.String),
});

const DEFAULT_SETTINGS: ApiSettings = {
  backendUrl: resolveSettingsDefaultBackendUrl(),
  apiKey: process.env.API_KEY || "",
};

export async function getApiSettings(): Promise<ApiSettings> {
  const settingsFile = resolveSettingsFilePath();
  if (!existsSync(settingsFile)) return DEFAULT_SETTINGS;
  try {
    const saved = Schema.decodeUnknownSync(SavedApiSettingsSchema)(
      JSON.parse(await readFile(settingsFile, "utf-8")),
    );
    return {
      backendUrl: saved.backendUrl || DEFAULT_SETTINGS.backendUrl,
      apiKey: saved.apiKey || DEFAULT_SETTINGS.apiKey,
    };
  } catch (error) {
    console.error(`[API Settings] Failed to read ${settingsFile}:`, error);
    return DEFAULT_SETTINGS;
  }
}

export async function saveApiSettings(settings: ApiSettings): Promise<void> {
  resolveDataDir();
  const settingsFile = resolveSettingsFilePath();
  const payload = JSON.stringify(settings, null, 2);
  const tempFile = `${settingsFile}.tmp-${process.pid}`;
  await writeFile(tempFile, payload, "utf-8");
  await chmod(tempFile, 0o600).catch(() => undefined);
  await rename(tempFile, settingsFile);
}

export function maskApiKey(key: string): string {
  if (!key || key.length < 12) return key ? "••••••••" : "";
  return `${key.slice(0, 4)}${MASKED_KEY_MARKER}${key.slice(-4)}`;
}

export class InvalidSettingsError extends Error {}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export async function applySettingsUpdate(update: Partial<ApiSettings>): Promise<ApiSettings> {
  const { backendUrl, apiKey } = update;

  if (backendUrl && !isValidUrl(backendUrl)) {
    throw new InvalidSettingsError("Invalid backend URL format");
  }

  const current = await getApiSettings();
  const next: ApiSettings = {
    backendUrl: backendUrl || current.backendUrl,
    apiKey: apiKey && !apiKey.includes(MASKED_KEY_MARKER) ? apiKey : current.apiKey,
  };

  await saveApiSettings(next);
  return next;
}

export function maskedSettingsView(settings: ApiSettings) {
  return {
    backendUrl: settings.backendUrl,
    apiKey: maskApiKey(settings.apiKey),
    hasApiKey: Boolean(settings.apiKey),
  };
}
