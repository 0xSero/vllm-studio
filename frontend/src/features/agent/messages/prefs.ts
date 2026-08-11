import { SESSION_PREFS_KEY } from "@/features/agent/workspace/store";
import { readStored, readStoredJson, writeStored } from "@/lib/storage";
import { SESSION_PREFS_CHANGED_EVENT } from "@/lib/workspace-events";

export type SessionPref = {
  title?: string;
  pinned?: boolean;
  hidden?: boolean;
};

export type SessionPrefs = Record<string, SessionPref>;

function getDesktopBridge(): {
  loadSessionPrefs(): Promise<SessionPrefs>;
  saveSessionPrefs(prefs: SessionPrefs): Promise<void>;
} | null {
  if (typeof window === "undefined") return null;
  const bridge = (
    window as {
      localStudioDesktop?: {
        loadSessionPrefs?: () => Promise<SessionPrefs>;
        saveSessionPrefs?: (prefs: SessionPrefs) => Promise<void>;
      };
    }
  ).localStudioDesktop;
  if (!bridge?.loadSessionPrefs || !bridge?.saveSessionPrefs) return null;
  return bridge as {
    loadSessionPrefs(): Promise<SessionPrefs>;
    saveSessionPrefs(prefs: SessionPrefs): Promise<void>;
  };
}

/** Fast synchronous read from localStorage. Use this during renders. */
export function loadSessionPrefs(): SessionPrefs {
  return readStoredJson(SESSION_PREFS_KEY, {}, (value) =>
    value && typeof value === "object" ? (value as SessionPrefs) : null,
  );
}

/** One-time bootstrap: if localStorage is empty, restore from the durable
 *  desktop file (survives killall / crash). Call on app startup. */
export async function hydrateSessionPrefsFromDesktop(): Promise<void> {
  if (typeof window === "undefined") return;
  // Only hydrate if localStorage is empty — avoids overwriting newer data.
  if (readStored(SESSION_PREFS_KEY)) return;
  try {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    const prefs = await bridge.loadSessionPrefs();
    if (prefs && typeof prefs === "object" && Object.keys(prefs).length > 0) {
      writeStored(SESSION_PREFS_KEY, JSON.stringify(prefs));
      window.dispatchEvent(new Event(SESSION_PREFS_CHANGED_EVENT));
    }
  } catch {
    /* ignore */
  }
}

export function saveSessionPrefs(prefs: SessionPrefs): void {
  if (typeof window === "undefined") return;
  // Primary: localStorage for fast access.
  writeStored(SESSION_PREFS_KEY, JSON.stringify(prefs));
  // Backup: durable file via Electron main process (survives killall / crash).
  try {
    const bridge = getDesktopBridge();
    if (bridge) void bridge.saveSessionPrefs(prefs).catch(() => {});
  } catch {
    /* ignore if not in Electron */
  }
  window.dispatchEvent(new Event(SESSION_PREFS_CHANGED_EVENT));
}

export function patchSessionPref(piSessionId: string, patch: SessionPref): void {
  patchCanonicalSessionPref(piSessionId, [], patch);
}

function hasSessionPref(pref: SessionPref): boolean {
  return Boolean(pref.title || pref.pinned || pref.hidden);
}

export function patchCanonicalSessionPref(
  primaryKey: string,
  aliasKeys: readonly string[],
  patch: SessionPref = {},
): void {
  if (!primaryKey) return;
  const all = loadSessionPrefs();
  const aliases = [...new Set(aliasKeys.filter((key) => key && key !== primaryKey))];
  if (Object.keys(patch).length === 0 && !aliases.some((key) => hasSessionPref(all[key] ?? {}))) {
    return;
  }
  let current: SessionPref = {};
  for (const key of aliases) current = { ...current, ...(all[key] ?? {}) };
  current = { ...current, ...(all[primaryKey] ?? {}) };
  const next: SessionPref = { ...current, ...patch };
  for (const key of aliases) delete all[key];
  if (hasSessionPref(next)) all[primaryKey] = next;
  else delete all[primaryKey];
  saveSessionPrefs(all);
}

export function isLocalSessionPrefKey(key: string): boolean {
  return key.startsWith("tab:") || key.startsWith("tab-");
}
