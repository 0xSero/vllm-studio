import type {
  EngineId,
  ComputeEngineSpec,
  EngineSupport,
  HostProfile,
  LaunchPlan,
  LaunchRequest,
  EngineRuntimeKind,
} from "../contracts";
import { applyDevices } from "./devices";
import {
  health,
  noMetrics,
  openAiServerSpec,
  prometheusMetrics,
  supported,
  unsupported,
  type Spelling,
} from "./shared";

/* ── vllm ────────────────────────────────────────────────────────────────── */

// vLLM compiles CUDA graphs on a cold start; a large MoE's first launch is the worst case
// observed, and a warm start beats it by two orders of magnitude.
const VLLM_READY_DEADLINE_MS = 1_800_000;

const vllmSpelling: Spelling = {
  tensorParallel: { flag: "--tensor-parallel-size" },
  pipelineParallel: { flag: "--pipeline-parallel-size" },
  maxContextLength: { flag: "--max-model-len" },
  memoryFraction: { flag: "--gpu-memory-utilization" },
  maxConcurrentRequests: { flag: "--max-num-seqs" },
  kvCacheDtype: { flag: "--kv-cache-dtype" },
  dtype: { flag: "--dtype" },
  quantization: { flag: "--quantization" },
  trustRemoteCode: { flag: "--trust-remote-code" },
  toolCallParser: { flag: "--tool-call-parser", companion: "--enable-auto-tool-choice" },
  reasoningParser: { flag: "--reasoning-parser" },
};

const vllmImage = (host: HostProfile): string | null => {
  if (host.accelerator === "rocm") return "rocm/vllm:latest";
  if (host.accelerator === "cuda") return "vllm/vllm-openai:latest";
  return null;
};

const vllm = openAiServerSpec(
  {
    id: "vllm",
    defaultBinary: "vllm",
    defaultPort: 8000,
    health: health("/health", VLLM_READY_DEADLINE_MS),
    metrics: prometheusMetrics("vllm", "kv_cache_usage_perc"),
    image: vllmImage,
    supports: (host) => {
      if (host.platform === "darwin") {
        return unsupported("vLLM has no Metal backend — use llamacpp or mlx on Apple Silicon");
      }
      if (host.platform === "win32" && !host.wsl) {
        return unsupported("vLLM on Windows requires WSL2");
      }
      if (host.accelerator === "rocm") {
        // Upstream publishes ROCm images; the PyPI wheels are CUDA-only.
        return host.dockerGpu
          ? supported("docker")
          : unsupported("vLLM on ROCm needs Docker with GPU passthrough (rocm/vllm)");
      }
      if (host.accelerator !== "cuda") {
        return unsupported(
          `vLLM needs a CUDA or ROCm device; this host reports ${host.accelerator}`,
        );
      }
      return host.dockerGpu ? supported("process", "docker") : supported("process");
    },
  },
  {
    subcommand: (request) => (request.runtime === "docker" ? [] : ["serve"]),
    // `vllm serve <path>` takes the model positionally.
    modelFlag: null,
    servedNameFlag: "--served-model-name",
    spelling: vllmSpelling,
  },
);

/* ── sglang ──────────────────────────────────────────────────────────────── */

// Same eleven knobs as vLLM, different spellings — which is exactly why the spelling is
// data and the builder is shared.
const sglang = openAiServerSpec(
  {
    id: "sglang",
    defaultBinary: "sglang",
    defaultPort: 30000,
    health: health("/health", 900_000),
    metrics: prometheusMetrics("sglang", "token_usage"),
    image: (host) => (host.accelerator === "cuda" ? "lmsysorg/sglang:latest" : null),
    supports: (host) => {
      if (host.platform === "darwin") return unsupported("SGLang has no Metal backend");
      if (host.platform === "win32" && !host.wsl) {
        return unsupported("SGLang on Windows requires WSL2");
      }
      if (host.accelerator !== "cuda") {
        return unsupported(`SGLang needs a CUDA device; this host reports ${host.accelerator}`);
      }
      return host.dockerGpu ? supported("process", "docker") : supported("process");
    },
  },
  {
    subcommand: ["serve"],
    modelFlag: "--model-path",
    servedNameFlag: "--served-model-name",
    spelling: {
      tensorParallel: { flag: "--tensor-parallel-size" },
      pipelineParallel: { flag: "--pipeline-parallel-size" },
      maxContextLength: { flag: "--context-length" },
      memoryFraction: { flag: "--mem-fraction-static" },
      maxConcurrentRequests: { flag: "--max-running-requests" },
      kvCacheDtype: { flag: "--kv-cache-dtype" },
      dtype: { flag: "--dtype" },
      quantization: { flag: "--quantization" },
      trustRemoteCode: { flag: "--trust-remote-code" },
      toolCallParser: { flag: "--tool-call-parser" },
      reasoningParser: { flag: "--reasoning-parser" },
    },
    // SGLang serves no /metrics unless asked; the recipe can still override it.
    defaults: ["--enable-metrics"],
  },
);

/* ── llamacpp ────────────────────────────────────────────────────────────── */

