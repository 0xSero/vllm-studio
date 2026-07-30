import { Schema } from "effect";

export const NotebookCellOutputSchema = Schema.Struct({
  type: Schema.Literals(["stream", "display_data", "execute_result", "error"]),
  text: Schema.String,
});

export const NotebookCellSchema = Schema.Struct({
  index: Schema.Number,
  cell_type: Schema.Literals(["code", "markdown", "raw"]),
  source: Schema.String,
  execution_count: Schema.NullOr(Schema.Number),
  outputs: Schema.Array(NotebookCellOutputSchema),
});

export const NotebookDocumentSchema = Schema.Struct({
  path: Schema.String,
  revision: Schema.String,
  runtime: Schema.Literals(["jupyter", "python", "node"]),
  kernel_name: Schema.String,
  cells: Schema.Array(NotebookCellSchema),
});

export const NotebookCellPatchSchema = Schema.Struct({
  expected_revision: Schema.String,
  cell_index: Schema.Number,
  source: Schema.String,
  approval_id: Schema.String,
});

export const NotebookCellExecuteSchema = Schema.Struct({
  expected_revision: Schema.String,
  cell_index: Schema.Number,
  approval_id: Schema.String,
  timeout_seconds: Schema.optional(Schema.Number),
});

export const NotebookCellStructureSchema = Schema.Struct({
  expected_revision: Schema.String,
  operation: Schema.Literals(["insert", "delete", "move"]),
  cell_index: Schema.Number,
  cell_type: Schema.optional(Schema.Literals(["code", "markdown", "raw"])),
  direction: Schema.optional(Schema.Literals(["up", "down"])),
  approval_id: Schema.String,
});

export const NotebookApprovalRequestSchema = Schema.Struct({
  actor_id: Schema.optional(Schema.String),
  project_id: Schema.optional(Schema.String),
  expected_revision: Schema.String,
  operation: Schema.Literals(["patch", "execute", "structure"]),
  cell_index: Schema.Number,
});

export const NotebookApprovalSchema = Schema.Struct({
  id: Schema.String,
  actor_id: Schema.String,
  project_id: Schema.String,
  notebook_id: Schema.String,
  expected_revision: Schema.String,
  operation: Schema.Literals(["patch", "execute", "structure"]),
  cell_index: Schema.Number,
  expires_at: Schema.String,
});

export const NotebookInteractionEventSchema = Schema.Struct({
  id: Schema.String,
  notebook_id: Schema.String,
  project_id: Schema.String,
  actor_id: Schema.String,
  operation: Schema.Literals(["inspect", "patch", "execute", "structure"]),
  revision_before: Schema.String,
  revision_after: Schema.String,
  cell_index: Schema.NullOr(Schema.Number),
  approval_id: Schema.NullOr(Schema.String),
  occurred_at: Schema.String,
});

export type NotebookDocument = Schema.Schema.Type<typeof NotebookDocumentSchema>;
export type NotebookCellPatch = Schema.Schema.Type<typeof NotebookCellPatchSchema>;
export type NotebookCellExecute = Schema.Schema.Type<typeof NotebookCellExecuteSchema>;
export type NotebookCellStructure = Schema.Schema.Type<typeof NotebookCellStructureSchema>;
export type NotebookApprovalRequest = Schema.Schema.Type<typeof NotebookApprovalRequestSchema>;
export type NotebookApproval = Schema.Schema.Type<typeof NotebookApprovalSchema>;
export type NotebookInteractionEvent = Schema.Schema.Type<typeof NotebookInteractionEventSchema>;
