import { existsSync } from "node:fs";
import { Effect } from "effect";
import type { Config } from "../../../config/env";
import type { ProcessInfo } from "../../models/types";
import type { EngineSupport, HostProfile } from "../../compute/contracts";
import {
  noMetrics,
  serverEngine,
  supported,
  unsupported,
  type Spelling,
} from "../../compute/engines/shared";
import type { RuntimeBackendInfo, RuntimeUpgradeResult } from "@local-studio/contracts/system";
import type { EngineSpec, InstallOptions } from "../engine-spec";
import { installIntoManagedVenv, managedVenvPython } from "../runtimes/managed-venv";
import { probeBackendRuntime, probeRunningProcessPython } from "../runtimes/runtime-target-probes";

const spelling: Spelling = {
  maxContextLength: { flag: "--max-tokens" },
  trustRemoteCode: { flag: "--trust-remote-code" },
};

const supports = (host: HostProfile): EngineSupport => {
  if (host.platform !== "darwin") return unsupported("MLX runs only on macOS (Apple Silicon)");
  if (host.arch !== "arm64") return unsupported("MLX requires Apple Silicon; this Mac is Intel");
  return supported("process");
};

const managedPackageSpec = (_version?: string | null): string => {
  return "mlx-lm";
};

const resolvePythonPath = (config: Config): string | null => {
  const explicit = process.env["LOCAL_STUDIO_MLX_PYTHON"]?.trim();
  if (explicit && existsSync(explicit)) return explicit;

  const managed = managedVenvPython(config, "mlx");
  return existsSync(managed) ? managed : null;
};

const getRuntimeInfo = (
  config: Config,
  runningProcess?: Pick<ProcessInfo, "pid" | "backend"> | null,
): Effect.Effect<RuntimeBackendInfo> =>
  Effect.gen(function* () {
    const runningPython =
      runningProcess?.backend === "mlx"
        ? yield* probeRunningProcessPython(runningProcess.pid)
        : null;
    const probe = yield* probeBackendRuntime("mlx", [
      runningPython,
      config.mlx_python,
      resolvePythonPath(config),
      "python3",
      "python",
    ]);
    return {
      installed: probe.installed,
      version: probe.version,
      python_path: probe.pythonPath ?? config.mlx_python ?? null,
      upgrade_command_available: false,
    };
  });

const installMlx = (options: InstallOptions): Effect.Effect<RuntimeUpgradeResult> => {
  const packageSpec = managedPackageSpec(options.version);
  const pythonPath = options.pythonPath ?? options.config.mlx_python ?? null;
  return installIntoManagedVenv({
    config: options.config,
    backend: "mlx",
    packageSpec,
    pythonPath,
    createManagedVenv: !pythonPath,
    onProgress: options.onProgress,
    onSpawn: options.onSpawn,
  });
};

export const mlxSpec: EngineSpec = {
  ...serverEngine({
    id: "mlx",
    defaultBinary: "mlx_lm.server",
    defaultPort: 8080,
    healthPath: "/v1/models",
    readyDeadlineMs: 300_000,
    metrics: noMetrics,
    supports,
    server: { modelFlag: "--model", servedNameFlag: null, spelling },
  }),
  cliBinary: null,
  managedPackageSpec,
  install: installMlx,
  resolvePythonPath,
  getRuntimeInfo,
};
