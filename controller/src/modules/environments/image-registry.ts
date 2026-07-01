import type { EnvironmentEngineId } from "./types";

export interface ResolveEnvironmentImageOptions {
  readonly engineId: EnvironmentEngineId;
  /** vLLM/SGLang: the upstream pip version (e.g. "0.11.0"). llama.cpp: the
   * upstream build number (e.g. "9853") — the project versions by build, not semver. */
  readonly version: string;
  /** Accelerator/build suffix appended exactly as published upstream (e.g.
   * "cu124" or "rocm700-mi35x" for sglang; "cuda"/"cuda12"/"rocm"/"vulkan" for
   * llama.cpp). Omit for vLLM's plain "v{version}" CUDA tag. */
  readonly variant?: string;
}

/**
 * Maps a pinned engine version to its official upstream Docker image
 * reference. Tag shapes are sourced from each project's published registry,
 * not guessed:
 * - vLLM: `vllm/vllm-openai` (Docker Hub), plain `v{version}` tags for CUDA.
 * - SGLang: `lmsysorg/sglang` (Docker Hub), always accelerator-suffixed
 *   (e.g. `v0.4.7-cu124`).
 * - llama.cpp: `ghcr.io/ggml-org/llama.cpp`, build-number tags per variant
 *   (e.g. `server-cuda-b9853`).
 */
export const resolveEnvironmentImage = ({
  engineId,
  version,
  variant,
}: ResolveEnvironmentImageOptions): string => {
  switch (engineId) {
    case "vllm":
      return variant ? `vllm/vllm-openai:v${version}-${variant}` : `vllm/vllm-openai:v${version}`;
    case "sglang":
      return `lmsysorg/sglang:v${version}${variant ? `-${variant}` : ""}`;
    case "llamacpp":
      return `ghcr.io/ggml-org/llama.cpp:server${variant ? `-${variant}` : ""}-b${version}`;
  }
};
