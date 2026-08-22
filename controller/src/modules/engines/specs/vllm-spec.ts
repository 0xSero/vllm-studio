import { Effect } from "effect";
import type { Config } from "../../../config/env";
import {
  getVllmConfigHelp,
  getVllmRuntimeInfo,
  installVllmRuntime,
  vllmBackendInfo,
} from "../runtimes/vllm-runtime";
import { normalizePackageSpec, probeVllmBinaryRuntime } from "../runtimes/runtime-target-probes";
import { resolveVllmPythonPath } from "../runtimes/vllm-python-path";
import type { BinaryProbeResult, EngineSpec } from "../engine-spec";

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

export const vllmSpec: EngineSpec = {
  id: "vllm",
  cliBinary: "vllm",
  managedPackageSpec,
  install: installVllmRuntime,
  probeBinary,
  resolvePythonPath: (config: Config) => resolveVllmPythonPath(config.data_dir),
  getRuntimeInfo: () => getVllmRuntimeInfo().pipe(Effect.map(vllmBackendInfo)),
  getConfigHelp: () => getVllmConfigHelp(),
};
