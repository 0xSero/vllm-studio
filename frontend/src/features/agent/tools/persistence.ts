import { Schema } from "effect";
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

const KEYS = {
  browser: "local-studio.agent.browserToolEnabled",
  browserBackend: "local-studio.agent.browserBackend",
  browserMigration: "***************************************************",
  browserOpen: "local-studio.agent.computer.browserOpen",
  filesOpen: "local-studio.agent.computer.filesOpen",
  computerMigration: "local-studio.agent.computer.defaultCollapsedV2",
  width: "local-studio.agent.computer.width",
  tab: "local-studio.agent.computer.tab",
  tabs: "local-studio.agent.computer.tabs",
  terminals: "local-studio.agent.terminals.v1",
  activeTerminal: "local-studio.agent.terminals.activeOwner",
} as const;

export const DEFAULT_BROWSER_URL = "about:blank";
export const DEFAULT_COMPUTER_WIDTH = 440;
export const MIN_COMPUTER_WIDTH = 280;
export const MAX_COMPUTER_WIDTH = 1200;
const SNAP_WIDTHS = [360, 440, 520, 720, 960] as const;

const TerminalOwnerSchema = Schema.Struct({
  mountKey: Schema.String,
  matchKeys: Schema.Array(Schema.String),
  cwd: Schema.NullOr(Schema.String),
  title: Schema.String,
  kind: Schema.Literals(["project", "session"]),
  sessionId: Schema.optional(Schema.NullOr(Schema.String)),
  piSessionId: Schema.optional(Schema.NullOr(Schema.String)),
  projectId: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodeTerminalOwners = Schema.decodeUnknownOption(Schema.Array(TerminalOwnerSchema));

export type PersistedToolState = {
  browser: BrowserState;
  computer: ComputerState;
  terminals: TerminalOwnersState;
};

function widthBounds(
  containerWidth = typeof window === "undefined" ? undefined : window.innerWidth,
) {
  if (!containerWidth || !Number.isFinite(containerWidth)) {
    return { min: MIN_COMPUTER_WIDTH, max: MAX_COMPUTER_WIDTH };
  }
  const min = Math.min(MIN_COMPUTER_WIDTH, containerWidth);
  return {
    min,
    max: Math.max(
      min,
      Math.min(MAX_COMPUTER_WIDTH, Math.round(containerWidth * 0.7), containerWidth - 360),
    ),
  };
}

export function clampComputerWidth(width: number, containerWidth?: number): number {
  if (!Number.isFinite(width)) return DEFAULT_COMPUTER_WIDTH;
  const { min, max } = widthBounds(containerWidth);
  return Math.min(max, Math.max(min, Math.round(width)));
}

export function gentlySnapComputerWidth(width: number, containerWidth: number): number {
  const clamped = clampComputerWidth(width, containerWidth);
  const { min, max } = widthBounds(containerWidth);
  const nearest = SNAP_WIDTHS.filter((value) => value >= min && value <= max).reduce<number | null>(
    (best, value) =>
      best === null || Math.abs(value - clamped) < Math.abs(best - clamped) ? value : best,
    null,
  );
  const threshold = Math.max(14, Math.min(30, Math.round(containerWidth * 0.015)));
  return nearest !== null && Math.abs(nearest - clamped) <= threshold ? nearest : clamped;
}

function computerTab(value: unknown): ComputerTab | null {
  return typeof value === "string"
    ? (COMPUTER_TAB_IDS.find((candidate) => candidate === value) ?? null)
    : null;
}

export function uniqueComputerTabs(values: readonly ComputerTab[]): ComputerTab[] {
  const tabs = [...new Set(values)];
  return tabs.includes("status") ? tabs : ["status", ...tabs];
}

export function computerPanelVisibility(current: ComputerState, open: boolean): ComputerState {
  const tabs = uniqueComputerTabs(current.tabs.length ? current.tabs : ["status"]);
  return current.open === open && tabs.length === current.tabs.length
    ? current
    : { ...current, open, tabs };
}

function terminalOwners(value: unknown): TerminalOwner[] | null {
  const decoded = decodeTerminalOwners(value);
  if (decoded._tag === "None") return null;
  return decoded.value.reduce<TerminalOwner[]>((owners, value) => {
    const mountKey = value.mountKey.trim();
    if (!mountKey) return owners;
    const owner: TerminalOwner = {
      ...value,
      mountKey,
      matchKeys: mergeTerminalKeys([mountKey], [...value.matchKeys]),
      cwd: value.cwd?.trim() || null,
      title: value.title.trim() || "Terminal",
    };
    if (!owners.some((candidate) => terminalKeysMatch(candidate.matchKeys, owner.matchKeys))) {
      owners.push(owner);
    }
    return owners;
  }, []);
}

function migrate(): void {
  if (!readStored(KEYS.browserMigration)) {
    writeStored(KEYS.browser, "0");
    writeStored(KEYS.browserMigration, "1");
  }
  if (!readStored(KEYS.computerMigration)) {
    writeStored(KEYS.browserOpen, "0");
    writeStored(KEYS.filesOpen, "0");
    writeStored(KEYS.computerMigration, "1");
  }
  writeStored(KEYS.browserOpen, "0");
  removeStored("local-studio.agent.sessionsCollapsed");
}

export function loadToolState(): PersistedToolState {
  migrate();
  const tab = computerTab(readStored(KEYS.tab)) ?? "status";
  const rawTabs = readStoredJson<unknown[]>(KEYS.tabs, [], (value) =>
    Array.isArray(value) ? value : null,
  );
  const tabs = uniqueComputerTabs([
    ...rawTabs.flatMap((value) => {
      const resolved = computerTab(value);
      return resolved ? [resolved] : [];
    }),
    tab,
  ]);
  const owners = readStoredJson<TerminalOwner[]>(KEYS.terminals, [], terminalOwners);
  const activeOwnerKey = readStored(KEYS.activeTerminal);
  const backend: BrowserBackend =
    readStored(KEYS.browserBackend) === "sitegeist" ? "sitegeist" : "embedded";
  return {
    browser: {
      enabled: readStored(KEYS.browser) === "1",
      backend,
      url: DEFAULT_BROWSER_URL,
      input: DEFAULT_BROWSER_URL,
    },
    computer: {
      open: false,
      tab,
      tabs,
      width: clampComputerWidth(Number(readStored(KEYS.width))),
    },
    terminals: {
      owners,
      activeOwnerKey: owners.some((owner) => owner.mountKey === activeOwnerKey)
        ? activeOwnerKey
        : (owners[0]?.mountKey ?? null),
    },
  };
}

export function writeToolState(state: PersistedToolState): void {
  writeStored(KEYS.browser, state.browser.enabled ? "1" : "0");
  writeStored(KEYS.browserBackend, state.browser.backend);
  writeStored(KEYS.filesOpen, state.computer.tab === "files" ? "1" : "0");
  writeStored(KEYS.tab, state.computer.tab);
  writeStored(KEYS.tabs, JSON.stringify(uniqueComputerTabs(state.computer.tabs)));
  writeStored(KEYS.width, String(clampComputerWidth(state.computer.width)));
  writeStored(KEYS.terminals, JSON.stringify(state.terminals.owners));
  if (state.terminals.activeOwnerKey) {
    writeStored(KEYS.activeTerminal, state.terminals.activeOwnerKey);
  } else {
    removeStored(KEYS.activeTerminal);
  }
}
