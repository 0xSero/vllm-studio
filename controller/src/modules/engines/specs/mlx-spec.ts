import { existsSync } from "node:fs";
import { Effect } from "effect";
import type { Config } from "../../../config/env";
import type { ProcessInfo } from "../../models/types";
import type { RuntimeBackendInfo, RuntimeUpgradeResult } from "@local-studio/contracts/system";
import type { EngineSpec, InstallOptions } from "../engine-spec";
import { installIntoManagedVenv, managedVenvPython } from "../runtimes/managed-venv";
import { pythonBackendRuntimeInfo } from "../runtimes/runtime-target-probes";

const managedPackageSpec = (_version?: string | null): string => "mlx-lm";

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
  pythonBackendRuntimeInfo({
    backend: "mlx",
    configuredPython: config.mlx_python,
    resolvedPython: resolvePythonPath(config),
    runningProcess,
    upgradeCommandAvailable: false,
  });

const installMlx = (options: InstallOptions): Effect.Effect<RuntimeUpgradeResult> => {
  const pythonPath = options.pythonPath ?? options.config.mlx_python ?? null;
  return installIntoManagedVenv({
    config: options.config,
    backend: "mlx",
    packageSpec: managedPackageSpec(options.version),
    pythonPath,
    createManagedVenv: !pythonPath,
    onProgress: options.onProgress,
    onSpawn: options.onSpawn,
  });
};

export const mlxSpec: EngineSpec = {
  id: "mlx",
  cliBinary: null,
  managedPackageSpec,
  install: installMlx,
  resolvePythonPath,
  getRuntimeInfo,
};
