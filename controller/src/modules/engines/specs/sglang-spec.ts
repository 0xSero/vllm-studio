import { existsSync } from "node:fs";
import { Effect } from "effect";
import type { Config } from "../../../config/env";
import { resolveBinary, runCommandAsyncEffect } from "../../../core/command";
import type { ProcessInfo } from "../../models/types";
import type { RuntimeBackendInfo, RuntimeUpgradeResult } from "@local-studio/contracts/system";
import type {
  BinaryProbeResult,
  ConfigHelpResult,
  EngineSpec,
  InstallOptions,
} from "../engine-spec";
import { installIntoManagedVenv, managedVenvPython } from "../runtimes/managed-venv";
import {
  getUpgradeCommandFromEnvironment,
  runEnvironmentUpgradeCommand,
  SGLANG_UPGRADE_ENV,
} from "../runtimes/upgrade-config";
import { resolveVllmPythonPath } from "../runtimes/vllm-python-path";
import {
  normalizePackageSpec,
  probeConfigHelp,
  pythonBackendRuntimeInfo,
  resolvePythonFromScript,
} from "../runtimes/runtime-target-probes";

const managedPackageSpec = (version?: string | null): string =>
  normalizePackageSpec("sglang[all]", version);

const probeBinary = (binary: string): Effect.Effect<BinaryProbeResult> =>
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
    if (help.status === 0) return { installed: true, version: null, binaryPath: binary };
    return {
      installed: false,
      version: null,
      binaryPath: binary,
      message: version.stderr || "sglang binary is not runnable",
    };
  });

const resolvePythonPath = (config: Config): string | null => {
  const candidates = [
    process.env["LOCAL_STUDIO_SGLANG_PYTHON"]?.trim(),
    managedVenvPython(config, "sglang"),
    "/opt/venvs/active/sglang-latest/bin/python",
    "/opt/venvs/sglang-latest/bin/python",
  ];
  return (
    candidates.find((candidate) => candidate && existsSync(candidate)) ??
    resolvePythonFromScript(resolveBinary("sglang"))
  );
};

const getRuntimeInfo = (
  config: Config,
  runningProcess?: Pick<ProcessInfo, "pid" | "backend"> | null,
): Effect.Effect<RuntimeBackendInfo> =>
  pythonBackendRuntimeInfo({
    backend: "sglang",
    configuredPython: config.sglang_python,
    resolvedPython: resolvePythonPath(config),
    runningProcess,
  });

const getConfigHelp = (config: Config): Effect.Effect<ConfigHelpResult> =>
  Effect.gen(function* () {
    const sglangBin = resolveBinary("sglang");
    if (sglangBin) {
      const result = yield* runCommandAsyncEffect(sglangBin, ["serve", "--help"], {
        timeoutMs: 5_000,
      });
      if (result.status === 0) return { config: result.stdout || null, error: null };
    }
    const python = resolvePythonPath(config) ?? "python3";
    return yield* probeConfigHelp(
      python,
      ["-m", "sglang.launch_server", "--help"],
      5_000,
      "Failed to fetch SGLang config",
    );
  });

const installSglang = (options: InstallOptions): Effect.Effect<RuntimeUpgradeResult> => {
  const envCommand = getUpgradeCommandFromEnvironment(SGLANG_UPGRADE_ENV);
  if (envCommand) return runEnvironmentUpgradeCommand(envCommand, options.onSpawn);
  return installIntoManagedVenv({
    config: options.config,
    backend: "sglang",
    packageSpec: managedPackageSpec(options.version),
    pythonPath:
      options.pythonPath ?? (options.config.sglang_python || resolveVllmPythonPath() || "python3"),
    createManagedVenv: !options.pythonPath,
    onProgress: options.onProgress,
    onSpawn: options.onSpawn,
  });
};

export const sglangSpec: EngineSpec = {
  id: "sglang",
  cliBinary: "sglang",
  managedPackageSpec,
  install: installSglang,
  probeBinary,
  resolvePythonPath,
  getRuntimeInfo,
  getConfigHelp,
};
