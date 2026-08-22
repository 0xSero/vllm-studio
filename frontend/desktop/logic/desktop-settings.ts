import { app } from "electron";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "../helpers/fs-json";
import type { DesktopUpdateChannel } from "../types";

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
}

const MIN_THREAD_SIZE: QuickPanelSize = { width: 320, height: 280 };

function settingsFilePath(): string {
  return path.join(app.getPath("userData"), "desktop-settings.json");
}

function readSettings(): DesktopSettings {
  try {
    const filePath = settingsFilePath();
    if (!existsSync(filePath)) return {};
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as DesktopSettings)
      : {};
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

export { MIN_THREAD_SIZE as QUICK_PANEL_MIN_THREAD_SIZE };
