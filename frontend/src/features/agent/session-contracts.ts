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
  turnCount: number;
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
export type SessionSortField = "updatedAt" | "turnCount" | "projectName";
