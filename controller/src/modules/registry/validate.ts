import Ajv2020 from "ajv/dist/2020";
import { REGISTRY_JSON_SCHEMAS } from "@local-studio/contracts/registry-schemas";

export interface SchemaIssue {
  readonly path: string;
  readonly message: string;
}

export interface SchemaValidation {
  readonly ok: boolean;
  readonly issues: readonly SchemaIssue[];
}

const { common, hardware, index, model, "model-instance": modelInstance, recipe, "speed-sweeps": speedSweeps } = REGISTRY_JSON_SCHEMAS;

const SCHEMA_IDS = [common, hardware, index, model, modelInstance, recipe, speedSweeps] as const;

export const CONTRIBUTION_SCHEMAS = ["model", "model-instance", "recipe"] as const;
export type ContributionSchemaName = (typeof CONTRIBUTION_SCHEMAS)[number];

const SCHEMA_BY_NAME: Record<ContributionSchemaName, unknown> = {
  model,
  "model-instance": modelInstance,
  recipe,
};

const makeAjv = (): Ajv2020 => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  for (const schema of SCHEMA_IDS) ajv.addSchema(schema);
  return ajv;
};

const validators = new Map<ContributionSchemaName, ReturnType<Ajv2020["compile"]>>();

const validatorFor = (name: ContributionSchemaName) => {
  const existing = validators.get(name);
  if (existing) return existing;
  const compiled = makeAjv().compile(SCHEMA_BY_NAME[name]);
  validators.set(name, compiled);
  return compiled;
};

/** Validate a record against the registry's own published JSON Schema. */
export const validateAgainstRegistrySchema = (
  name: ContributionSchemaName,
  record: unknown,
): SchemaValidation => {
  const validate = validatorFor(name);
  const ok = validate(record) as boolean;
  if (ok) return { ok: true, issues: [] };
  const errors = validate.errors ?? [];
  return {
    ok: false,
    issues: errors.map((error) => ({
      path: error.instancePath || "/",
      message: error.message ?? "failed schema validation",
    })),
  };
};

/** Validate every contributed record; the first schema failure blocks sharing. */
export const validateContribution = (records: {
  readonly model?: unknown;
  readonly model_instance: unknown;
  readonly recipe: unknown;
}): SchemaValidation => {
  const issues: SchemaIssue[] = [];
  if (records.model !== undefined) {
    issues.push(...validateAgainstRegistrySchema("model", records.model).issues);
  }
  issues.push(...validateAgainstRegistrySchema("model-instance", records.model_instance).issues);
  issues.push(...validateAgainstRegistrySchema("recipe", records.recipe).issues);
  return { ok: issues.length === 0, issues };
};
