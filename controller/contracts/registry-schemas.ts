/**
 * The local-ai-registry's published JSON Schemas (draft 2020-12), vendored so
 * contribution records can be validated against exactly what the registry
 * validates on merge. Source of truth:
 * https://github.com/0xSero/local-ai-registry/tree/main/registry/schema
 */
import common from "./registry-schema/common.schema.json";
import hardware from "./registry-schema/hardware.schema.json";
import index from "./registry-schema/index.schema.json";
import modelInstance from "./registry-schema/model-instance.schema.json";
import model from "./registry-schema/model.schema.json";
import recipe from "./registry-schema/recipe.schema.json";
import speedSweeps from "./registry-schema/speed-sweeps.schema.json";

export const REGISTRY_JSON_SCHEMAS = {
  common,
  hardware,
  index,
  model,
  "model-instance": modelInstance,
  recipe,
  "speed-sweeps": speedSweeps,
} as const;
