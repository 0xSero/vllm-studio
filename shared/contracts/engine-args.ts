import type { Backend } from "./recipes";

/**
 * Engine-scoped CLI argument policy.
 *
 * vLLM exposes a large surface of structured "convenience" flags in the recipe
 * editor. Those flags are vLLM-specific: forwarding them to llama.cpp, MLX, or
 * SGLang produces an unknown-argument crash or silently wrong behaviour. This
 * module is the single source of truth (shared by the frontend serializer and
 * the controller command builders) for which keys must never leak across
 * engines.
 */

/** Normalize a CLI/extra-arg key to canonical kebab-case for comparison. */
export const normalizeEngineArgKey = (key: string): string =>
  key.replace(/_/g, "-").toLowerCase().trim();

/**
 * vLLM-only secondary flags (canonical kebab-case). These mirror the editor's
 * structured vLLM fields. The list deliberately excludes:
 *  - flags shared with other engines (e.g. `chat-template`),
 *  - device/env keys handled out-of-band (`*-visible-devices`),
 *  - launch overrides and metadata (`launch_command`, `env_vars`, ...).
 */
export const VLLM_ONLY_FLAG_KEYS: readonly string[] = [
  "tokenizer",
  "tokenizer-mode",
  "seed",
  "revision",
  "code-revision",
  "load-format",
  "quantization-param-path",
  "response-role",
  "chat-template-content-format",
  "block-size",
  "swap-space",
  "cpu-offload-gb",
  "num-gpu-blocks-override",
  "enable-prefix-caching",
  "enable-chunked-prefill",
  "max-num-batched-tokens",
  "scheduling-policy",
  "max-paddings",
  "data-parallel-size",
  "enable-expert-parallel",
  "enforce-eager",
  "disable-cuda-graph",
  "cuda-graph-max-bs",
  "disable-custom-all-reduce",
  "use-v2-block-manager",
  "compilation-config",
  "speculative-model",
  "speculative-model-quantization",
  "num-speculative-tokens",
  "speculative-draft-tensor-parallel-size",
  "speculative-max-model-len",
  "speculative-disable-mqa-scorer",
  "spec-decoding-acceptance-method",
  "typical-acceptance-sampler-posterior-threshold",
  "typical-acceptance-sampler-posterior-alpha",
  "ngram-prompt-lookup-max",
  "ngram-prompt-lookup-min",
  "guided-decoding-backend",
  "tool-parser-plugin",
  "enable-lora",
  "max-loras",
  "max-lora-rank",
  "lora-extra-vocab-size",
  "lora-dtype",
  "long-lora-scaling-factors",
  "fully-sharded-loras",
  "image-input-type",
  "image-token-id",
  "image-input-shape",
  "image-feature-size",
  "limit-mm-per-prompt",
  "mm-processor-kwargs",
  "allowed-local-media-path",
  "disable-log-requests",
  "disable-log-stats",
  "max-log-len",
  "uvicorn-log-level",
  "disable-frontend-multiprocessing",
  "enable-request-id-headers",
  "disable-fastapi-docs",
  "return-tokens-as-token-ids",
];

/**
 * vLLM flags that SGLang also accepts under the same name. These are kept when
 * scoping arguments for SGLang so legitimate overrides are not dropped.
 * Updated to reflect SGLang's actual server argument surface (2025+).
 */
const SGLANG_COMPATIBLE_VLLM_KEYS: ReadonlySet<string> = new Set([
  "disable-cuda-graph",
  "disable-custom-all-reduce",
  "enable-prefix-caching",
  "enable-chunked-prefill",
  "chunked-prefill-size",
  "max-num-batched-tokens",
  "scheduling-policy",
  "enable-priority-scheduling",
  "schedule-conservativeness",
  "page-size",
  "data-parallel-size",
  "enable-torch-compile",
  "enable-p2p-check",
  "enable-deterministic-inference",
  "random-seed",
  "load-format",
  "revision",
  "tokenizer-mode",
  "tokenizer-backend",
  "device",
  "stream-interval",
  "watchdog-timeout",
  "enable-cache-report",
  "chat-template",
  "hf-chat-template-name",
  "api-key",
  "download-dir",
  "base-gpu-id",
  "gpu-id-step",
  "sleep-on-idle",
  "skip-server-warmup",
  "log-level",
  "log-requests",
]);

const VLLM_ONLY_FLAG_KEY_SET: ReadonlySet<string> = new Set(
  VLLM_ONLY_FLAG_KEYS.map(normalizeEngineArgKey),
);

/** Keys that do not belong to `backend` and must be stripped before launch. */
export const getForeignFlagKeys = (backend: Backend): ReadonlySet<string> => {
  if (backend === "vllm") return new Set();
  if (backend === "sglang") {
    return new Set(
      [...VLLM_ONLY_FLAG_KEY_SET].filter((key) => !SGLANG_COMPATIBLE_VLLM_KEYS.has(key)),
    );
  }
  // llama.cpp and MLX share no flag namespace with vLLM.
  return VLLM_ONLY_FLAG_KEY_SET;
};

/**
 * Return a copy of `extraArgs` with any wrong-engine flag keys removed. vLLM
 * recipes are returned untouched (vLLM is the superset).
 */
export const stripForeignFlagKeys = (
  backend: Backend,
  extraArgs: Record<string, unknown> | null | undefined,
): Record<string, unknown> => {
  const source = extraArgs ?? {};
  const foreign = getForeignFlagKeys(backend);
  if (foreign.size === 0) return { ...source };
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (foreign.has(normalizeEngineArgKey(key))) continue;
    result[key] = value;
  }
  return result;
};
