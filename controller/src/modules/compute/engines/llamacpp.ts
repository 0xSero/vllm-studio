import type { EngineSupport, HostProfile } from "../contracts";
import {
  prometheusMetrics,
  serverEngine,
  supported,
  type Spelling,
} from "./shared";

// llama.cpp mmaps the GGUF rather than compiling graphs, so a cold start is minutes at
// worst even for a very large quant.
const READY_DEADLINE_MS = 600_000;

const spelling: Spelling = {
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
};

const image = (host: HostProfile): string | null => {
  if (host.accelerator === "cuda") return "ghcr.io/ggml-org/llama.cpp:server-cuda";
  if (host.accelerator === "rocm") return "ghcr.io/ggml-org/llama.cpp:server-rocm";
  return "ghcr.io/ggml-org/llama.cpp:server";
};

/** The universal fallback: the only engine that runs natively on every OS and every
 *  accelerator we support, which is why it is the migration's pilot. */
const supports = (host: HostProfile): EngineSupport =>
  host.dockerGpu && host.platform !== "darwin" ? supported("process", "docker") : supported("process");

export const llamacpp = serverEngine({
  id: "llamacpp",
  defaultBinary: "llama-server",
  defaultPort: 8081,
  healthPath: "/health",
  readyDeadlineMs: READY_DEADLINE_MS,
  metrics: prometheusMetrics("llamacpp", "kv_cache_usage_ratio"),
  image,
  supports,
  server: {
    modelFlag: "--model",
    servedNameFlag: "--alias",
    spelling,
    defaults: ["--metrics"],
  },
});
