import { Effect } from "effect";
import type { Config } from "../../../config/env";
import type { ProcessInfo } from "../../models/types";
import type { RuntimeBackendInfo } from "@local-studio/contracts/system";
import type { EngineSupport, HostProfile } from "../../compute/contracts";
import {
  prometheusMetrics,
  serverEngine,
  supported,
  unsupported,
  type Spelling,
} from "../../compute/engines/shared";
import {
  getVllmConfigHelp,
  getVllmRuntimeInfo,
  installVllmRuntime,
} from "../runtimes/vllm-runtime";
import { normalizePackageSpec, probeVllmBinaryRuntime } from "../runtimes/runtime-target-probes";
import { resolveVllmPythonPath } from "../runtimes/vllm-python-path";
import type { BinaryProbeResult, ConfigHelpResult, EngineSpec } from "../engine-spec";

const spelling: Spelling = {
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

const image = (host: HostProfile): string | null => {
  if (host.accelerator === "rocm") return "rocm/vllm:latest";
  if (host.accelerator === "cuda") return "vllm/vllm-openai:latest";
  return null;
};

const supports = (host: HostProfile): EngineSupport => {
  if (host.platform === "darwin") {
    return unsupported("vLLM has no Metal backend — use llamacpp or mlx on Apple Silicon");
  }
  if (host.platform === "win32" && !host.wsl) return unsupported("vLLM on Windows requires WSL2");
  if (host.accelerator === "rocm") {
    return host.dockerGpu
      ? supported("docker")
      : unsupported("vLLM on ROCm needs Docker with GPU passthrough (rocm/vllm)");
  }
  if (host.accelerator !== "cuda") {
    return unsupported(`vLLM needs a CUDA or ROCm device; this host reports ${host.accelerator}`);
  }
  return host.dockerGpu ? supported("process", "docker") : supported("process");
};

const managedPackageSpec = (version?: string | null): string =>
  normalizePackageSpec("vllm", version);

const probeBinary = (binary: string): Effect.Effect<BinaryProbeResult> =>
  probeVllmBinaryRuntime(binary).pipe(
    Effect.map((result) => ({
      installed: result.installed,
      version: result.version,
      binaryPath: result.binaryPath,
      ...(result.pythonPath ? { pythonPath: result.pythonPath } : {}),
      ...(result.message ? { message: result.message } : {}),
    })),
  );

const getRuntimeInfo = (
  _config: Config,
  _runningProcess?: Pick<ProcessInfo, "pid" | "backend"> | null,
): Effect.Effect<RuntimeBackendInfo> =>
  getVllmRuntimeInfo().pipe(
    Effect.map((info) => ({
      installed: info.installed,
      version: info.version,
      python_path: info.python_path,
      binary_path: info.vllm_bin,
      upgrade_command_available: Boolean(info.python_path),
    })),
  );

const getConfigHelp = (_config: Config): Effect.Effect<ConfigHelpResult> => getVllmConfigHelp();

export const vllmSpec: EngineSpec = {
  ...serverEngine({
    id: "vllm",
    defaultBinary: "vllm",
    defaultPort: 8000,
    healthPath: "/health",
    readyDeadlineMs: 1_800_000,
    metrics: prometheusMetrics("vllm", "kv_cache_usage_perc"),
    image,
    supports,
    server: (request) => ({
      subcommand: request.runtime === "docker" ? [] : ["serve"],
      modelFlag: null,
      servedNameFlag: "--served-model-name",
      spelling,
    }),
  }),
  cliBinary: "vllm",
  managedPackageSpec,
  install: installVllmRuntime,
  probeBinary,
  resolvePythonPath: (config: Config) => resolveVllmPythonPath(config.data_dir),
  getRuntimeInfo,
  getConfigHelp,
};
