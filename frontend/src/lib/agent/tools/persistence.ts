// Storage keys and read/write helpers for tool UI state. The shape of the
// keys matches the historical ones so existing localStorage data still loads.

import type { BrowserState, ComputerState, ComputerTab } from "./types";

export const BROWSER_TOOL_KEY = "vllm-studio.agent.browserToolEnabled";
export const BROWSER_TOOL_DEFAULT_OFF_MIGRATION_KEY =
  "***************************************************";
export const COMPUTER_BROWSER_OPEN_KEY = "vllm-studio.agent.computer.browserOpen";
export const COMPUTER_FILES_OPEN_KEY = "vllm-studio.agent.computer.filesOpen";
export const COMPUTER_DEFAULT_CLOSED_STORAGE_ID =
  "vllm-studio.agent.computer.defaultCollapsedV2";
export const COMPUTER_WIDTH_KEY = "vllm-studio.agent.computer.width";

export const DEFAULT_BROWSER_URL = "https://www.google.com";
export const DEFAULT_COMPUTER_WIDTH = 440;
export const MIN_COMPUTER_WIDTH = 320;
export const MAX_COMPUTER_WIDTH = 960;

export function clampComputerWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_COMPUTER_WIDTH;
  return Math.min(MAX_COMPUTER_WIDTH, Math.max(MIN_COMPUTER_WIDTH, Math.round(width)));
}

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Quota / private mode — keep state in memory only.
  }
}

function remove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore.
  }
}

/** One-shot migrations that clean up older formats. Safe to call repeatedly. */
export function migrateToolStorage(): void {
  if (!read(BROWSER_TOOL_DEFAULT_OFF_MIGRATION_KEY)) {
    write(BROWSER_TOOL_KEY, "0");
    write(BROWSER_TOOL_DEFAULT_OFF_MIGRATION_KEY, "1");
  }
  if (!read(COMPUTER_DEFAULT_CLOSED_STORAGE_ID)) {
    write(COMPUTER_BROWSER_OPEN_KEY, "0");
    write(COMPUTER_FILES_OPEN_KEY, "0");
    write(COMPUTER_DEFAULT_CLOSED_STORAGE_ID, "1");
  }
  // Computer panel always boots closed regardless of last session.
  write(COMPUTER_BROWSER_OPEN_KEY, "0");
  // SESSIONS_COLLAPSED_KEY cleanup is owned by workspace persistence.ts; tools
  // doesn't touch sidebar collapse state.
  remove("vllm-studio.agent.sessionsCollapsed");
}

export function loadBrowserState(): BrowserState {
  return {
    enabled: read(BROWSER_TOOL_KEY) === "1",
    url: DEFAULT_BROWSER_URL,
    input: DEFAULT_BROWSER_URL,
  };
}

export function loadComputerState(): ComputerState {
  const storedWidth = Number(read(COMPUTER_WIDTH_KEY));
  const tab: ComputerTab = read(COMPUTER_FILES_OPEN_KEY) === "1" ? "files" : "browser";
  return {
    open: false,
    tab,
    width: Number.isFinite(storedWidth) ? clampComputerWidth(storedWidth) : DEFAULT_COMPUTER_WIDTH,
  };
}

export function writeBrowserEnabled(enabled: boolean): void {
  write(BROWSER_TOOL_KEY, enabled ? "1" : "0");
}

export function writeComputerTab(tab: ComputerTab): void {
  write(COMPUTER_FILES_OPEN_KEY, tab === "files" ? "1" : "0");
}

export function writeComputerWidth(width: number): void {
  write(COMPUTER_WIDTH_KEY, String(clampComputerWidth(width)));
}
