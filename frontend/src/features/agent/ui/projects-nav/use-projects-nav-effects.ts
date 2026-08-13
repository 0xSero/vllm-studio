import { useCallback, useSyncExternalStore } from "react";

import {
  ADD_PROJECT_EVENT,
  SESSION_PREFS_CHANGED_EVENT,
  SESSIONS_CHANGED_EVENT,
} from "@/lib/workspace-events";
import {
  hydrateSessionPrefsFromDesktop,
  loadSessionPrefs,
  type SessionPrefs,
} from "@/features/agent/messages/prefs";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

let cachedSessionPrefs: SessionPrefs = {};
let cachedSessionPrefsKey = "";

function syncSessionPrefsSnapshot(): boolean {
  const next = loadSessionPrefs();
  let nextKey = "";
  try {
    nextKey = JSON.stringify(next);
  } catch {
    nextKey = "";
  }
  if (nextKey === cachedSessionPrefsKey) return false;
  cachedSessionPrefs = next;
  cachedSessionPrefsKey = nextKey;
  return true;
}

function getSessionPrefsSnapshot(): SessionPrefs {
  syncSessionPrefsSnapshot();
  return cachedSessionPrefs;
}

const SESSION_PREFS_SERVER_SNAPSHOT: SessionPrefs = {};
function getSessionPrefsSnapshotServer(): SessionPrefs {
  return SESSION_PREFS_SERVER_SNAPSHOT;
}

export function useProjectsNavSessionPrefs(): SessionPrefs {
  const subscribeSessionPrefs = useCallback((notify: () => void) => {
    void hydrateSessionPrefsFromDesktop();
    const refresh = () => {
      if (syncSessionPrefsSnapshot()) notify();
    };
    window.addEventListener(SESSION_PREFS_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SESSION_PREFS_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return useSyncExternalStore(
    subscribeSessionPrefs,
    getSessionPrefsSnapshot,
    getSessionPrefsSnapshotServer,
  );
}

export function useProjectDirectoryPickerModalEffects({
  loadDirectory,
  open,
}: {
  loadDirectory: (directoryPath?: string) => Promise<void>;
  open: boolean;
}): void {
  useMountSubscription(() => {
    if (!open) return;
    void loadDirectory();
  }, [open, loadDirectory]);
}

export function useProjectsNavAddProjectEffect(handleAddProject: () => void): void {
  useMountSubscription(() => {
    window.addEventListener(ADD_PROJECT_EVENT, handleAddProject);
    return () => window.removeEventListener(ADD_PROJECT_EVENT, handleAddProject);
  }, [handleAddProject]);
}

const SESSIONS_RELOAD_DEBOUNCE_MS = 300;
const SESSIONS_RECONCILE_MS = 5_000;
const sessionReloads = new Set<() => Promise<void>>();
let sessionsReloadTimer: number | undefined;
let sessionsReconcileTimer: number | undefined;
let sessionsReloadRunning = false;
let sessionsReloadPending = false;

function armSessionsReconciliation(): void {
  window.clearTimeout(sessionsReconcileTimer);
  sessionsReconcileTimer = undefined;
  if (sessionReloads.size === 0 || document.visibilityState !== "visible") return;
  sessionsReconcileTimer = window.setTimeout(scheduleSessionsReload, SESSIONS_RECONCILE_MS);
}

function scheduleSessionsReload(): void {
  if (document.visibilityState !== "visible") return;
  window.clearTimeout(sessionsReloadTimer);
  window.clearTimeout(sessionsReconcileTimer);
  sessionsReloadTimer = undefined;
  sessionsReconcileTimer = undefined;
  if (sessionsReloadRunning) {
    sessionsReloadPending = true;
    return;
  }
  sessionsReloadTimer = window.setTimeout(() => {
    sessionsReloadTimer = undefined;
    sessionsReloadRunning = true;
    void Promise.allSettled([...sessionReloads].map((reload) => reload())).then(() => {
      sessionsReloadRunning = false;
      if (sessionsReloadPending) {
        sessionsReloadPending = false;
        scheduleSessionsReload();
      } else {
        armSessionsReconciliation();
      }
    });
  }, SESSIONS_RELOAD_DEBOUNCE_MS);
}

function syncSessionsReconciliation(): void {
  if (document.visibilityState !== "visible") {
    window.clearTimeout(sessionsReloadTimer);
    window.clearTimeout(sessionsReconcileTimer);
    sessionsReloadTimer = undefined;
    sessionsReconcileTimer = undefined;
    return;
  }
  scheduleSessionsReload();
}

export function useProjectSessionsReloadEffect(reload: () => Promise<void>): void {
  useMountSubscription(() => {
    const ownsReloadEvents = sessionReloads.size === 0;
    sessionReloads.add(reload);
    if (ownsReloadEvents) {
      window.addEventListener(SESSIONS_CHANGED_EVENT, scheduleSessionsReload);
      window.addEventListener("focus", scheduleSessionsReload);
      document.addEventListener("visibilitychange", syncSessionsReconciliation);
    }
    void reload();
    armSessionsReconciliation();
    return () => {
      sessionReloads.delete(reload);
      if (sessionReloads.size > 0) return;
      sessionsReloadPending = false;
      window.clearTimeout(sessionsReloadTimer);
      window.clearTimeout(sessionsReconcileTimer);
      sessionsReloadTimer = undefined;
      sessionsReconcileTimer = undefined;
      window.removeEventListener(SESSIONS_CHANGED_EVENT, scheduleSessionsReload);
      window.removeEventListener("focus", scheduleSessionsReload);
      document.removeEventListener("visibilitychange", syncSessionsReconciliation);
    };
  }, [reload]);
}
