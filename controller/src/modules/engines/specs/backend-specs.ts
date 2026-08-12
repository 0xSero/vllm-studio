import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Effect } from "effect";
import type { RuntimeUpgradeResult } from "@local-studio/contracts/system";
import type { Config } from "../../../config/env";
import { resolveBinary, runCommandAsyncEffect } from "../../../core/command";
import type { EngineSupport, HostProfile } from "../../compute/contracts";
import {
  noMetrics,
  prometheusMetrics,
  serverEngine,
  supported,
  unsupported,
  type Spelling,
} from "../../compute/engines/shared";
import type { Recipe } from "../../models/types";
import { getExtraArgument } from "../argument-utilities";
import { LLAMACPP_HELP_TIMEOUT_MS } from "../configs";
import type {
  BinaryProbeResult,
  ConfigHelpResult,
  EngineSpec,
  InstallOptions,
} from "../engine-spec";
import { installManagedLlamacpp, managedLlamaServerPath } from "../runtimes/managed-llamacpp";
import { installIntoManagedVenv, managedVenvPython } from "../runtimes/managed-venv";
import {
  normalizePackageSpec,
  probeVllmBinaryRuntime,
  resolvePythonFromScript,
} from "../runtimes/runtime-target-probes";
import {
  getUpgradeCommandFromEnvironment,
  LLAMACPP_UPGRADE_ENV,
  runEnvironmentUpgradeCommand,
  SGLANG_UPGRADE_ENV,
} from "../runtimes/upgrade-config";
import {
  getVllmConfigHelp,
  getVllmRuntimeInfo,
  installVllmRuntime,
} from "../runtimes/vllm-runtime";
import { resolveVllmPythonPath } from "../runtimes/vllm-python-path";

const packageSpec =
  (name: string) =>
  (version?: string | null): string =>
    normalizePackageSpec(name, version);

const installPythonBackend = (
  options: InstallOptions,
  backend: "sglang" | "mlx",
  spec: string,
  pythonPath: string | null,
  createManagedVenv: boolean,
): Effect.Effect<RuntimeUpgradeResult> =>
  installIntoManagedVenv({
    config: options.config,
    backend,
    packageSpec: spec,
    pythonPath,
    createManagedVenv,
    onProgress: options.onProgress,
    onSpawn: options.onSpawn,
  });

const commandHelp = (
  binary: string,
  args: string[],
  failure: string,
  timeoutMs = 5_000,
): Effect.Effect<ConfigHelpResult> =>
  runCommandAsyncEffect(binary, args, { timeoutMs }).pipe(
    Effect.map((result) => ({
      config: result.stdout || null,
      error: result.status === 0 ? null : result.stderr || failure,
    })),
  );

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

