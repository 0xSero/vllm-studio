import { Schema } from "effect";
export { default as bundledModelCatalogSource } from "./model-catalog.json";

export const ModelProtocolSchema = Schema.Literals([
  "openai-responses",
  "openai-completions",
]);

export const ModelLabSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  logo: Schema.NullOr(Schema.String),
});

export const ModelCapabilitiesSchema = Schema.Struct({
  input: Schema.mutable(Schema.Array(Schema.Literals(["text", "image", "audio"]))),
  output: Schema.mutable(Schema.Array(Schema.Literals(["text", "image", "audio"]))),
  tools: Schema.Boolean,
  reasoning: Schema.Boolean,
  thinkingLevels: Schema.mutable(
    Schema.Array(
      Schema.Literals(["off", "auto", "minimal", "low", "medium", "high", "xhigh", "max"]),
    ),
  ),
});

export const ModelRouteAliasSchema = Schema.Struct({
  provider: Schema.optional(Schema.String),
  model: Schema.String,
  protocols: Schema.mutable(Schema.Array(ModelProtocolSchema)),
});

export const ModelCatalogModelSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  lab: Schema.String,
  family: Schema.String,
  lifecycle: Schema.Literals(["active", "preview", "deprecated"]),
  aliases: Schema.mutable(Schema.Array(Schema.String)),
  capabilities: ModelCapabilitiesSchema,
  contextWindow: Schema.Number,
  maxOutputTokens: Schema.Number,
  routes: Schema.mutable(Schema.Array(ModelRouteAliasSchema)),
});

export const ModelCatalogSchema = Schema.Struct({
  version: Schema.Number,
  updated: Schema.String,
  labs: Schema.mutable(Schema.Array(ModelLabSchema)),
  models: Schema.mutable(Schema.Array(ModelCatalogModelSchema)),
});

export const ModelRouteOfferSchema = Schema.Struct({
  id: Schema.String,
  providerId: Schema.String,
  label: Schema.String,
  rawModelId: Schema.String,
  status: Schema.Literals(["ready", "stopped", "needs-auth", "offline"]),
  protocols: Schema.mutable(Schema.Array(ModelProtocolSchema)),
  contextWindow: Schema.Number,
  maxOutputTokens: Schema.Number,
  active: Schema.Boolean,
  controllerUrl: Schema.optional(Schema.String),
  controllerName: Schema.optional(Schema.String),
});

export const ModelOfferSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  lab: ModelLabSchema,
  family: Schema.String,
  lifecycle: Schema.Literals(["active", "preview", "deprecated"]),
  capabilities: ModelCapabilitiesSchema,
  contextWindow: Schema.Number,
  maxOutputTokens: Schema.Number,
  routes: Schema.mutable(Schema.Array(ModelRouteOfferSchema)),
  defaultRouteId: Schema.NullOr(Schema.String),
  available: Schema.Boolean,
  custom: Schema.Boolean,
});

export const ModelCatalogResponseSchema = Schema.Struct({
  version: Schema.Number,
  updated: Schema.String,
  models: Schema.mutable(Schema.Array(ModelOfferSchema)),
});

export type ModelProtocol = Schema.Schema.Type<typeof ModelProtocolSchema>;
export type ModelLab = Schema.Schema.Type<typeof ModelLabSchema>;
export type ModelCapabilities = Schema.Schema.Type<typeof ModelCapabilitiesSchema>;
export type ModelCatalogModel = Schema.Schema.Type<typeof ModelCatalogModelSchema>;
export type ModelCatalog = Schema.Schema.Type<typeof ModelCatalogSchema>;
export type ModelRouteOffer = Schema.Schema.Type<typeof ModelRouteOfferSchema>;
export type ModelOffer = Schema.Schema.Type<typeof ModelOfferSchema>;
export type ModelCatalogResponse = Schema.Schema.Type<typeof ModelCatalogResponseSchema>;
