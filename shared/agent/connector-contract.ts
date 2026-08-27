import { Schema } from "effect";

const StringRecordSchema = Schema.Record(Schema.String, Schema.String);
const SecretFlagsSchema = Schema.Record(Schema.String, Schema.Boolean);

const ConnectorRuntimeSchema = Schema.Struct({
  kind: Schema.Union([Schema.Literal("node"), Schema.Literal("python")]),
  package: Schema.String,
  version: Schema.String,
  executable: Schema.String,
  with: Schema.optional(Schema.Array(Schema.String)),
});

const ConnectorOriginSchema = Schema.Struct({
  kind: Schema.String,
  id: Schema.String,
  version: Schema.optional(Schema.String),
  binding: Schema.optional(Schema.String),
});

const ConnectorAuthReferenceSchema = Schema.Struct({
  type: Schema.Union([Schema.Literal("oauth"), Schema.Literal("credential")]),
  provider: Schema.String,
  account: Schema.String,
});

const ConnectorFields = {
  id: Schema.String,
  name: Schema.String,
  transport: Schema.Union([Schema.Literal("stdio"), Schema.Literal("http")]),
  protocolEra: Schema.optional(
    Schema.Union([Schema.Literal("modern"), Schema.Literal("auto"), Schema.Literal("legacy")]),
  ),
  runtime: Schema.optional(ConnectorRuntimeSchema),
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(StringRecordSchema),
  envSecret: Schema.optional(SecretFlagsSchema),
  cwd: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  headers: Schema.optional(StringRecordSchema),
  headerSecret: Schema.optional(SecretFlagsSchema),
  auth: Schema.optional(ConnectorAuthReferenceSchema),
  allowTools: Schema.optional(Schema.Array(Schema.String)),
  origin: Schema.optional(ConnectorOriginSchema),
  enabled: Schema.Boolean,
};

const CatalogEnvironmentFieldSchema = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  placeholder: Schema.optional(Schema.String),
  secret: Schema.Boolean,
});

export const McpCatalogEntrySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  company: Schema.String,
  description: Schema.String,
  protocolEra: Schema.Union([
    Schema.Literal("modern"),
    Schema.Literal("auto"),
    Schema.Literal("legacy"),
  ]),
  transport: Schema.Union([
    Schema.Literal("builtin"),
    Schema.Literal("stdio"),
    Schema.Literal("http"),
  ]),
  runtime: Schema.optional(ConnectorRuntimeSchema),
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  url: Schema.optional(Schema.String),
  state: Schema.Union([
    Schema.Literal("stateless"),
    Schema.Literal("stateful"),
    Schema.Literal("remote"),
    Schema.Literal("controller-owned"),
    Schema.Literal("account-managed"),
    Schema.Literal("policy-disabled"),
  ]),
  filesystemAccess: Schema.Boolean,
  recommended: Schema.Boolean,
  installable: Schema.Boolean,
  requiredConfiguration: Schema.Array(Schema.String),
  envFields: Schema.Array(CatalogEnvironmentFieldSchema),
  authProvider: Schema.optional(Schema.String),
  unavailableReason: Schema.optional(Schema.String),
});

export const McpCatalogSchema = Schema.Struct({
  source: Schema.String,
  profile: Schema.String,
  entries: Schema.Array(McpCatalogEntrySchema),
});

const ConnectorConfigSchema = Schema.Struct(ConnectorFields);
export const ConnectorViewSchema = Schema.Struct({
  ...ConnectorFields,
  secret_keys: Schema.Array(Schema.String),
});
export const ConnectorsFileSchema = Schema.Struct({
  connectors: Schema.optional(Schema.Array(ConnectorConfigSchema)),
});
export const ConnectorsResponseSchema = Schema.Struct({
  connectors: Schema.Array(ConnectorViewSchema),
  catalog: McpCatalogSchema,
});
export const ConnectorUpsertInputSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  transport: Schema.Union([Schema.Literal("stdio"), Schema.Literal("http")]),
  protocolEra: Schema.optional(
    Schema.Union([Schema.Literal("modern"), Schema.Literal("auto"), Schema.Literal("legacy")]),
  ),
  runtime: Schema.optional(ConnectorRuntimeSchema),
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(StringRecordSchema),
  envSecret: Schema.optional(SecretFlagsSchema),
  cwd: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  headers: Schema.optional(StringRecordSchema),
  headerSecret: Schema.optional(SecretFlagsSchema),
  allowTools: Schema.optional(Schema.Array(Schema.String)),
  enabled: Schema.optional(Schema.Boolean),
});
export const ConnectorTestInputSchema = Schema.Struct({ id: Schema.String });
export const ConnectorTestResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
  tool_count: Schema.Number,
  tool_names: Schema.Array(Schema.String),
  error: Schema.optional(Schema.String),
});
export type ConnectorRuntime = typeof ConnectorRuntimeSchema.Type;
export type ConnectorOrigin = typeof ConnectorOriginSchema.Type;
export type ConnectorAuthReference = typeof ConnectorAuthReferenceSchema.Type;
export type ConnectorConfig = typeof ConnectorConfigSchema.Type;
export type ConnectorView = typeof ConnectorViewSchema.Type;
export type McpCatalog = typeof McpCatalogSchema.Type;
export type McpCatalogEntry = typeof McpCatalogEntrySchema.Type;
