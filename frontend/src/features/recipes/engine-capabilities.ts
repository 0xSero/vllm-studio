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

type CapabilityFlag = Exclude<
  keyof EngineCapabilities,
  "backend" | "tabs" | "options" | "parallelism"
>;

const FLAGS = [
  "contextLength",
  "seed",
  "advancedModelLoading",
  "quantization",
  "trustRemoteCode",
  "gpuMemoryUtil",
  "visibleDevices",
  "memoryManagement",
  "kvCacheDtype",
  "blockSize",
  "caching",
  "schedulerAdvanced",
  "maxNumSeqs",
  "cudaGraphs",
  "toolCalling",
  "reasoning",
  "chatTemplates",
] as const satisfies readonly CapabilityFlag[];

const ALL_TABS: RecipeModalTabId[] = [
  "general",
  "model",
  "resources",
  "performance",
  "features",
  "environment",
  "command",
];

function capabilities(
  backend: Backend,
  options: EngineOptionsKind,
  tabs: RecipeModalTabId[],
  parallelism: ParallelismMode,
  enabled: readonly CapabilityFlag[],
): EngineCapabilities {
  const flags = Object.fromEntries(FLAGS.map((flag) => [flag, enabled.includes(flag)])) as Record<
    CapabilityFlag,
    boolean
  >;
  return { backend, tabs, options, parallelism, ...flags };
}

const CAPABILITIES: Record<Backend, EngineCapabilities> = {
  vllm: capabilities("vllm", "none", ALL_TABS, "full", FLAGS),
  sglang: capabilities("sglang", "none", ALL_TABS, "full", FLAGS),
  llamacpp: capabilities("llamacpp", "llamacpp", ALL_TABS, "none", ["contextLength", "seed"]),
  mlx: capabilities(
    "mlx",
    "mlx",
    ["general", "model", "features", "environment", "command"],
    "none",
    ["trustRemoteCode"],
  ),
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
