import { Schema } from "effect";

export const MessagingProviderSchema = Schema.Literals(["telegram", "discord"]);

export const MessagingAccountSchema = Schema.Struct({
  id: Schema.String,
  provider: MessagingProviderSchema,
  label: Schema.String,
  subject: Schema.String,
  connectedAt: Schema.String,
  secretProvider: Schema.String,
});

export const MessagingAccountsResponseSchema = Schema.Struct({
  accounts: Schema.Array(MessagingAccountSchema),
});

export type MessagingProvider = typeof MessagingProviderSchema.Type;
export type MessagingAccount = typeof MessagingAccountSchema.Type;
