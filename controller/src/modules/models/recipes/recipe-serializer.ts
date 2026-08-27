import { Option, Schema } from "effect";
import type { Recipe } from "../types";
import type { RecipeExtraArgument } from "@local-studio/contracts/recipes";
import { asRecipeId } from "../types";

const integerSchema = Schema.Number.check(Schema.isInt());

const nullableStringSchema = Schema.Union([Schema.Null, Schema.String]);
export const recipeExtraArgumentSchema: Schema.Codec<RecipeExtraArgument, RecipeExtraArgument> =
  Schema.suspend(() =>
    Schema.Union([
      Schema.Null,
      Schema.Boolean,
      Schema.Number,
      Schema.String,
      Schema.mutable(Schema.Array(recipeExtraArgumentSchema)),
      Schema.Record(Schema.String, recipeExtraArgumentSchema),
    ]),
  );
export const recipeExtraArgumentsSchema = Schema.Record(Schema.String, recipeExtraArgumentSchema);
interface RecipeInput {
  [key: string]: RecipeExtraArgument;
}
type RecipeInputValue = RecipeExtraArgument | undefined;

const decodeRecipeInput = Schema.decodeUnknownSync(recipeExtraArgumentsSchema);

const serveRuntimeSchema = Schema.Struct({
  kind: Schema.Literals(["managed_venv", "system", "docker", "binary"]),
  ref: Schema.String.check(Schema.isNonEmpty()),
  label: Schema.optional(Schema.String),
});

const stringValue = (value: RecipeInputValue): string | null => {
  const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(value));
  return decoded?.trim() || null;
};

const defaultRuntime = (backend: RecipeInputValue): RecipeInput => ({
  kind: "docker",
  ref: stringValue(backend) ?? "vllm",
});

const normalizedRuntime = (data: RecipeInput, extraArguments: RecipeInput): RecipeInput => {
  const runtime = Option.getOrUndefined(
    Schema.decodeUnknownOption(recipeExtraArgumentsSchema)(data["runtime"]),
  );
  if (runtime) {
    const record = { ...runtime };
    if (record["kind"] === "venv") record["kind"] = "managed_venv";
    return record;
  }
  const dockerImage =
    stringValue(extraArguments["docker_image"]) ?? stringValue(extraArguments["docker-image"]);
  if (dockerImage) return { kind: "docker", ref: dockerImage };
  const pythonPath = stringValue(data["python_path"]);
  if (pythonPath) return { kind: "system", ref: pythonPath };
  return defaultRuntime(data["backend"]);
};

// Defense-in-depth range checks: the editor floors these, but a recipe can also
// arrive via the API / DB. A NaN previously failed schema validation and made
// the whole recipe silently vanish; a negative/zero passed straight into the
// engine launch command. Clamp to a valid value instead.
const coercePositiveInt = (
  value: RecipeInputValue,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
): number => {
  if (value === undefined) return fallback;
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
};

const clampFraction = (value: RecipeInputValue, fallback: number): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0.01, parsed));
};

const coerceNullableNumber = (value: RecipeInputValue): number | null =>
  value === undefined || value === null ? null : Number(value);

const decodeOptionalFlag = Schema.decodeUnknownSync(Schema.optional(Schema.Boolean));

const booleanSetting = (
  field: "trust_remote_code" | "enable_auto_tool_choice",
  value: RecipeInputValue,
  fallback: boolean,
): boolean => {
  try {
    return decodeOptionalFlag(value) ?? fallback;
  } catch {
    throw new Error(`Invalid ${field}`);
  }
};

const migrateLegacyFields = (data: RecipeInput, extraArguments: RecipeInput): void => {
  const legacyVision = Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.NullOr(Schema.Boolean))(extraArguments["vision"]),
  );
  if (data["vision"] === undefined && legacyVision !== undefined) data["vision"] = legacyVision;
  delete extraArguments["vision"];

  if (data["backend"] === undefined && data["engine"] !== undefined) {
    data["backend"] = data["engine"];
    delete data["engine"];
  }
  data["runtime"] = normalizedRuntime(data, extraArguments);
  delete extraArguments["docker_image"];
  delete extraArguments["docker-image"];

  if (data["tensor_parallel_size"] === undefined && data["tp"] !== undefined) {
    data["tensor_parallel_size"] = data["tp"];
  }
  if (data["pipeline_parallel_size"] === undefined && data["pp"] !== undefined) {
    data["pipeline_parallel_size"] = data["pp"];
  }
};

const migrateEnvironmentVariables = (data: RecipeInput, extraArguments: RecipeInput): void => {
  if (data["env_vars"] !== undefined) return;
  if (data["env-vars"] !== undefined) {
    if (data["env-vars"]) {
      data["env_vars"] = data["env-vars"];
      delete data["env-vars"];
    }
    return;
  }
  if (data["envVars"] !== undefined) {
    if (data["envVars"]) {
      data["env_vars"] = data["envVars"];
      delete data["envVars"];
    }
    return;
  }
  const legacySource = ["env_vars", "env-vars", "envVars"].find((key) => key in extraArguments);
  if (legacySource) {
    data["env_vars"] = extraArguments[legacySource] ?? null;
    delete extraArguments[legacySource];
  }
};

const knownKeys = new Set([
  "id",
  "name",
  "model_path",
  "vision",
  "backend",
  "runtime",
  "env_vars",
  "tensor_parallel_size",
  "pipeline_parallel_size",
  "max_model_len",
  "gpu_memory_utilization",
  "kv_cache_dtype",
  "max_num_seqs",
  "trust_remote_code",
  "tool_call_parser",
  "reasoning_parser",
  "enable_auto_tool_choice",
  "quantization",
  "dtype",
  "host",
  "port",
  "served_model_name",
  "python_path",
  "extra_args",
  "max_thinking_tokens",
  "thinking_mode",
  "tp",
  "pp",
]);

