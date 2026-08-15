import type { Backend } from "@/lib/types";
import { LLAMACPP_OPTIONS, type LlamacppOption } from "./llamacpp-options";
import { MLX_OPTIONS } from "./mlx-options";
import type { RecipeModalTabId } from "./recipe-modal/tabs/tab-id";

export type ParallelismMode = "full" | "tp-pp" | "none";
export type EngineOptionsKind = "none" | "llamacpp" | "mlx";

export interface EngineCapabilities {
  backend: Backend;
  tabs: RecipeModalTabId[];
  options: EngineOptionsKind;
  contextLength: boolean;
  seed: boolean;
  advancedModelLoading: boolean;
  quantization: boolean;
  trustRemoteCode: boolean;
  parallelism: ParallelismMode;
  gpuMemoryUtil: boolean;
  visibleDevices: boolean;
  memoryManagement: boolean;
  kvCacheDtype: boolean;
  blockSize: boolean;
  caching: boolean;
  schedulerAdvanced: boolean;
  maxNumSeqs: boolean;
  cudaGraphs: boolean;
  toolCalling: boolean;
  reasoning: boolean;
  chatTemplates: boolean;
}

type CapabilityFlag = {
  [Key in keyof EngineCapabilities]: EngineCapabilities[Key] extends boolean ? Key : never;
}[keyof EngineCapabilities];

const CAPABILITY_FLAGS = {
  contextLength: true,
  seed: true,
  advancedModelLoading: true,
  quantization: true,
  trustRemoteCode: true,
  gpuMemoryUtil: true,
  visibleDevices: true,
  memoryManagement: true,
  kvCacheDtype: true,
  blockSize: true,
  caching: true,
  schedulerAdvanced: true,
  maxNumSeqs: true,
  cudaGraphs: true,
  toolCalling: true,
  reasoning: true,
  chatTemplates: true,
} satisfies Record<CapabilityFlag, true>;

const FLAG_KEYS = Object.keys(CAPABILITY_FLAGS) as CapabilityFlag[];
const ALL_TABS: RecipeModalTabId[] = [
  "general",
  "model",
  "resources",
  "performance",
  "features",
  "environment",
  "command",
];
const MLX_TABS: RecipeModalTabId[] = ["general", "model", "features", "environment", "command"];
Object.freeze(ALL_TABS);
Object.freeze(MLX_TABS);

function capabilities(
  backend: Backend,
  options: EngineOptionsKind,
  tabs: RecipeModalTabId[],
  parallelism: ParallelismMode,
  enabled: readonly CapabilityFlag[],
): EngineCapabilities {
  const flags = Object.fromEntries(
    FLAG_KEYS.map((flag) => [flag, enabled.includes(flag)]),
  ) as Record<CapabilityFlag, boolean>;
  return { backend, tabs, options, parallelism, ...flags };
}

const CAPABILITIES: Record<Backend, EngineCapabilities> = {
  vllm: capabilities("vllm", "none", ALL_TABS, "full", FLAG_KEYS),
  sglang: capabilities("sglang", "none", ALL_TABS, "full", FLAG_KEYS),
  llamacpp: capabilities("llamacpp", "llamacpp", ALL_TABS, "none", ["contextLength", "seed"]),
  mlx: capabilities("mlx", "mlx", MLX_TABS, "none", ["trustRemoteCode"]),
};

export const getEngineCapabilities = (backend: Backend | undefined): EngineCapabilities =>
  CAPABILITIES[backend ?? "vllm"] ?? CAPABILITIES.vllm;

export const getEngineOptions = (
  kind: EngineOptionsKind,
  tab: LlamacppOption["tab"],
): LlamacppOption[] => {
  const options = kind === "llamacpp" ? LLAMACPP_OPTIONS : kind === "mlx" ? MLX_OPTIONS : [];
  return options.filter((option) => option.tab === tab);
};

export const ENGINE_LABEL: Record<Backend, string> = {
  vllm: "vLLM",
  sglang: "SGLang",
  llamacpp: "llama.cpp",
  mlx: "MLX",
};
