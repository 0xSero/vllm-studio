import { Schema } from "effect";
import { MessagingProviderSchema } from "./messaging-account-contract";

export const MessagingPairingSchema = Schema.Struct({
  id: Schema.String,
  provider: MessagingProviderSchema,
  accountId: Schema.String,
  externalUserId: Schema.String,
  label: Schema.NullOr(Schema.String),
  expiresAt: Schema.String,
  failures: Schema.Number,
});

export const MessagingAllowedUserSchema = Schema.Struct({
  provider: MessagingProviderSchema,
  accountId: Schema.String,
  externalUserId: Schema.String,
  label: Schema.NullOr(Schema.String),
  approvedAt: Schema.String,
  lastSeenAt: Schema.String,
});

export const MessagingAccessResponseSchema = Schema.Struct({
  pending: Schema.Array(MessagingPairingSchema),
  allowed: Schema.Array(MessagingAllowedUserSchema),
});

export type MessagingAccessResponse = typeof MessagingAccessResponseSchema.Type;
export type MessagingPairing = typeof MessagingPairingSchema.Type;
export type MessagingAllowedUser = typeof MessagingAllowedUserSchema.Type;
