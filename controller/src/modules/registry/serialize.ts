import type { Recipe } from "../models/types";
import {
  REGISTRY_SCHEMA_VERSION,
  type RegistryHardware,
  type RegistryModelInstance,
} from "@local-studio/contracts/registry";

export const LOCAL_STUDIO_PROVENANCE_URL = "https://github.com/sybil-solutions/local-studio";

/** Launch facts copied from the computed LaunchPlan; all portable, all allowlisted. */
export interface LaunchEvidence {
  readonly argv: readonly string[];
  readonly image: string | null;
  readonly env: Readonly<Record<string, string>>;
  readonly containerPort: number | null;
  readonly hostPort: number | null;
  readonly modelMountTarget: string | null;
}

export interface MeasuredPeaks {
  readonly generation_tps: number;
  readonly prompt_tps: number;
  readonly ttft_ms: number;
  readonly measured_at: string;
}

export interface ContributionInput {
  readonly recipe: Recipe;
  /** Hugging Face-style repository identity for the weights. */
  readonly repository: string | null;
  readonly modelName: string;
  /** Billions of parameters, parsed or measured; a required model field. */
  readonly paramsB: number | null;
  readonly precision: string | null;
  readonly sizeGb: number | null;
  readonly revision: string | null;
  readonly hardware: RegistryHardware;
  readonly hardwareCount: number;
  readonly engineVersion: string | null;
  readonly launch: LaunchEvidence | null;
  readonly peaks: MeasuredPeaks | null;
  readonly nowIso: string;
}

export interface Contribution {
  readonly model?: unknown;
  readonly model_instance: unknown;
  readonly recipe: unknown;
  readonly instance_id: string;
  readonly recipe_id: string;
  readonly model_id: string;
  readonly paths: {
    readonly model: string;
    readonly model_instance: string;
    readonly recipe: string;
  };
}

/** "Qwen/Qwen3-4B" -> {owner: "qwen", name: "qwen3-4b"}; local paths never produce an owner. */
export const repositoryFromModelPath = (modelPath: string): string | null => {
  const withoutBackslashes = modelPath.replace(/\\/g, "/");
  const segments = withoutBackslashes.split("/").filter((segment) => segment.length > 0);
  const meaningful = segments.filter((segment) => segment !== "models");
  if (meaningful.length >= 2) {
    const [owner, name] = meaningful.slice(-2);
    if (!owner || !name) return null;
    return `${owner}/${name}`;
  }
  return meaningful[0] ?? null;
};

export const modelNameFromRepository = (repository: string | null): string =>
  (repository?.split("/")[1] ?? repository ?? "model").trim() || "model";

const PRECISION_TOKEN =
  /(nvfp4|mxfp4|mxfp8|fp4|fp8|int4|int8|fp16|bf16|q[2-8][ _-]?k?(?:_[a-z0-9]+)?|iq[1-4]_[a-z0-9]+|exl[23](?:[0-9.]+)?)$/i;

/** Precision from an explicit recipe field, else the artifact name suffix. */
export const precisionFromRecipe = (recipe: Recipe): string | null => {
  const explicit = recipe.quantization?.trim() || recipe.dtype?.trim();
  if (explicit && explicit.toLowerCase() !== "auto") return explicit.toLowerCase();
  const name = modelNameFromRepository(repositoryFromModelPath(recipe.model_path));
  const match = name.match(PRECISION_TOKEN);
  return match ? (match[0]?.toLowerCase() ?? null) : null;
};

/** Parameter count parsed from the artifact name ("Qwen3-4B" -> 4). */
export const paramsFromName = (name: string): number | null => {
  const matches = [...name.replace(/[–—]/g, "-").matchAll(/(\d+(?:\.\d+)?)\s*(b|m)\b/gi)];
  let best: number | null = null;
  for (const match of matches) {
    const value = Number.parseFloat(match[1] ?? "");
    if (!Number.isFinite(value)) continue;
    const billions = (match[2] ?? "").toLowerCase() === "m" ? value / 1000 : value;
    if (billions >= 0.05 && billions <= 2000) best = billions;
  }
  return best;
};

const registryIdSlug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const factProvenance = (nowIso: string): { sources: { kind: string; url: string; captured_at: string }[]; captured_at: string } => ({
  sources: [
    { kind: "local-studio", url: LOCAL_STUDIO_PROVENANCE_URL, captured_at: nowIso },
  ],
  captured_at: nowIso,
});

const knownFact = (value: unknown, nowIso: string): Record<string, unknown> => ({
  state: "known" as const,
  value,
  provenance: factProvenance(nowIso),
});

const unknownFact = (reason: string, nowIso: string): Record<string, unknown> => ({
  state: "unknown" as const,
  reason,
  provenance: factProvenance(nowIso),
});

/**
 * Build the registry contribution for one working local configuration: the
 * exact artifact (repo, revision, quantization, size), the engine identity,
 * the full launch arguments, serving envelope, capabilities, and any measured
 * speed evidence. Everything required for reproducibility, nothing about the
 * machine beyond the hardware class it was measured on.
 */
