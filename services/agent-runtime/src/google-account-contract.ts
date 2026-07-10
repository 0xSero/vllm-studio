import { Schema } from "effect";

export const GoogleConnectionViewSchema = Schema.Struct({
  connected: Schema.Boolean,
  email: Schema.NullOr(Schema.String),
  scopes: Schema.Array(Schema.String),
  resource: Schema.String,
  connectedAt: Schema.NullOr(Schema.String),
});

export const GoogleAccountViewSchema = Schema.Struct({
  configured: Schema.Boolean,
  clientId: Schema.NullOr(Schema.String),
  hasClientSecret: Schema.Boolean,
  connections: Schema.Struct({
    gmail: GoogleConnectionViewSchema,
    "google-calendar": GoogleConnectionViewSchema,
  }),
});

export const GoogleAccountResponseSchema = Schema.Struct({ account: GoogleAccountViewSchema });
export const GoogleAuthorizationResponseSchema = Schema.Struct({ authorizationUrl: Schema.String });

export type GoogleConnectionView = typeof GoogleConnectionViewSchema.Type;
export type GoogleAccountView = typeof GoogleAccountViewSchema.Type;