export const normalizeRecipeInput = (raw: RecipeInput): RecipeInput => {
  const data = { ...raw };
  const extraArguments = {
    ...Option.getOrElse(
      Schema.decodeUnknownOption(recipeExtraArgumentsSchema)(data["extra_args"]),
      () => ({}),
    ),
  } satisfies RecipeInput;
  migrateLegacyFields(data, extraArguments);
  for (const key of ["status", "crash_loop"]) {
    delete data[key];
    delete extraArguments[key];
  }
  migrateEnvironmentVariables(data, extraArguments);
  for (const key of Object.keys(data)) {
    if (!knownKeys.has(key)) {
      extraArguments[key] = data[key] ?? null;
      delete data[key];
    }
  }
  data["extra_args"] = extraArguments;
  return data;
};

export const recipeSchema = Schema.Struct({
  // An empty id would create a ghost recipe that can't be fetched, updated,
  // deleted, or launched (routes address recipes by /recipes/:recipeId).
  id: Schema.String.check(Schema.isNonEmpty()),
  name: Schema.String,
  model_path: Schema.String,
  vision: Schema.Union([Schema.Null, Schema.Boolean]),
  backend: Schema.Literals(["vllm", "sglang", "exllamav3"]),
  runtime: serveRuntimeSchema,
  env_vars: Schema.Union([Schema.Null, Schema.Record(Schema.String, Schema.String)]),
  tensor_parallel_size: integerSchema,
  pipeline_parallel_size: integerSchema,
  max_model_len: integerSchema,
  gpu_memory_utilization: Schema.Number,
  kv_cache_dtype: Schema.String,
  max_num_seqs: integerSchema,
  // Defaults to true (unchanged from before) so launching models that need
  // custom modeling code keeps working out of the box. Security-conscious
  // operators can flip the default off with
  // LOCAL_STUDIO_DEFAULT_TRUST_REMOTE_CODE=false.
  trust_remote_code: Schema.Boolean,
  tool_call_parser: nullableStringSchema,
  reasoning_parser: nullableStringSchema,
  enable_auto_tool_choice: Schema.Boolean,
  quantization: nullableStringSchema,
  dtype: nullableStringSchema,
  host: Schema.String,
  port: integerSchema,
  served_model_name: nullableStringSchema,
  python_path: nullableStringSchema,
  extra_args: Schema.Record(Schema.String, Schema.Unknown),
  max_thinking_tokens: Schema.Union([Schema.Null, integerSchema]),
  thinking_mode: Schema.String,
});

const recipeDefaults = (normalized: RecipeInput): RecipeInput => ({
  ...normalized,
  vision: normalized["vision"] ?? null,
  backend: normalized["backend"] ?? "vllm",
  env_vars: normalized["env_vars"] ?? null,
  tensor_parallel_size: coercePositiveInt(normalized["tensor_parallel_size"], 1),
  pipeline_parallel_size: coercePositiveInt(normalized["pipeline_parallel_size"], 1),
  max_model_len: coercePositiveInt(normalized["max_model_len"], 32768),
  gpu_memory_utilization: clampFraction(normalized["gpu_memory_utilization"], 0.9),
  kv_cache_dtype: normalized["kv_cache_dtype"] ?? "auto",
  max_num_seqs: coercePositiveInt(normalized["max_num_seqs"], 256),
  trust_remote_code: booleanSetting(
    "trust_remote_code",
    normalized["trust_remote_code"],
    process.env["LOCAL_STUDIO_DEFAULT_TRUST_REMOTE_CODE"] !== "false",
  ),
  tool_call_parser: normalized["tool_call_parser"] ?? null,
  reasoning_parser: normalized["reasoning_parser"] ?? null,
  enable_auto_tool_choice: booleanSetting(
    "enable_auto_tool_choice",
    normalized["enable_auto_tool_choice"],
    false,
  ),
  quantization: normalized["quantization"] ?? null,
  dtype: normalized["dtype"] ?? null,
  host: normalized["host"] ?? "0.0.0.0",
  port: coercePositiveInt(normalized["port"], 8000, 65535),
  served_model_name: normalized["served_model_name"] ?? null,
  python_path: normalized["python_path"] ?? null,
  extra_args: normalized["extra_args"] ?? {},
  max_thinking_tokens: coerceNullableNumber(normalized["max_thinking_tokens"]),
  thinking_mode: normalized["thinking_mode"] ?? "conservative",
});

export const parseRecipe = <Input>(raw: Input): Recipe => {
  const normalized = normalizeRecipeInput({ ...decodeRecipeInput(raw) });
  const parsed = Schema.decodeUnknownSync(recipeSchema, {
    onExcessProperty: "preserve",
  })(recipeDefaults(normalized));
  const environmentVariables = parsed.env_vars
    ? Object.fromEntries(
        Object.entries(parsed.env_vars).map(([key, value]) => [key, String(value)]),
      )
    : null;
  return {
    ...parsed,
    id: asRecipeId(parsed.id),
    vision: parsed.vision ?? null,
    env_vars: environmentVariables,
    tool_call_parser: parsed.tool_call_parser ?? null,
    reasoning_parser: parsed.reasoning_parser ?? null,
    quantization: parsed.quantization ?? null,
    dtype: parsed.dtype ?? null,
    served_model_name: parsed.served_model_name ?? null,
    python_path: parsed.python_path ?? null,
    max_thinking_tokens: parsed.max_thinking_tokens ?? null,
    extra_args: Schema.decodeUnknownSync(recipeExtraArgumentsSchema)(parsed.extra_args ?? {}),
  };
};
