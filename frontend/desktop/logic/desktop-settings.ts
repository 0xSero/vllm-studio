import { app } from "electron";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../helpers/fs-json";
import { Schema } from "effect";

/** Main-process-owned settings (hotkeys, window sizes) — separate from the
 * renderer-owned ui-preferences.json, which the renderer rewrites wholesale. */

export interface QuickPanelSize {
  width: number;
  height: number;
}

interface DesktopSettings {
  quickPanelHotkey?: string;
  quickPanelThreadSize?: QuickPanelSize;
}

const DesktopSettingsFileSchema = Schema.Record(Schema.String, Schema.Unknown);
type DesktopSettingsFile = typeof DesktopSettingsFileSchema.Type;
const QuickPanelSizeSchema = Schema.Struct({ width: Schema.Number, height: Schema.Number });
const decodeDesktopSettingsFile = Schema.decodeUnknownSync(
  Schema.fromJsonString(DesktopSettingsFileSchema),
);
const decodeQuickPanelSize = Schema.decodeUnknownOption(QuickPanelSizeSchema);
const isString = Schema.is(Schema.String);

const MIN_THREAD_SIZE: QuickPanelSize = { width: 320, height: 280 };

function settingsFilePath(): string {
  return path.join(app.getPath("userData"), "desktop-settings.json");
}

function readSettings(): DesktopSettingsFile {
  try {
    const filePath = settingsFilePath();
    return existsSync(filePath) ? decodeDesktopSettingsFile(readFileSync(filePath, "utf8")) : {};
  } catch {
    return {};
  }
}

function writeSettings(patch: Partial<DesktopSettings>): void {
  writeJsonAtomic(settingsFilePath(), { ...readSettings(), ...patch });
}

export function getStoredQuickPanelHotkey(): string | null {
  const hotkey = readSettings().quickPanelHotkey;
  if (!isString(hotkey)) return null;
  const trimmed = hotkey.trim();
  return trimmed || null;
}

export function setStoredQuickPanelHotkey(hotkey: string): void {
  writeSettings({ quickPanelHotkey: hotkey });
}

export function getStoredQuickPanelThreadSize(): QuickPanelSize | null {
  const decoded = decodeQuickPanelSize(readSettings().quickPanelThreadSize);
  if (decoded._tag === "None") return null;
  const { width, height } = decoded.value;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return {
    width: Math.max(MIN_THREAD_SIZE.width, Math.round(width)),
    height: Math.max(MIN_THREAD_SIZE.height, Math.round(height)),
  };
}

export function setStoredQuickPanelThreadSize(size: QuickPanelSize): void {
  writeSettings({ quickPanelThreadSize: size });
}

export { MIN_THREAD_SIZE as QUICK_PANEL_MIN_THREAD_SIZE };
