import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

import { safeJson } from "@/lib/agent/safe-json";
import {
  mergeActiveAgentSessions,
  type ActiveAgentSessionSnapshot,
} from "@/lib/agent/active-sessions";
import type { Project as ProjectEntry } from "@/lib/agent/projects/types";
import {
  ACTIVE_AGENT_SESSIONS_EVENT,
  ADD_PROJECT_EVENT,
  SESSION_PREFS_CHANGED_EVENT,
  SESSIONS_CHANGED_EVENT,
} from "@/lib/agent/workspace/events";
import { persistActiveAgentSessions } from "@/lib/agent/workspace/store";
import {
  hydrateSessionPrefsFromDesktop,
  loadSessionPrefs,
  type SessionPrefs,
} from "@/lib/agent/session/prefs";

type SessionSummary = {
  id: string;
  filename: string;
  cwd: string;
  startedAt: string;
  updatedAt: string;
  modelId: string | null;
  provider: string | null;
  firstUserMessage: string | null;
  turnCount: number;
};

type PinnedSession = SessionSummary & { project: ProjectEntry };
type ActiveAgentSession = ActiveAgentSessionSnapshot;

export function useProjectsNavSessionPrefs(): SessionPrefs {
  const [prefs, setPrefs] = useState<SessionPrefs>(() => loadSessionPrefs());
  useEffect(() => {
    void hydrateSessionPrefsFromDesktop();
    const refresh = () =>
      setPrefs((current) => {
        const next = loadSessionPrefs();
        try {
          if (JSON.stringify(current) === JSON.stringify(next)) return current;
        } catch {}
        return next;
      });
    window.addEventListener(SESSION_PREFS_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(SESSION_PREFS_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return prefs;
}

export function useProjectDirectoryPickerModalEffects({
  loadDirectory,
  open,
}: {
  loadDirectory: (directoryPath?: string) => Promise<void>;
  open: boolean;
}): void {
  useEffect(() => {
    if (!open) return;
    void loadDirectory();
  }, [open, loadDirectory]);
}

export function useProjectsNavAddProjectEffect(handleAddProject: () => void): void {
  useEffect(() => {
    window.addEventListener(ADD_PROJECT_EVENT, handleAddProject);
    return () => window.removeEventListener(ADD_PROJECT_EVENT, handleAddProject);
  }, [handleAddProject]);
}

export function useActiveAgentSessionsEffect({
  setActiveSessions,
}: {
  setActiveSessions: Dispatch<SetStateAction<ActiveAgentSession[]>>;
}): void {
  useEffect(() => {
    const onActiveSessions = (event: Event) => {
      const detail = (event as CustomEvent<{ sessions?: ActiveAgentSession[] }>).detail;
      const sessions = Array.isArray(detail?.sessions) ? detail.sessions : [];
      setActiveSessions(
        sessions.length > 0 ? mergeActiveAgentSessions([], sessions, loadSessionPrefs()) : [],
      );
      persistActiveAgentSessions(sessions);
    };
    window.addEventListener(ACTIVE_AGENT_SESSIONS_EVENT, onActiveSessions);
    return () => window.removeEventListener(ACTIVE_AGENT_SESSIONS_EVENT, onActiveSessions);
  }, [setActiveSessions]);
}

export function usePinnedSessionsEffect({
  activePiSessionIdsKey,
  expanded,
  hiddenPrefIdsKey,
  pinnedPrefIdsKey,
  projects,
  setPinnedSessions,
}: {
  activePiSessionIdsKey: string;
  expanded: boolean;
  hiddenPrefIdsKey: string;
  pinnedPrefIdsKey: string;
  projects: ProjectEntry[];
  setPinnedSessions: Dispatch<SetStateAction<PinnedSession[]>>;
}): void {
  useEffect(() => {
    if (!expanded || projects.length === 0) {
      queueMicrotask(() => setPinnedSessions([]));
      return;
    }
    if (!pinnedPrefIdsKey) {
      queueMicrotask(() => setPinnedSessions([]));
      return;
    }
    let cancelled = false;
    const pinnedIdsList = pinnedPrefIdsKey.split("\u0000").filter(Boolean);
    const pinnedIds = new Set(pinnedIdsList);
    const hiddenIds = new Set(hiddenPrefIdsKey.split("\u0000").filter(Boolean));
    const idsParam = encodeURIComponent(pinnedIdsList.join(","));
    (async () => {
      const rows = await Promise.all(
        projects.map(async (project) => {
          try {
            const response = await fetch(
              `/api/agent/sessions?cwd=${encodeURIComponent(project.path)}&since=30d&ids=${idsParam}`,
              { cache: "no-store" },
            );
            const payload = await safeJson<{ sessions?: SessionSummary[] }>(response);
            return (payload.sessions ?? [])
              .filter((session) => pinnedIds.has(session.id) && !hiddenIds.has(session.id))
              .map((session) => ({ ...session, project }));
          } catch {
            return [];
          }
        }),
      );
      if (!cancelled) {
        setPinnedSessions(
          rows
            .flat()
            .sort(
              (a, b) =>
                new Date(b.startedAt || b.updatedAt).getTime() -
                new Date(a.startedAt || a.updatedAt).getTime(),
            ),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activePiSessionIdsKey,
    expanded,
    hiddenPrefIdsKey,
    pinnedPrefIdsKey,
    projects,
    setPinnedSessions,
  ]);
}

export function useProjectSessionsReloadEffect(reload: () => Promise<void>): void {
  useEffect(() => {
    void reload();
    window.addEventListener(SESSIONS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(SESSIONS_CHANGED_EVENT, reload);
  }, [reload]);
}
