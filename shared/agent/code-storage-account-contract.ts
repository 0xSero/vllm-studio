import { Schema } from "effect";

export const CodeStorageAccountEntrySchema = Schema.Struct({
  id: Schema.String,
  organization: Schema.String,
  label: Schema.String,
  connectedAt: Schema.String,
  connectorId: Schema.String,
  secretProvider: Schema.String,
});

export const CodeStorageAccountsResponseSchema = Schema.Struct({
  accounts: Schema.Array(CodeStorageAccountEntrySchema),
});

export const CodeStorageAccountInputSchema = Schema.Struct({
  organization: Schema.String,
  label: Schema.optional(Schema.String),
  privateKey: Schema.String,
  secretProvider: Schema.optional(Schema.String),
});

export type CodeStorageAccountEntry = typeof CodeStorageAccountEntrySchema.Type;
