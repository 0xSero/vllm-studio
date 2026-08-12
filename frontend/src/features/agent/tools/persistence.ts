import { COMPUTER_TAB_IDS } from "@/features/agent/tools/resources";
import type {
  BrowserBackend,
  BrowserState,
  ComputerState,
  ComputerTab,
} from "@/features/agent/tools/types";
import {
  mergeTerminalKeys,
  terminalKeysMatch,
  type TerminalOwner,
  type TerminalOwnersState,
} from "@/features/agent/terminal-owners";
import { readStored, readStoredJson, removeStored, writeStored } from "@/lib/storage";

export const BROWSER_TOOL_KEY = "local-studio.agent.browserToolEnabled";
export const BROWSER_BACKEND_KEY = "local-studio.agent.browserBackend";
export const BROWSER_TOOL_DEFAULT_OFF_MIGRATION_KEY =
  "***************************************************";
export const COMPUTER_BROWSER_OPEN_KEY = "local-studio.agent.computer.browserOpen";
export const COMPUTER_FILES_OPEN_KEY = "local-studio.agent.computer.filesOpen";
export const COMPUTER_DEFAULT_CLOSED_STORAGE_ID = "local-studio.agent.computer.defaultCollapsedV2";
export const COMPUTER_WIDTH_KEY = "local-studio.agent.computer.width";
export const COMPUTER_TAB_KEY = "local-studio.agent.computer.tab";
export const COMPUTER_TABS_KEY = "local-studio.agent.computer.tabs";
const TERMINAL_OWNERS_KEY = "local-studio.agent.terminals.v1";
const TERMINAL_ACTIVE_OWNER_KEY = "local-studio.agent.terminals.activeOwner";

export const DEFAULT_BROWSER_URL = "about:blank";
export const DEFAULT_BROWSER_BACKEND: BrowserBackend = "embedded";
export const DEFAULT_COMPUTER_WIDTH = 440;
export const MIN_COMPUTER_WIDTH = 280;
export const MAX_COMPUTER_WIDTH = 1200;
export const MIN_CHAT_WIDTH_WHEN_COMPUTER_OPEN = 360;
export const COMPUTER_SNAP_WIDTHS = [360, 440, 520, 720, 960] as const;

const COMPUTER_TABS: readonly ComputerTab[] = COMPUTER_TAB_IDS;

function viewportWidth(): number | undefined {
  return typeof window === "undefined" ? undefined : window.innerWidth;
}

export function computerWidthBounds(containerWidth = viewportWidth()): {
  min: number;
  max: number;
} {
  if (!containerWidth || !Number.isFinite(containerWidth)) {
    return { min: MIN_COMPUTER_WIDTH, max: MAX_COMPUTER_WIDTH };
  }
  const minimum = Math.min(MIN_COMPUTER_WIDTH, containerWidth);
  const roomyMaximum = Math.round(containerWidth * 0.7);
  const chatSafeMaximum = containerWidth - MIN_CHAT_WIDTH_WHEN_COMPUTER_OPEN;
  return {
    min: minimum,
    max: Math.max(minimum, Math.min(MAX_COMPUTER_WIDTH, roomyMaximum, chatSafeMaximum)),
  };
}

export function clampComputerWidth(width: number, containerWidth?: number): number {
  if (!Number.isFinite(width)) return DEFAULT_COMPUTER_WIDTH;
  const { min, max } = computerWidthBounds(containerWidth);
  return Math.min(max, Math.max(min, Math.round(width)));
}

export function computerSnapWidths(containerWidth: number): number[] {
  const { min, max } = computerWidthBounds(containerWidth);
  return COMPUTER_SNAP_WIDTHS.filter((width) => width >= min && width <= max);
}

export function gentlySnapComputerWidth(width: number, containerWidth: number): number {
  const clamped = clampComputerWidth(width, containerWidth);
  const snapThreshold = Math.max(14, Math.min(30, Math.round(containerWidth * 0.015)));
  const nearest = computerSnapWidths(containerWidth).reduce<number | null>((best, candidate) => {
    if (best === null) return candidate;
    return Math.abs(candidate - clamped) < Math.abs(best - clamped) ? candidate : best;
  }, null);
  if (nearest === null || Math.abs(nearest - clamped) > snapThreshold) return clamped;
  return nearest;
}

export function migrateToolStorage(): void {
  if (!readStored(BROWSER_TOOL_DEFAULT_OFF_MIGRATION_KEY)) {
    writeStored(BROWSER_TOOL_KEY, "0");
    writeStored(BROWSER_TOOL_DEFAULT_OFF_MIGRATION_KEY, "1");
  }
  if (!readStored(COMPUTER_DEFAULT_CLOSED_STORAGE_ID)) {
    writeStored(COMPUTER_BROWSER_OPEN_KEY, "0");
    writeStored(COMPUTER_FILES_OPEN_KEY, "0");
    writeStored(COMPUTER_DEFAULT_CLOSED_STORAGE_ID, "1");
  }
  writeStored(COMPUTER_BROWSER_OPEN_KEY, "0");
  removeStored("local-studio.agent.sessionsCollapsed");
}

