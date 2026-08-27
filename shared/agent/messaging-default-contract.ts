import { Schema } from "effect";

export const MessagingDefaultSchema = Schema.Struct({
  modelId: Schema.String,
  modelRouteId: Schema.String,
});

export type MessagingDefault = typeof MessagingDefaultSchema.Type;
