import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Effect } from "effect";
import { resolveBinary, runCommandAsyncEffect } from "../../../core/command";
import { resolveVllmPythonPath } from "./vllm-python-path";
import {
  getUpgradeCommandFromEnvironment,
  getVllmUpgradeVersion,
  runEnvironmentUpgradeCommand,
  VLLM_UPGRADE_ENV,
} from "./upgrade-config";
import { VLLM_UPGRADE_TIMEOUT_MS, ENGINE_INSTALL_TIMEOUT_MS } from "../configs";
import { installIntoManagedVenv } from "./managed-venv";
import {
  normalizePackageSpec,
  probeBackendRuntime,
  probeConfigHelp,
  resolvePythonFromScript,
} from "./runtime-target-probes";
import type { ConfigHelpResult, InstallOptions } from "../engine-spec";
import type { RuntimeBackendInfo, RuntimeUpgradeResult } from "@local-studio/contracts/system";

const resolveVllmUpgradeTarget = (version?: string): string =>
  normalizePackageSpec("vllm", version?.trim() || getVllmUpgradeVersion());

const collectPythonCandidates = (): Array<string | null> => {
  const skipSystem = process.env["LOCAL_STUDIO_RUNTIME_SKIP_SYSTEM"] === "1";
  return [
    process.env["LOCAL_STUDIO_RUNTIME_PYTHON"] ?? null,
    skipSystem ? null : resolvePythonFromScript(resolveBinary("vllm")),
    resolveVllmPythonPath(),
    ...(skipSystem ? [] : ["python3", "python"]),
  ];
};

const resolvePythonBinary = (): Effect.Effect<string | null> =>
  Effect.gen(function* () {
    for (const candidate of collectPythonCandidates()) {
      if (!candidate) continue;
      const result = yield* runCommandAsyncEffect(candidate, ["--version"], {
        timeoutMs: 2_000,
      });
      if (result.status === 0) return candidate;
    }
    return null;
  });

const resolveBundledWheel = (): { path: string; version: string | null } | null => {
  const runtimeDirectory = resolve(process.cwd(), "runtime", "wheels");
  if (!existsSync(runtimeDirectory)) return null;
  const latest = readdirSync(runtimeDirectory)
    .filter((file) => file.startsWith("vllm-") && file.endsWith(".whl"))
    .map((file) => {
      const fullPath = join(runtimeDirectory, file);
      return { file, fullPath, mtime: statSync(fullPath).mtimeMs };
    })
    .sort((first, second) => second.mtime - first.mtime)[0];
  if (!latest) return null;
  return {
    path: latest.fullPath,
    version: latest.file.match(/^vllm-([0-9A-Za-z.+-]+)-/)?.[1] ?? null,
  };
};

const resolveVllmBinary = (pythonPath: string | null): string | null => {
  if (pythonPath) {
    const vllmBin = join(dirname(pythonPath), "vllm");
    if (existsSync(vllmBin)) return vllmBin;
  }
  return resolveBinary("vllm");
};

export interface VllmRuntimeInfo {
  installed: boolean;
  version: string | null;
  python_path: string | null;
  vllm_bin: string | null;
  upgrade_command_available: boolean;
  bundled_wheel: { path: string; version: string | null } | null;
}

/** The `/runtime/vllm` shape narrowed to the generic backend row the Settings UI reads. */
export const vllmBackendInfo = (info: VllmRuntimeInfo): RuntimeBackendInfo => ({
  installed: info.installed,
  version: info.version,
  python_path: info.python_path,
  binary_path: info.vllm_bin,
  upgrade_command_available: Boolean(info.python_path),
});

export const getVllmRuntimeInfo = (): Effect.Effect<VllmRuntimeInfo> =>
  Effect.gen(function* () {
    const bundledWheel = resolveBundledWheel();
    const probe = yield* probeBackendRuntime("vllm", collectPythonCandidates());
    return {
      installed: probe.installed,
      version: probe.version,
      python_path: probe.pythonPath,
      vllm_bin: resolveVllmBinary(probe.pythonPath),
      upgrade_command_available: Boolean(probe.pythonPath && probe.runnable),
      bundled_wheel: bundledWheel,
    };
  });

export const getVllmConfigHelp = (): Effect.Effect<ConfigHelpResult> =>
  Effect.gen(function* () {
    const pythonPath = yield* resolvePythonBinary();
    const vllmBin = resolveVllmBinary(pythonPath);
    if (!pythonPath && !vllmBin) return { config: null, error: "vLLM runtime not available" };
    return yield* probeConfigHelp(
      vllmBin ?? pythonPath ?? "",
      vllmBin ? ["serve", "--help"] : ["-m", "vllm.entrypoints.openai.api_server", "--help"],
      5_000,
      "Failed to fetch vLLM config",
    );
  });

export const installVllmRuntime = (
  options: InstallOptions,
): Effect.Effect<RuntimeUpgradeResult> => {
  const envCommand = getUpgradeCommandFromEnvironment(VLLM_UPGRADE_ENV);
  if (envCommand) {
    return runEnvironmentUpgradeCommand(envCommand, options.onSpawn, VLLM_UPGRADE_TIMEOUT_MS);
  }

  const preferBundled = options.preferBundled !== false;
  const bundledWheel = preferBundled ? resolveBundledWheel() : null;
  const packageSpec = bundledWheel ? bundledWheel.path : resolveVllmUpgradeTarget(options.version);

  const installTimeoutMs = options.pythonPath ? VLLM_UPGRADE_TIMEOUT_MS : ENGINE_INSTALL_TIMEOUT_MS;
  return installIntoManagedVenv({
    config: options.config,
    backend: "vllm",
    packageSpec,
    pythonPath: options.pythonPath ?? null,
    createManagedVenv: !options.pythonPath,
    installTimeoutMs,
    onProgress: options.onProgress,
    onSpawn: options.onSpawn,
  });
};
