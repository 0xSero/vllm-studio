import { Schema } from "effect";

export const CredentialStoreResponseSchema = Schema.Struct({
  provider: Schema.String,
});

export type CredentialStoreResponse = typeof CredentialStoreResponseSchema.Type;
