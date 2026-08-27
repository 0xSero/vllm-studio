import { Schema } from "effect";

export const HarnessCatalogSchema = Schema.Struct({
  harnesses: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      status: Schema.String,
      selectable: Schema.optional(Schema.Boolean),
      transport: Schema.String,
      nodeCount: Schema.optional(Schema.Number),
      installation: Schema.optional(
        Schema.Union([
          Schema.Null,
          Schema.Struct({
            source: Schema.String,
            executable: Schema.String,
            version: Schema.Union([Schema.Null, Schema.String]),
          }),
        ]),
      ),
      capabilities: Schema.Array(Schema.String),
    }),
  ),
});

export type HarnessCatalog = Schema.Schema.Type<typeof HarnessCatalogSchema>;
export type HarnessCatalogEntry = HarnessCatalog["harnesses"][number];
