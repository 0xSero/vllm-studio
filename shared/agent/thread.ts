import { Schema } from "effect";

export const ThreadSummarySchema = Schema.Struct({
  id: Schema.String,
  filename: Schema.String,
  cwd: Schema.String,
  startedAt: Schema.String,
  updatedAt: Schema.String,
  modelId: Schema.NullOr(Schema.String),
  provider: Schema.NullOr(Schema.String),
  firstUserMessage: Schema.NullOr(Schema.String),
  archived: Schema.Boolean,
  archivedAt: Schema.NullOr(Schema.String),
  parentSessionId: Schema.NullOr(Schema.String),
  subagentName: Schema.NullOr(Schema.String),
});

export type ThreadSummary = Schema.Schema.Type<typeof ThreadSummarySchema>;

export type ProjectScopedThread = ThreadSummary & {
  projectId: string;
  projectName: string;
  projectPath: string;
};

export const ParentRelationSchema = Schema.Struct({
  parentSessionId: Schema.String,
  subagentName: Schema.NullOr(Schema.String),
});

export type ParentRelation = Schema.Schema.Type<typeof ParentRelationSchema>;

export type ThreadCursor = number;

export const DEFAULT_THREAD_WINDOW_TOKENS = 200_000;

export type ThreadWindowRequest = {
  tail?: number;
  before?: ThreadCursor;
  maxTokens?: number;
};

export const ThreadEntrySchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  timestamp: Schema.optional(Schema.String),
  parentId: Schema.optional(Schema.NullOr(Schema.String)),
});

export type ThreadEntry = Schema.Schema.Type<typeof ThreadEntrySchema>;

export const ThreadItemSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  timestamp: Schema.NullOr(Schema.String),
  parentId: Schema.NullOr(Schema.String),
  role: Schema.NullOr(Schema.String),
  startsTurn: Schema.Boolean,
  tokenEstimate: Schema.Number,
  payload: Schema.Record(Schema.String, Schema.Unknown),
});

export type ThreadItem = Schema.Schema.Type<typeof ThreadItemSchema>;

export const ThreadTurnSchema = Schema.Struct({
  id: Schema.String,
  startedAt: Schema.NullOr(Schema.String),
  startsWithUser: Schema.Boolean,
  tokenEstimate: Schema.Number,
  items: Schema.Array(ThreadItemSchema),
});

export type ThreadTurn = Schema.Schema.Type<typeof ThreadTurnSchema>;

export const ThreadUsageTotalsSchema = Schema.Struct({
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

export type ThreadUsageTotals = Schema.Schema.Type<typeof ThreadUsageTotalsSchema>;

export const ThreadWindowMetaSchema = Schema.Struct({
  title: Schema.NullOr(Schema.String),
  modelId: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(Schema.String),
  piSessionId: Schema.NullOr(Schema.String),
  usage: ThreadUsageTotalsSchema,
  parent: Schema.NullOr(ParentRelationSchema),
});

export type ThreadWindowMeta = Schema.Schema.Type<typeof ThreadWindowMetaSchema>;

export const ThreadWindowSchema = Schema.Struct({
  threadId: Schema.String,
  found: Schema.Boolean,
  turns: Schema.Array(ThreadTurnSchema),
  cursor: Schema.NullOr(Schema.Number),
  activityEventCount: Schema.Number,
  tokenEstimate: Schema.Number,
  meta: Schema.NullOr(ThreadWindowMetaSchema),
});

export type ThreadWindow = Schema.Schema.Type<typeof ThreadWindowSchema>;

export const ThreadWindowResponseSchema = Schema.Struct({
  window: ThreadWindowSchema,
});

export type ThreadListRequest = {
  since?: Date;
  ids?: string[];
  includeArchived?: boolean;
  archivedOnly?: boolean;
  limit?: number;
};

export type ThreadArchiveState = {
  archived: boolean;
  archivedAt: string | null;
};
