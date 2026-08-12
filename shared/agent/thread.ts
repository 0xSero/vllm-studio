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

export type ThreadWindowRequest = {
  tail?: number;
  before?: ThreadCursor;
};

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
