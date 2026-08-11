import type { EngineSupport, HostProfile } from "../contracts";
import {
  prometheusMetrics,
  serverEngine,
  supported,
  unsupported,
  type Spelling,
} from "./shared";

const READY_DEADLINE_MS = 900_000;

// Same eleven knobs as vLLM, different spellings — which is exactly why the spelling is
// data and the builder is shared.
const spelling: Spelling = {
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
};

const image = (host: HostProfile): string | null =>
  host.accelerator === "cuda" ? "lmsysorg/sglang:latest" : null;

const supports = (host: HostProfile): EngineSupport => {
  if (host.platform === "darwin") return unsupported("SGLang has no Metal backend");
  if (host.platform === "win32" && !host.wsl) return unsupported("SGLang on Windows requires WSL2");
  if (host.accelerator !== "cuda") {
    return unsupported(`SGLang needs a CUDA device; this host reports ${host.accelerator}`);
  }
  return host.dockerGpu ? supported("process", "docker") : supported("process");
};

export const sglang = serverEngine({
  id: "sglang",
  defaultBinary: "sglang",
  defaultPort: 30000,
  healthPath: "/health",
  readyDeadlineMs: READY_DEADLINE_MS,
  metrics: prometheusMetrics("sglang", "token_usage"),
  image,
  supports,
  server: {
    subcommand: ["serve"],
    modelFlag: "--model-path",
    servedNameFlag: "--served-model-name",
    spelling,
    defaults: ["--enable-metrics"],
  },
});