const vllmSupports = (host: HostProfile): EngineSupport => {
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

const probeVllm = (binary: string): Effect.Effect<BinaryProbeResult> =>
  probeVllmBinaryRuntime(binary).pipe(
    Effect.map((result) => ({
      installed: result.installed,
      version: result.version,
      binaryPath: result.binaryPath,
      ...(result.pythonPath ? { pythonPath: result.pythonPath } : {}),
      ...(result.message ? { message: result.message } : {}),
    })),
  );

export const vllmSpec: EngineSpec = {
  ...serverEngine({
    id: "vllm",
    defaultBinary: "vllm",
    defaultPort: 8000,
    healthPath: "/health",
    readyDeadlineMs: 1_800_000,
    metrics: prometheusMetrics("vllm", "kv_cache_usage_perc"),
    image: vllmImage,
    supports: vllmSupports,
    server: (request) => ({
      subcommand: request.runtime === "docker" ? [] : ["serve"],
      modelFlag: null,
      servedNameFlag: "--served-model-name",
      spelling: vllmSpelling,
    }),
  }),
  cliBinary: "vllm",
  managedPackageSpec: packageSpec("vllm"),
  install: installVllmRuntime,
  probeBinary: probeVllm,
  resolvePythonPath: (config) => resolveVllmPythonPath(config.data_dir),
  getConfigHelp: () => getVllmConfigHelp(),
};

const sglangSpelling: Spelling = {
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

const sglangSupports = (host: HostProfile): EngineSupport => {
  if (host.platform === "darwin") return unsupported("SGLang has no Metal backend");
  if (host.platform === "win32" && !host.wsl) return unsupported("SGLang on Windows requires WSL2");
  if (host.accelerator !== "cuda") {
    return unsupported(`SGLang needs a CUDA device; this host reports ${host.accelerator}`);
  }
  return host.dockerGpu ? supported("process", "docker") : supported("process");
};

const resolveSglangPython = (config: Config): string | null => {
  const explicit = process.env["LOCAL_STUDIO_SGLANG_PYTHON"]?.trim();
  if (explicit && existsSync(explicit)) return explicit;
  for (const candidate of [
    managedVenvPython(config, "sglang"),
    "/opt/venvs/active/sglang-latest/bin/python",
    "/opt/venvs/sglang-latest/bin/python",
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return resolvePythonFromScript(resolveBinary("sglang"));
};

const probeSglang = (binary: string): Effect.Effect<BinaryProbeResult> =>
  Effect.gen(function* () {
    const version = yield* runCommandAsyncEffect(binary, ["--version"], { timeoutMs: 5_000 });
    if (version.status === 0) {
      const match = version.stdout.match(/(\d+(?:\.\d+){1,3}[A-Za-z0-9.+-]*)/);
      return {
        installed: true,
        version: match?.[1] ?? (version.stdout.trim() || null),
        binaryPath: binary,
      };
    }
    const help = yield* runCommandAsyncEffect(binary, ["--help"], { timeoutMs: 5_000 });
    return help.status === 0
      ? { installed: true, version: null, binaryPath: binary }
      : {
          installed: false,
          version: null,
          binaryPath: binary,
          message: version.stderr || "sglang binary is not runnable",
        };
  });

const sglangConfigHelp = (config: Config): Effect.Effect<ConfigHelpResult> => {
  const binary = resolveBinary("sglang");
  if (!binary) {
    return commandHelp(
      resolveSglangPython(config) ?? "python3",
      ["-m", "sglang.launch_server", "--help"],
      "Failed to fetch SGLang config",
    );
  }
  return runCommandAsyncEffect(binary, ["serve", "--help"], { timeoutMs: 5_000 }).pipe(
    Effect.flatMap((result) =>
      result.status === 0
        ? Effect.succeed({ config: result.stdout || null, error: null })
        : commandHelp(
            resolveSglangPython(config) ?? "python3",
            ["-m", "sglang.launch_server", "--help"],
            "Failed to fetch SGLang config",
          ),
    ),
  );
};

export const getSglangRuntimePython = (
  config: Config,
  options: { pythonPath?: string | null } = {},
): string =>
  options.pythonPath?.trim() || config.sglang_python || resolveVllmPythonPath() || "python3";

const installSglang = (options: InstallOptions): Effect.Effect<RuntimeUpgradeResult> => {
  const command = getUpgradeCommandFromEnvironment(SGLANG_UPGRADE_ENV);
  if (command) return runEnvironmentUpgradeCommand(command, options.onSpawn);
  const pythonPath = options.pythonPath ?? getSglangRuntimePython(options.config);
  return installPythonBackend(
    options,
    "sglang",
    packageSpec("sglang[all]")(options.version),
    pythonPath,
    !options.pythonPath,
  );
};

export const sglangSpec: EngineSpec = {
  ...serverEngine({
    id: "sglang",
    defaultBinary: "sglang",
    defaultPort: 30000,
    healthPath: "/health",
    readyDeadlineMs: 900_000,
    metrics: prometheusMetrics("sglang", "token_usage"),
    image: (host) => (host.accelerator === "cuda" ? "lmsysorg/sglang:latest" : null),
    supports: sglangSupports,
    server: {
      subcommand: ["serve"],
      modelFlag: "--model-path",
      servedNameFlag: "--served-model-name",
      spelling: sglangSpelling,
      defaults: ["--enable-metrics"],
    },
  }),
  cliBinary: "sglang",
  managedPackageSpec: packageSpec("sglang[all]"),
  install: installSglang,
  probeBinary: probeSglang,
  resolvePythonPath: resolveSglangPython,
  getConfigHelp: sglangConfigHelp,
};

const executableBaseName = (value: string): string =>
  value.split(/[\\/]/).filter(Boolean).at(-1)?.toLowerCase() ?? value.toLowerCase();

const rejectPathTraversal = (value: string, label: string): void => {
  if (value.split(/[\\/]+/).includes("..")) {
    throw new Error(`Invalid ${label}: path traversal is not allowed`);
  }
};

export const resolveLlamaBinary = (recipe: Recipe, config: Config): string => {
  const override = getExtraArgument(recipe.extra_args, "llama_bin") ?? config.llama_bin;
  if (typeof override === "string" && override.trim()) {
    rejectPathTraversal(override, "llama_bin");
    const name = executableBaseName(override);
    if (name !== "llama-server" && name !== "llama-server.exe") {
      throw new Error("Invalid llama_bin: only llama-server executables are allowed");
    }
    const resolved = resolveBinary(override);
    if (resolved) return resolved;
    throw new Error(`Invalid llama_bin: executable "${override}" was not found`);
  }
  const managed = managedLlamaServerPath(config);
  return resolveBinary("llama-server") ?? (existsSync(managed) ? managed : "llama-server");
};

const installLlamacpp = (options: InstallOptions): Effect.Effect<RuntimeUpgradeResult> => {
  const command = getUpgradeCommandFromEnvironment(LLAMACPP_UPGRADE_ENV);
  return command
    ? runEnvironmentUpgradeCommand(command, options.onSpawn)
    : installManagedLlamacpp(options);
};

export const llamacppSpec: EngineSpec = {
  ...serverEngine({
    id: "llamacpp",
    defaultBinary: "llama-server",
    defaultPort: 8081,
    healthPath: "/health",
    readyDeadlineMs: 600_000,
    metrics: prometheusMetrics("llamacpp", "kv_cache_usage_ratio"),
    image: (host) =>
      host.accelerator === "cuda"
        ? "ghcr.io/ggml-org/llama.cpp:server-cuda"
        : host.accelerator === "rocm"
          ? "ghcr.io/ggml-org/llama.cpp:server-rocm"
          : "ghcr.io/ggml-org/llama.cpp:server",
    supports: (host) =>
      host.dockerGpu && host.platform !== "darwin"
        ? supported("process", "docker")
        : supported("process"),
    server: {
      modelFlag: "--model",
      servedNameFlag: "--alias",
      spelling: {
        maxContextLength: { flag: "--ctx-size" },
        maxConcurrentRequests: { flag: "--parallel" },
      },
      defaults: ["--metrics"],
    },
  }),
  cliBinary: "llama-server",
  managedPackageSpec: () => "llama.cpp",
  install: installLlamacpp,
  getConfigHelp: (config) => {
    const configured = config.llama_bin || "llama-server";
    const binary =
      resolveBinary(configured) ?? (existsSync(configured) ? resolve(configured) : configured);
    return commandHelp(
      binary,
      ["--help"],
      "Failed to fetch llama.cpp config",
      LLAMACPP_HELP_TIMEOUT_MS,
    );
  },
};

const resolveMlxPython = (config: Config): string | null => {
  const explicit = process.env["LOCAL_STUDIO_MLX_PYTHON"]?.trim();
  if (explicit && existsSync(explicit)) return explicit;
  const managed = managedVenvPython(config, "mlx");
  return existsSync(managed) ? managed : null;
};

const installMlx = (options: InstallOptions): Effect.Effect<RuntimeUpgradeResult> => {
  const pythonPath = options.pythonPath ?? options.config.mlx_python ?? null;
  return installPythonBackend(options, "mlx", "mlx-lm", pythonPath, !pythonPath);
};

export const mlxSpec: EngineSpec = {
  ...serverEngine({
    id: "mlx",
    defaultBinary: "mlx_lm.server",
    defaultPort: 8080,
    healthPath: "/v1/models",
    readyDeadlineMs: 300_000,
    metrics: noMetrics,
    supports: (host) => {
      if (host.platform !== "darwin") return unsupported("MLX runs only on macOS (Apple Silicon)");
      if (host.arch !== "arm64")
        return unsupported("MLX requires Apple Silicon; this Mac is Intel");
      return supported("process");
    },
    server: {
      modelFlag: "--model",
      servedNameFlag: null,
      spelling: {
        maxContextLength: { flag: "--max-tokens" },
        trustRemoteCode: { flag: "--trust-remote-code" },
      },
    },
  }),
  cliBinary: null,
  managedPackageSpec: () => "mlx-lm",
  install: installMlx,
  resolvePythonPath: resolveMlxPython,
};