function parseTerminalOwner(value: unknown): TerminalOwner | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const mountKey = typeof record.mountKey === "string" ? record.mountKey.trim() : "";
  if (!mountKey) return null;
  const matchKeys = Array.isArray(record.matchKeys)
    ? record.matchKeys.filter((item): item is string => typeof item === "string" && Boolean(item))
    : [];
  return {
    mountKey,
    matchKeys: mergeTerminalKeys([mountKey], matchKeys),
    cwd: typeof record.cwd === "string" && record.cwd.trim() ? record.cwd : null,
    title: typeof record.title === "string" ? record.title.trim() : "Terminal",
    kind: record.kind === "project" ? "project" : "session",
    sessionId: typeof record.sessionId === "string" ? record.sessionId : null,
    piSessionId: typeof record.piSessionId === "string" ? record.piSessionId : null,
    projectId: typeof record.projectId === "string" ? record.projectId : null,
  };
}

export function loadTerminalState(): TerminalOwnersState {
  const owners = readStoredJson<TerminalOwner[]>(TERMINAL_OWNERS_KEY, [], (value) => {
    if (!Array.isArray(value)) return null;
    return value.reduce<TerminalOwner[]>((result, entry) => {
      const owner = parseTerminalOwner(entry);
      if (owner && !result.some((item) => terminalKeysMatch(item.matchKeys, owner.matchKeys))) {
        result.push(owner);
      }
      return result;
    }, []);
  });
  const storedActiveKey = readStored(TERMINAL_ACTIVE_OWNER_KEY)?.trim();
  return {
    owners,
    activeOwnerKey:
      storedActiveKey && owners.some((owner) => owner.mountKey === storedActiveKey)
        ? storedActiveKey
        : (owners[0]?.mountKey ?? null),
  };
}

export function writeTerminalState(state: TerminalOwnersState): void {
  writeStored(TERMINAL_OWNERS_KEY, JSON.stringify(state.owners));
  if (state.activeOwnerKey) writeStored(TERMINAL_ACTIVE_OWNER_KEY, state.activeOwnerKey);
  else removeStored(TERMINAL_ACTIVE_OWNER_KEY);
}

export function loadBrowserState(): BrowserState {
  return {
    enabled: readStored(BROWSER_TOOL_KEY) === "1",
    backend: parseBrowserBackend(readStored(BROWSER_BACKEND_KEY)),
    url: DEFAULT_BROWSER_URL,
    input: DEFAULT_BROWSER_URL,
  };
}

export function loadComputerState(): ComputerState {
  const storedWidth = Number(readStored(COMPUTER_WIDTH_KEY));
  const storedTab = readStored(COMPUTER_TAB_KEY);
  const tab: ComputerTab = isComputerTab(storedTab) ? storedTab : "status";
  const storedTabs = readComputerTabs();
  const persistedTabs = uniqueComputerTabs(["status", ...(storedTabs.length ? storedTabs : [tab])]);
  const tabs = persistedTabs.includes(tab)
    ? persistedTabs
    : uniqueComputerTabs([...persistedTabs, tab]);
  return {
    open: false,
    tab,
    tabs,
    width: Number.isFinite(storedWidth) ? clampComputerWidth(storedWidth) : DEFAULT_COMPUTER_WIDTH,
  };
}

function isComputerTab(value: unknown): value is ComputerTab {
  return typeof value === "string" && COMPUTER_TABS.includes(value as ComputerTab);
}

function readComputerTabs(): ComputerTab[] {
  const raw = readStored(COMPUTER_TABS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? uniqueComputerTabs(parsed.filter(isComputerTab)) : [];
  } catch {
    return [];
  }
}

export function uniqueComputerTabs(tabs: ComputerTab[]): ComputerTab[] {
  const seen = new Set<ComputerTab>();
  const out: ComputerTab[] = [];
  for (const tab of tabs) {
    if (seen.has(tab)) continue;
    seen.add(tab);
    out.push(tab);
  }
  return out.includes("status") ? out : ["status", ...out];
}

export function computerPanelVisibility(current: ComputerState, open: boolean): ComputerState {
  const tabs = uniqueComputerTabs(current.tabs.length ? current.tabs : ["status"]);
  const tabsUnchanged =
    tabs.length === current.tabs.length && tabs.every((tab, index) => tab === current.tabs[index]);
  if (current.open === open && tabsUnchanged) return current;
  return { ...current, open, tabs };
}

export function writeBrowserEnabled(enabled: boolean): void {
  writeStored(BROWSER_TOOL_KEY, enabled ? "1" : "0");
}

function parseBrowserBackend(value: string | null): BrowserBackend {
  return value === "embedded" || value === "sitegeist" ? value : DEFAULT_BROWSER_BACKEND;
}

export function writeBrowserBackend(backend: BrowserBackend): void {
  writeStored(BROWSER_BACKEND_KEY, backend);
}

export function writeComputerTab(tab: ComputerTab): void {
  writeStored(COMPUTER_FILES_OPEN_KEY, tab === "files" ? "1" : "0");
  writeStored(COMPUTER_TAB_KEY, tab);
}

export function writeComputerTabs(tabs: ComputerTab[]): void {
  writeStored(COMPUTER_TABS_KEY, JSON.stringify(uniqueComputerTabs(tabs)));
}

export function writeComputerWidth(width: number): void {
  writeStored(COMPUTER_WIDTH_KEY, String(clampComputerWidth(width)));
}
