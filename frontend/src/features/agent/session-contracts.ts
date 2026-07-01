// Client-side session contracts shared between sessions-page, sessions-command,
// and the API route. Kept separate from server-only imports so client bundles
// don't pull in route-handler code.

export type AggregatedSession = {
  id: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  modelId: string | null;
  firstUserMessage: string | null;
  startedAt: string;
  updatedAt: string;
  filename: string;
};

export type ActiveSession = {
  projectId: string;
  cwd: string;
  paneId: string;
  tabId: string;
  piSessionId: string | null;
  title: string;
  status: string;
  focused?: boolean;
  updatedAt: string;
};

/** Sort fields for the sessions table (distinct from the usage-table SortField). */
export type SessionSortField = "updatedAt" | "projectName";

/**
 * Index active (in-pane) sessions by their pi session id, so a stored session
 * can be matched to one currently running in a pane. Sessions without a
 * piSessionId yet are skipped.
 */
export function indexActiveByPiId(
  activeSessions: readonly ActiveSession[],
): Map<string, ActiveSession> {
  const map = new Map<string, ActiveSession>();
  for (const session of activeSessions) {
    if (session.piSessionId) map.set(session.piSessionId, session);
  }
  return map;
}
