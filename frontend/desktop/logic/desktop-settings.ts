import { app } from "electron";
import { Schema } from "effect";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  WINDOW_TRANSPARENCY_DEFAULT,
  WindowAppearancePreferenceSchema,
  type WindowAppearancePreference,
} from "../window-appearance-contract";
import { writeJsonAtomic } from "../helpers/fs-json";
import { DesktopUpdateChannelSchema, type DesktopUpdateChannel } from "../types";

/** Main-process-owned settings (hotkeys, window sizes) — separate from the
 * renderer-owned ui-preferences.json, which the renderer rewrites wholesale. */

export interface QuickPanelSize {
  width: number;
  height: number;
}

interface DesktopSettings {
  quickPanelHotkey?: string;
  quickPanelThreadSize?: QuickPanelSize;
  updateChannel?: DesktopUpdateChannel;
  windowAppearance?: WindowAppearancePreference;
}

const MIN_THREAD_SIZE: QuickPanelSize = { width: 320, height: 280 };
const DEFAULT_WINDOW_APPEARANCE: WindowAppearancePreference = {
  material: "subtle",
  transparency: WINDOW_TRANSPARENCY_DEFAULT,
};
const QuickPanelSizeSchema = Schema.Struct({ width: Schema.Number, height: Schema.Number });
const DesktopSettingsSchema = Schema.Struct({
  quickPanelHotkey: Schema.optional(Schema.String),
  quickPanelThreadSize: Schema.optional(QuickPanelSizeSchema),
  updateChannel: Schema.optional(DesktopUpdateChannelSchema),
  windowAppearance: Schema.optional(WindowAppearancePreferenceSchema),
});

function settingsFilePath(): string {
  return path.join(app.getPath("userData"), "desktop-settings.json");
}

function readSettings(): DesktopSettings {
  try {
    const filePath = settingsFilePath();
    if (!existsSync(filePath)) return {};
    return Schema.decodeUnknownSync(DesktopSettingsSchema)(
      JSON.parse(readFileSync(filePath, "utf8")) as unknown,
    );
  } catch {
    return {};
  }
}

function writeSettings(patch: Partial<DesktopSettings>): void {
  writeJsonAtomic(settingsFilePath(), { ...readSettings(), ...patch });
}

export function getStoredQuickPanelHotkey(): string | null {
  const hotkey = readSettings().quickPanelHotkey;
  return typeof hotkey === "string" && hotkey.trim() ? hotkey.trim() : null;
}

export function setStoredQuickPanelHotkey(hotkey: string): void {
  writeSettings({ quickPanelHotkey: hotkey });
}

export function getStoredQuickPanelThreadSize(): QuickPanelSize | null {
  const size = readSettings().quickPanelThreadSize;
  if (!size || typeof size !== "object") return null;
  const width = Number(size.width);
  const height = Number(size.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return {
    width: Math.max(MIN_THREAD_SIZE.width, Math.round(width)),
    height: Math.max(MIN_THREAD_SIZE.height, Math.round(height)),
  };
}

export function setStoredQuickPanelThreadSize(size: QuickPanelSize): void {
  writeSettings({ quickPanelThreadSize: size });
}

export function getStoredUpdateChannel(fallback: DesktopUpdateChannel): DesktopUpdateChannel {
  const channel = readSettings().updateChannel;
  return channel === "stable" || channel === "nightly" ? channel : fallback;
}

export function setStoredUpdateChannel(channel: DesktopUpdateChannel): void {
  writeSettings({ updateChannel: channel });
}

export function getStoredWindowAppearance(): WindowAppearancePreference {
  return readSettings().windowAppearance ?? DEFAULT_WINDOW_APPEARANCE;
}

export function setStoredWindowAppearance(appearance: WindowAppearancePreference): void {
  writeSettings({ windowAppearance: appearance });
}

export { MIN_THREAD_SIZE as QUICK_PANEL_MIN_THREAD_SIZE };