// llama.cpp mmaps the GGUF rather than compiling graphs, so a cold start is minutes at
// worst even for a very large quant.
const llamacpp = openAiServerSpec(
  {
    id: "llamacpp",
    defaultBinary: "llama-server",
    defaultPort: 8081,
    health: health("/health", 600_000),
    metrics: prometheusMetrics("llamacpp", "kv_cache_usage_ratio"),
    image: (host) => {
      if (host.accelerator === "cuda") return "ghcr.io/ggml-org/llama.cpp:server-cuda";
      if (host.accelerator === "rocm") return "ghcr.io/ggml-org/llama.cpp:server-rocm";
      return "ghcr.io/ggml-org/llama.cpp:server";
    },
    /** The universal fallback: the only engine that runs natively on every OS and every
     *  accelerator we support, which is why it is the migration's pilot. */
    supports: (host) =>
      host.dockerGpu && host.platform !== "darwin"
        ? supported("process", "docker")
        : supported("process"),
  },
  {
    // llama.cpp takes a single .gguf file, not a directory.
    modelFlag: "--model",
    servedNameFlag: "--alias",
    spelling: {
      maxContextLength: { flag: "--ctx-size" },
      maxConcurrentRequests: { flag: "--parallel" },
      // Everything else is deliberately absent rather than approximated:
      //   tensorParallel   — llama.cpp splits by layer (`--split-mode none|layer|row`) and
      //                      `--tensor-split`, neither of which takes a rank count.
      //   kvCacheDtype     — `--cache-type-k` uses GGML names (f16, q8_0), not vLLM's
      //                      auto/fp8 vocabulary, so the values are not interchangeable.
      //   dtype/quantization — baked into the GGUF at conversion time.
      //   memoryFraction, pipelineParallel, trustRemoteCode, parsers — no equivalent.
      // A recipe that needs any of these passes the real flag through extraArgs.
    },
    // Prometheus endpoint is opt-in, same as SGLang.
    defaults: ["--metrics"],
  },
);

/* ── mlx ─────────────────────────────────────────────────────────────────── */

const mlx = openAiServerSpec(
  {
    id: "mlx",
    defaultBinary: "mlx_lm.server",
    defaultPort: 8080,
    // mlx_lm.server exposes no /health; /v1/models answers 200 once it is up.
    health: health("/v1/models", 300_000),
    metrics: noMetrics,
    supports: (host) => {
      if (host.platform !== "darwin") return unsupported("MLX runs only on macOS (Apple Silicon)");
      if (host.arch !== "arm64") {
        return unsupported("MLX requires Apple Silicon; this Mac is Intel");
      }
      // Docker on macOS has no Metal passthrough, so a container would silently run on CPU.
      return supported("process");
    },
  },
  {
    modelFlag: "--model",
    servedNameFlag: null,
    // MLX has no tensor/pipeline parallelism, no KV dtype selection, and no memory
    // fraction — unified memory is allocated on demand.
    spelling: {
      maxContextLength: { flag: "--max-tokens" },
      trustRemoteCode: { flag: "--trust-remote-code" },
    },
  },
);

/* ── exllamav3 ───────────────────────────────────────────────────────────── */

/**
 * exllamav3 is a quantisation/inference library, not a server. The OpenAI-compatible
 * surface comes from TabbyAPI, which loads exl3 weights — so this spec launches TabbyAPI
 * and the "engine" is the loader it is configured with.
 *
 * TabbyAPI is configured mainly through config.yml; only the flags below are stable on the
 * command line, so most tuning arrives via extraArgs by design.
 */
const exllamav3 = openAiServerSpec(
  {
    id: "exllamav3",
    defaultBinary: "tabbyapi",
    defaultPort: 5000,
    health: health("/health", 900_000),
    metrics: noMetrics,
    supports: (host) => {
      if (host.platform === "darwin") return unsupported("exllamav3 requires CUDA; macOS has none");
      if (host.accelerator !== "cuda") {
        return unsupported(`exllamav3 needs a CUDA device; this host reports ${host.accelerator}`);
      }
      // No first-party image; a container would have to be built locally.
      return supported("process");
    },
  },
  {
    modelFlag: "--model-dir",
    servedNameFlag: "--model-name",
    // --gpu-split is a per-device VRAM list, not a rank count, so tensorParallel has no
    // equivalent; recipes that split across cards pass --gpu-split through extraArgs.
    spelling: { maxContextLength: { flag: "--max-seq-len" } },
  },
);

/* ── registry ────────────────────────────────────────────────────────────── */

const SPECS: Readonly<Record<EngineId, ComputeEngineSpec>> = {
  vllm,
  sglang,
  llamacpp,
  mlx,
  exllamav3,
};

export const engineSpec = (id: EngineId): ComputeEngineSpec => SPECS[id];

export const allEngineSpecs: readonly ComputeEngineSpec[] = Object.values(SPECS);

/** Engines this host can actually run, with the runtimes available for each. */
export const availableEngines = (
  host: HostProfile,
): readonly { readonly id: EngineId; readonly support: EngineSupport }[] =>
  allEngineSpecs.map((spec) => ({ id: spec.id, support: spec.supports(host) }));

export const supportsRuntime = (
  id: EngineId,
  host: HostProfile,
  runtime: EngineRuntimeKind,
): boolean => {
  const support = SPECS[id].supports(host);
  return support.ok && support.runtimes.includes(runtime);
};

/**
 * The one entry point that turns a request into a runnable plan. Device selection is
 * folded in here so no engine has to know how its accelerator is addressed, and no
 * launcher has to re-derive it.
 */
export const planLaunch = (request: LaunchRequest): LaunchPlan =>
  applyDevices(SPECS[request.engine].plan(request), request.host.accelerator);
