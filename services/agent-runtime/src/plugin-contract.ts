import { Schema } from "effect";

const PluginFields = {
  id: Schema.String,
  file: Schema.String,
  path: Schema.String,
  enabled: Schema.Boolean,
  bytes: Schema.Number,
  updated_at: Schema.String,
  read_only: Schema.Boolean,
  builtin: Schema.optional(Schema.Boolean),
  note: Schema.optional(Schema.String),
};

export const PluginRowSchema = Schema.Struct(PluginFields);

export const PluginsResponseSchema = Schema.Struct({
  directory: Schema.String,
  plugins: Schema.Array(PluginRowSchema),
});

export const PluginSourceResponseSchema = Schema.Struct({
  plugin: PluginRowSchema,
  source: Schema.String,
});

export const PluginUpsertInputSchema = Schema.Struct({
  id: Schema.String,
  source: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
});

export type PluginRow = typeof PluginRowSchema.Type;

export const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;

export const isValidPluginId = (id: string): boolean => PLUGIN_ID_PATTERN.test(id);

export const PLUGIN_TEMPLATE = `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "hello_world",
    label: "Hello world",
    description: "Greets someone by name. Replace this with something useful.",
    parameters: Type.Object({
      name: Type.String({ description: "Who to greet." }),
    }),
    execute: (_id, params) =>
      Promise.resolve({
        content: [{ type: "text", text: \`Hello, \${params.name}!\` }],
        details: { name: params.name },
      }),
  });
}
`;
