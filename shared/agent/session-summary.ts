export type SessionSummary = {
  id: string;
  filename: string;
  cwd: string;
  startedAt: string;
  updatedAt: string;
  modelId: string | null;
  provider: string | null;
  firstUserMessage: string | null;
  lastUserPromptText?: string;
  lastUserPromptAt?: string;
  archived: boolean;
  archivedAt: string | null;
  parentSessionId: string | null;
  subagentName: string | null;
};

export type AggregatedSession = SessionSummary & {
  projectId: string;
  projectName: string;
  projectPath: string;
};
