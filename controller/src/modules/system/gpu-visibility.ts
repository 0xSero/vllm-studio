import { Option, Schema } from "effect";
import { getExtraArgument } from "../engines/argument-utilities";
import type { GpuInfo, Recipe } from "../models/types";

export interface GpuVisibilityResolution {
  readonly source: "all" | "recipe";
  readonly selector: string | null;
  readonly uuids: readonly string[];
  readonly unresolvedTokens: readonly string[];
}

const fullNvidiaUuid =
  /^GPU-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const directVisibilityKeys = [
  "visible_devices",
  "VISIBLE_DEVICES",
  "CUDA_VISIBLE_DEVICES",
  "cuda_visible_devices",
  "cuda-visible-devices",
] as const;

const VisibilitySelectorSchema = Schema.Union([Schema.String, Schema.Number, Schema.Boolean]);
type VisibilitySelector = typeof VisibilitySelectorSchema.Type;

const ExtraEnvironmentSchema = Schema.Struct({
  CUDA_VISIBLE_DEVICES: Schema.optional(VisibilitySelectorSchema),
});

function selectorText(value: VisibilitySelector): string | null {
  return value === false ? null : String(value);
}

function directVisibilitySelector(recipe: Recipe): string | null {
  for (const key of directVisibilityKeys) {
    const value = Schema.decodeUnknownOption(VisibilitySelectorSchema)(
      getExtraArgument(recipe.extra_args, key),
    );
    if (Option.isSome(value)) return selectorText(value.value);
  }
  return null;
}

function environmentVisibilitySelector(recipe: Recipe): string | null {
  const selector = recipe.env_vars?.["CUDA_VISIBLE_DEVICES"] ?? null;
  const rawEnvironment =
    getExtraArgument(recipe.extra_args, "env_vars") ?? recipe.extra_args["envVars"];
  const extraEnvironment = Schema.decodeUnknownOption(ExtraEnvironmentSchema)(rawEnvironment);
  if (Option.isNone(extraEnvironment)) return selector;
  const value = extraEnvironment.value.CUDA_VISIBLE_DEVICES;
  return value === undefined ? selector : selectorText(value);
}

function canonicalNvidiaUuid(uuid: string): string {
  return `GPU-${uuid.slice(4).toLowerCase()}`;
}

function leaseableUuid(gpu: GpuInfo): string | null {
  const uuid = gpu.uuid?.trim();
  return uuid && fullNvidiaUuid.test(uuid) ? canonicalNvidiaUuid(uuid) : null;
}

function appendUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

export function resolveRecipeGpuUuids(
  recipe: Recipe,
  gpus: readonly GpuInfo[],
): GpuVisibilityResolution {
  const byIndex = new Map<number, string>();
  const byUuid = new Map<string, string>();
  const allUuids: string[] = [];
  for (const gpu of gpus) {
    const uuid = leaseableUuid(gpu);
    if (!uuid) continue;
    if (!byIndex.has(gpu.index)) byIndex.set(gpu.index, uuid);
    byUuid.set(uuid.toLowerCase(), uuid);
    appendUnique(allUuids, uuid);
  }

  const selector = directVisibilitySelector(recipe) ?? environmentVisibilitySelector(recipe);
  if (selector === null) {
    const required = Math.max(1, recipe.tensor_parallel_size * recipe.pipeline_parallel_size);
    return { source: "all", selector, uuids: allUuids.slice(0, required), unresolvedTokens: [] };
  }

  const uuids: string[] = [];
  const unresolvedTokens: string[] = [];
  const tokens = selector
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  for (const token of tokens) {
    const uuid = /^\d+$/.test(token) ? byIndex.get(Number(token)) : byUuid.get(token.toLowerCase());
    if (uuid) appendUnique(uuids, uuid);
    else appendUnique(unresolvedTokens, token);
  }
  return { source: "recipe", selector, uuids, unresolvedTokens };
}
