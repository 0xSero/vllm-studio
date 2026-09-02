import { Schema } from "effect";

const ProjectRecordFields = {
  id: Schema.String,
  name: Schema.String,
  path: Schema.String,
  addedAt: Schema.String,
};

export const ProjectRecordSchema = Schema.Struct(ProjectRecordFields);

export const ProjectEntrySchema = Schema.Struct({
  ...ProjectRecordFields,
  exists: Schema.Boolean,
  hasGit: Schema.Boolean,
  branch: Schema.NullOr(Schema.String),
});

export const ProjectAddSchema = Schema.Struct({ path: Schema.String });

export const ProjectsDocumentSchema = Schema.Struct({
  projects: Schema.Array(ProjectRecordSchema),
});

export const ProjectsResponseSchema = Schema.Struct({
  projects: Schema.Array(ProjectEntrySchema),
});

export const ProjectResponseSchema = Schema.Struct({ project: ProjectEntrySchema });

export type ProjectRecord = typeof ProjectRecordSchema.Type;
export type ProjectEntry = typeof ProjectEntrySchema.Type;
export type ProjectsDocument = typeof ProjectsDocumentSchema.Type;
