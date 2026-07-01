import type { EnvironmentEngineId } from "./types";

export interface ResolveEnvironmentImageOptions {
  readonly engineId: EnvironmentEngineId;
  /** vLLM/SGLang: the upstream pip version (e.g. "0.24.0"). llama.cpp: the
   * upstream build number (e.g. "9853") — the project versions by build, not semver. */
  readonly version: string;
  /** Accelerator/build suffix appended exactly as published upstream (e.g.
   * "cu129" or "rocm700-mi35x" for sglang; "cuda"/"cuda12"/"rocm"/"vulkan" for
   * llama.cpp). Omit for vLLM's plain "v{version}" CUDA tag. */
  readonly variant?: string;
}

/** Latest known-published official tag per engine, used when seeding
 * environments from recipes that do not pin their own docker image. */
export const DEFAULT_ENGINE_IMAGE_SPECS: Record<
  EnvironmentEngineId,
  { version: string; variant: string | null }
> = {
  vllm: { version: "0.24.0", variant: null },
  sglang: { version: "0.5.14", variant: "cu129" },
  llamacpp: { version: "9853", variant: "cuda" },
};

/**
 * Maps a pinned engine version to its official upstream Docker image
 * reference. Tag shapes are sourced from each project's published registry,
 * not guessed:
 * - vLLM: `vllm/vllm-openai` (Docker Hub), plain `v{version}` tags for CUDA.
 * - SGLang: `lmsysorg/sglang` (Docker Hub), always accelerator-suffixed
 *   (e.g. `v0.5.14-cu129`).
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

export const resolveImageForEnvironment = (environment: {
  engineId: EnvironmentEngineId;
  version: string;
  variant: string | null;
  image: string | null;
}): string =>
  environment.image ??
  resolveEnvironmentImage({
    engineId: environment.engineId,
    version: environment.version,
    ...(environment.variant ? { variant: environment.variant } : {}),
  });