export const buildContribution = (input: ContributionInput): Contribution => {
  const { recipe, hardware, nowIso } = input;
  const repository = input.repository ?? repositoryFromModelPath(recipe.model_path);
  const modelName = input.modelName || modelNameFromRepository(repository);
  const precision = input.precision ?? precisionFromRecipe(recipe);
  const paramsB = input.paramsB ?? paramsFromName(modelName);
  const modelId = registryIdSlug(modelName);
  const publisher = repository?.split("/")[0] ?? null;
  // Registry convention: <publisher>-<artifact>--<precision>.
  const instanceId = (
    precision
      ? `${[publisher ? registryIdSlug(publisher) : null, modelId].filter(Boolean).join("-")}--${registryIdSlug(precision)}`
      : [publisher ? registryIdSlug(publisher) : null, modelId].filter(Boolean).join("-")
  );
  const recipeId = [
    modelId,
    precision ? registryIdSlug(precision) : null,
    registryIdSlug(hardware.id),
    recipe.backend,
    `tp${Math.max(1, input.hardwareCount)}`,
  ]
    .filter(Boolean)
    .join("-");

  const weights: RegistryModelInstance["weights"] = {
    format: "safetensors",
    precision: precision ?? null,
    size_gb: input.sizeGb ?? null,
  };
  const modelInstance = {
    schema_version: REGISTRY_SCHEMA_VERSION,
    id: instanceId,
    model_id: modelId,
    repository: repository ?? modelName,
    url: repository ? `https://huggingface.co/${repository}` : null,
    revision: input.revision ?? null,
    served_name: recipe.served_model_name ?? modelName,
    weights,
    kind: precision ? ("quant" as const) : ("base" as const),
    huggingface: {
      link_type: repository ? ("repository" as const) : ("search" as const),
      status: "unknown" as const,
      repository: repository ?? null,
      url: repository
        ? `https://huggingface.co/${repository}`
        : `https://huggingface.co/models?search=${encodeURIComponent(modelName)}`,
      reason: "not-verified-by-controller",
      provenance: factProvenance(nowIso),
    },
    provenance: factProvenance(nowIso),
    facts: {
      revision: input.revision
        ? knownFact(input.revision, nowIso)
        : unknownFact("artifact-revision-not-pinned", nowIso),
      "weights.size_gb":
        input.sizeGb !== null ? knownFact(input.sizeGb, nowIso) : unknownFact("artifact-size-not-published", nowIso),
    },
  };

  const launch: Record<string, unknown> = {
    kind: "controller",
    accelerator_backend: hardware.accelerator_backend,
    controller: { recipe_id: recipe.id, recipe_name: recipe.name },
  };
  if (input.launch) {
    const image = input.launch.image;
    const digestMatch = image?.match(/@sha256:([0-9a-f]{64})$/);
    Object.assign(launch, {
      image: image ? image.split("@")[0] : null,
      digest: image ? (digestMatch ? image.split("@")[1] : null) : null,
    });
    Object.assign(launch, {
      arguments: [...input.launch.argv],
      container_port: input.launch.containerPort,
      host_port: input.launch.hostPort,
      environment: { ...input.launch.env },
      mounts: input.launch.modelMountTarget
        ? [{ target: input.launch.modelMountTarget, read_only: true }]
        : [],
    });
  }

  const serving: Record<string, unknown> = {
    api: "openai/v1",
    tensor_parallel: Math.max(1, recipe.tensor_parallel_size),
    pipeline_parallel: Math.max(1, recipe.pipeline_parallel_size),
    configured_max_context_tokens: recipe.max_model_len,
    configured_max_running_sequences: recipe.max_num_seqs,
    gpu_memory_utilization: recipe.gpu_memory_utilization,
    served_model_name: recipe.served_model_name ?? modelName,
  };
  if (recipe.kv_cache_dtype && recipe.kv_cache_dtype !== "auto") {
    serving["kv_cache_dtype"] = recipe.kv_cache_dtype;
  }
  if (input.peaks) {
    serving["measured"] = {
      peak_generation_tps: input.peaks.generation_tps,
      peak_prompt_tps: input.peaks.prompt_tps,
      best_ttft_ms: input.peaks.ttft_ms,
      measured_at: input.peaks.measured_at,
      source: "local-studio-session-peaks",
    };
  }

  const recipeRecord = {
    schema_version: REGISTRY_SCHEMA_VERSION,
    id: recipeId,
    recipe_source: "local-studio",
    status: "candidate" as const,
    description: `${modelName}${precision ? ` ${precision.toUpperCase()}` : ""} on ${input.hardwareCount}× ${hardware.name} via ${recipe.backend}`,
    model_instance_id: instanceId,
    hardware_id: hardware.id,
    hardware_count: input.hardwareCount,
    engine: {
      name: recipe.backend,
      version: input.engineVersion ?? null,
      graph_mode: null,
    },
    launch,
    serving,
    capabilities: {
      chat: true,
      reasoning: recipe.reasoning_parser !== null,
      tools: recipe.tool_call_parser !== null,
      vision: recipe.vision === true,
    },
    speed_sweeps_ids: [],
    metadata: {
      local_studio: { recipe_id: recipe.id, recipe_name: recipe.name },
    },
    provenance: factProvenance(nowIso),
    facts: {},
  };

  const model =
    paramsB !== null
      ? {
          schema_version: REGISTRY_SCHEMA_VERSION,
          id: modelId,
          family: publisher ? registryIdSlug(publisher) : modelId,
          name: modelName,
          params: paramsB,
          active_params: null,
          architecture: null,
          url: repository ? `https://huggingface.co/${repository}` : null,
          huggingface: modelInstance.huggingface,
          provenance: factProvenance(nowIso),
          facts: {},
        }
      : undefined;

  return {
    ...(model ? { model } : {}),
    model_instance: modelInstance,
    recipe: recipeRecord,
    instance_id: instanceId,
    recipe_id: recipeId,
    model_id: modelId,
    paths: {
      model: `model/${modelId}.json`,
      model_instance: `model-instance/${instanceId}.json`,
      recipe: `recipe/${recipeId}.json`,
    },
  };
};
