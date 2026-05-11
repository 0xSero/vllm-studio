import { sanitizeLocalFileUrl } from "@/lib/sanitize-embedded-browser-url";
import type { ComputerTab, WorkspaceState } from "./types";

export const DEFAULT_BROWSER_URL = "https://www.google.com";
export const DEFAULT_COMPUTER_WIDTH = 440;
export const MIN_COMPUTER_WIDTH = 320;
export const MAX_COMPUTER_WIDTH = 960;

type ComputerTabPayload = { tab: ComputerTab };
type ComputerWidthPayload = { width: number };
type BrowserUrlPayload = { url: string; input?: string };

function isComputerTab(value: unknown): value is ComputerTab {
  return value === "browser" || value === "files" || value === "diff";
}

export function clampComputerWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_COMPUTER_WIDTH;
  return Math.min(MAX_COMPUTER_WIDTH, Math.max(MIN_COMPUTER_WIDTH, Math.round(width)));
}

function encodeFilePath(pathValue: string): string {
  const normalized = pathValue.replace(/\\/g, "/");
  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `file://${withLeadingSlash.split("/").map(encodeURIComponent).join("/")}`;
}

function resolveRelativeFilePath(cwd: string, value: string): string {
  const segments = `${cwd.replace(/\/+$/, "")}/${value}`.split("/");
  const resolved: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return `/${resolved.join("/")}`;
}

function expandHomeFilePath(cwd: string, value: string): string | null {
  const homeMatch = cwd.match(/^(\/Users\/[^/]+|\/home\/[^/]+)(?:\/|$)/);
  if (!homeMatch) return null;
  return `${homeMatch[1]}${value.slice(1)}`;
}

export function normalizeBrowserInput(raw: string, cwd: string): string {
  const value = raw.trim();
  if (!value) return DEFAULT_BROWSER_URL;
  if (/^file:\/\//i.test(value)) {
    return sanitizeLocalFileUrl(value) ?? "";
  }
  if (value.startsWith("~/") && cwd) {
    const expanded = expandHomeFilePath(cwd, value);
    if (expanded) return encodeFilePath(expanded);
  }
  if (value.startsWith("/")) return encodeFilePath(value);
  if ((value.startsWith("./") || value.startsWith("../")) && cwd) {
    return encodeFilePath(resolveRelativeFilePath(cwd, value));
  }
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#].*)?$/i.test(value)) {
    return `http://${value}`;
  }
  if (/^[\w.-]+:\d+([/?#].*)?$/.test(value)) {
    return `http://${value}`;
  }
  if (/^[\w-]+(\.[\w-]+)+([/:?#].*)?$/.test(value)) {
    return `https://${value}`;
  }
  if (value.includes("/") && cwd) {
    return encodeFilePath(resolveRelativeFilePath(cwd, value));
  }
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

export function setComputerTab(state: WorkspaceState, payload: ComputerTabPayload): WorkspaceState {
  if (!isComputerTab(payload.tab)) return state;
  return { ...state, computer: { ...state.computer, tab: payload.tab } };
}

export function setComputerWidth(
  state: WorkspaceState,
  payload: ComputerWidthPayload,
): WorkspaceState {
  if (!Number.isFinite(payload.width)) return state;
  return { ...state, computer: { ...state.computer, width: clampComputerWidth(payload.width) } };
}

export function setComputerOpen(state: WorkspaceState, payload: { open: boolean }): WorkspaceState {
  if (typeof payload.open !== "boolean") return state;
  return { ...state, computer: { ...state.computer, open: payload.open } };
}

export function toggleComputerOpen(state: WorkspaceState): WorkspaceState {
  return { ...state, computer: { ...state.computer, open: !state.computer.open } };
}

export function setBrowserToolEnabled(
  state: WorkspaceState,
  payload: { enabled: boolean },
): WorkspaceState {
  if (typeof payload.enabled !== "boolean") return state;
  return { ...state, browserToolEnabled: payload.enabled };
}

export function toggleBrowserTool(state: WorkspaceState): WorkspaceState {
  return { ...state, browserToolEnabled: !state.browserToolEnabled };
}

export function setBrowserUrl(state: WorkspaceState, payload: BrowserUrlPayload): WorkspaceState {
  if (typeof payload.url !== "string" || !payload.url.trim()) return state;
  return {
    ...state,
    browserUrl: payload.url,
    browserInput: payload.input ?? state.browserInput,
  };
}

export function setBrowserInput(state: WorkspaceState, payload: { input: string }): WorkspaceState {
  if (typeof payload.input !== "string") return state;
  return { ...state, browserInput: payload.input };
}
