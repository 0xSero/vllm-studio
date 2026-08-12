import { Schema } from "effect";

export type SessionSummary = {
  id: string;
  filename: string;
  cwd: string;
  startedAt: string;
  updatedAt: string;
  modelId: string | null;
  provider: string | null;
  firstUserMessage: string | null;
  name: string | null;
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

export const SessionUsageTotalsSchema = Schema.Struct({
  input: Schema.Number,
  output: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
  reasoning: Schema.Number,
  total: Schema.Number,
  cost: Schema.Number,
  calls: Schema.Number,
  compactions: Schema.Number,
});

export type SessionUsageTotals = Schema.Schema.Type<typeof SessionUsageTotalsSchema>;
