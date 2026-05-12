import { SESSION_PREFS_KEY } from "@/lib/agent/workspace/store";
import { SESSION_PREFS_CHANGED_EVENT } from "@/lib/agent/workspace/events";

export type SessionPref = {
  title?: string;
  pinned?: boolean;
  hidden?: boolean;
};

export type SessionPrefs = Record<string, SessionPref>;

export function loadSessionPrefs(): SessionPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SESSION_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as SessionPrefs) : {};
  } catch {
    return {};
  }
}

export function saveSessionPrefs(prefs: SessionPrefs): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SESSION_PREFS_KEY, JSON.stringify(prefs));
  window.dispatchEvent(new Event(SESSION_PREFS_CHANGED_EVENT));
}

export function patchSessionPref(piSessionId: string, patch: SessionPref): void {
  const all = loadSessionPrefs();
  const current = all[piSessionId] ?? {};
  const next: SessionPref = { ...current, ...patch };
  // Drop the entry entirely once every flag is cleared so localStorage doesn't
  // grow without bound.
  if (!next.title && !next.pinned && !next.hidden) {
    delete all[piSessionId];
  } else {
    all[piSessionId] = next;
  }
  saveSessionPrefs(all);
}

