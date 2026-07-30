// Server-side API settings service: the single owner of reading, writing,
// merging, and masking the persisted `<dataDir>/api-settings.json` file.

import { randomUUID } from "node:crypto";
import { chmod, open, readFile, rename, unlink, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { resolveSettingsDefaultBackendUrl } from "../../../shared/agent/backend-url";
import { resolveDataDir, resolveSettingsFilePath } from "./data-dir";
import {
  controllerCredentialReference,
  controllerCredentialStorageStatus,
  readControllerCredential,
  writeControllerCredential,
} from "./controller-credential-store";

export interface ApiSettings {
  backendUrl: string;
  apiKey: string;
  voiceUrl: string;
  voiceModel: string;
}

type PersistedApiSettings = Omit<ApiSettings, "apiKey"> & {
  credentialRef?: string;
  apiKey?: string;
};

/** Marker substring used to mask secrets in UI surfaces. */
const MASKED_KEY_MARKER = "••••";

const DEFAULT_SETTINGS: ApiSettings = {
  backendUrl: resolveSettingsDefaultBackendUrl(),
  apiKey: process.env.API_KEY || "",
  voiceUrl: process.env.VOICE_URL || process.env.NEXT_PUBLIC_VOICE_URL || "",
  voiceModel:
    process.env.VOICE_MODEL || process.env.NEXT_PUBLIC_VOICE_MODEL || "whisper-large-v3-turbo",
};

const syncDirectory = async (value: string): Promise<void> => {
  try {
    const handle = await open(value, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (source) {
    const code = (source as NodeJS.ErrnoException).code;
    if (
      process.platform === "win32" &&
      ["EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(code ?? "")
    ) {
      return;
    }
    throw source;
  }
};

export async function getApiSettings(): Promise<ApiSettings> {
  const settingsFile = resolveSettingsFilePath();
  if (!existsSync(settingsFile)) return DEFAULT_SETTINGS;
  let saved: Partial<PersistedApiSettings>;
  try {
    saved = JSON.parse(await readFile(settingsFile, "utf-8")) as Partial<PersistedApiSettings>;
  } catch (error) {
    console.error(`[API Settings] Failed to read ${settingsFile}:`, error);
    return DEFAULT_SETTINGS;
  }
  const backendUrl = saved.backendUrl || DEFAULT_SETTINGS.backendUrl;
  const legacyApiKey = saved.apiKey?.trim() ?? "";
  if (legacyApiKey) {
    await writeControllerCredential(backendUrl, legacyApiKey);
    await saveSettingsMetadata({
      backendUrl,
      voiceUrl: saved.voiceUrl || DEFAULT_SETTINGS.voiceUrl,
      voiceModel: saved.voiceModel || DEFAULT_SETTINGS.voiceModel,
      credentialRef: controllerCredentialReference(backendUrl),
    });
  }
  return {
    backendUrl,
    apiKey: (await readControllerCredential(backendUrl)) || legacyApiKey || DEFAULT_SETTINGS.apiKey,
    voiceUrl: saved.voiceUrl || DEFAULT_SETTINGS.voiceUrl,
    voiceModel: saved.voiceModel || DEFAULT_SETTINGS.voiceModel,
  };
}

async function saveSettingsMetadata(settings: PersistedApiSettings): Promise<void> {
  resolveDataDir();
  const settingsFile = resolveSettingsFilePath();
  const { apiKey: _apiKey, ...metadata } = settings;
  const payload = JSON.stringify(metadata, null, 2);
  const tempFile = `${settingsFile}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tempFile, payload, "utf-8");
    await chmod(tempFile, 0o600).catch(() => undefined);
    const temporaryHandle = await open(tempFile, "r");
    try {
      await temporaryHandle.sync();
    } finally {
      await temporaryHandle.close();
    }
    await rename(tempFile, settingsFile);
    await syncDirectory(resolveDataDir());
  } catch (source) {
    await unlink(tempFile).catch(() => undefined);
    throw source;
  }
}

export async function saveApiSettings(settings: ApiSettings): Promise<void> {
  await writeControllerCredential(settings.backendUrl, settings.apiKey);
  await saveSettingsMetadata({
    backendUrl: settings.backendUrl,
    credentialRef: controllerCredentialReference(settings.backendUrl),
    voiceUrl: settings.voiceUrl,
    voiceModel: settings.voiceModel,
  });
}

// Mask API key for display (show first 4 and last 4 chars)
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

// Validate a partial update, merge it over persisted settings (preserving
// unchanged values, ignoring a masked API key), and persist. Throws
// `InvalidSettingsError` when a provided URL is malformed.
export async function applySettingsUpdate(update: Partial<ApiSettings>): Promise<ApiSettings> {
  const { backendUrl, apiKey, voiceUrl, voiceModel } = update;

  if (backendUrl && !isValidUrl(backendUrl)) {
    throw new InvalidSettingsError("Invalid backend URL format");
  }
  if (voiceUrl && !isValidUrl(voiceUrl)) {
    throw new InvalidSettingsError("Invalid voice URL format");
  }

  const current = await getApiSettings();
  const nextBackendUrl = backendUrl || current.backendUrl;
  const existingTargetCredential =
    nextBackendUrl === current.backendUrl
      ? current.apiKey
      : await readControllerCredential(nextBackendUrl);
  const next: ApiSettings = {
    backendUrl: nextBackendUrl,
    apiKey: apiKey && !apiKey.includes(MASKED_KEY_MARKER) ? apiKey : existingTargetCredential,
    voiceUrl: voiceUrl || current.voiceUrl,
    voiceModel: voiceModel || current.voiceModel,
  };

  await saveApiSettings(next);
  return next;
}

/** Public-facing settings shape: API key masked, plus a `hasApiKey` flag. */
export function maskedSettingsView(settings: ApiSettings) {
  return {
    backendUrl: settings.backendUrl,
    apiKey: maskApiKey(settings.apiKey),
    hasApiKey: Boolean(settings.apiKey),
    credentialStorage: controllerCredentialStorageStatus(),
    voiceUrl: settings.voiceUrl,
    voiceModel: settings.voiceModel,
  };
}
