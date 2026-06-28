import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ChildProcess } from "node:child_process";
import { resolveBinary, runCommandAsync } from "../../../core/command";
import { resolveVllmPythonPath } from "./vllm-python-path";
import {
  getUpgradeCommandFromEnvironment,
  getVllmUpgradeVersion,
  VLLM_UPGRADE_ENV,
} from "./upgrade-config";
import { VLLM_RUNTIME_COMMAND_TIMEOUT_MS, VLLM_UPGRADE_TIMEOUT_MS, ENGINE_INSTALL_TIMEOUT_MS } from "../configs";
import { installIntoManagedVenv } from "./managed-venv";
import type { InstallOptions } from "../engine-spec";
import type { RuntimeUpgradeResult } from "../../shared/system-types";

const resolveVllmUpgradeTarget = (version?: string): string => {
  const configured =
    version && version.trim().length > 0 ? version.trim() : getVllmUpgradeVersion();
  const normalized = configured.trim();
  if (!normalized) return "vllm";
  return normalized.includes("==") || normalized.endsWith(".whl")
    ? normalized
    : `vllm==${normalized}`;
};

const resolvePythonFromScript = (scriptPath: string | null | undefined): string | null => {
  if (!scriptPath || !existsSync(scriptPath)) return null;
  try {
    const firstLine = readFileSync(scriptPath, "utf8").split("\n")[0]?.trim() ?? "";
    if (!firstLine.startsWith("#!")) return null;
    const command = firstLine.slice(2).trim().split(/\s+/);
    const executable = command[0];
    const envPython = executable?.endsWith("/env") ? command.find((part) => part.startsWith("python")) : null;
    const python = envPython ?? executable;
    if (!python || !python.includes("python")) return null;
    return python.includes("/") ? python : (resolveBinary(python) ?? python);
  } catch {
    return null;
  }
};

const resolvePythonBinary = async (preferredPython?: string | null): Promise<string | null> => {
  const candidates: string[] = [];
  if (preferredPython) candidates.push(preferredPython);
  const override = process.env["LOCAL_STUDIO_RUNTIME_PYTHON"];
  if (override) candidates.push(override);
  const skipSystem = process.env["LOCAL_STUDIO_RUNTIME_SKIP_SYSTEM"] === "1";
  const systemVllmPython = skipSystem ? null : resolvePythonFromScript(resolveBinary("vllm"));
  if (!skipSystem && systemVllmPython) candidates.push(systemVllmPython);
  const runtimePython = resolveVllmPythonPath();
  if (runtimePython) candidates.push(runtimePython);
  if (!skipSystem) candidates.push("python3", "python");
  for (const candidate of candidates) {
    const result = await runCommandAsync(candidate, ["--version"], { timeoutMs: 2_000 });
    if (result.status === 0) return candidate;
  }
  return null;
};

const collectPythonCandidates = (preferredPython?: string | null): string[] => {
  const candidates: string[] = [];
  if (preferredPython) candidates.push(preferredPython);
  const override = process.env["LOCAL_STUDIO_RUNTIME_PYTHON"];
  if (override) candidates.push(override);
  const skipSystem = process.env["LOCAL_STUDIO_RUNTIME_SKIP_SYSTEM"] === "1";
  const systemVllmPython = skipSystem ? null : resolvePythonFromScript(resolveBinary("vllm"));
  if (!skipSystem && systemVllmPython) candidates.push(systemVllmPython);
  const runtimePython = resolveVllmPythonPath();
  if (runtimePython) candidates.push(runtimePython);
  if (!skipSystem) candidates.push("python3", "python");
  return candidates.filter((c, index, array) => array.indexOf(c) === index);
};

const resolveBundledWheel = (): { path: string; version: string | null } | null => {
  const runtimeDirectory = resolve(process.cwd(), "runtime", "wheels");
  if (!existsSync(runtimeDirectory)) return null;
  const candidates = readdirSync(runtimeDirectory).filter(
    (file) => file.startsWith("vllm-") && file.endsWith(".whl")
  );
  if (candidates.length === 0) return null;
  const withStats = candidates
    .map((file) => {
      const fullPath = join(runtimeDirectory, file);
      return { file, fullPath, mtime: statSync(fullPath).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  const latest = withStats[0];
  if (!latest) return null;
  const versionMatch = latest.file.match(/^vllm-([0-9A-Za-z.+-]+)-/);
  return { path: latest.fullPath, version: versionMatch?.[1] ?? null };
};

const resolveVllmBinary = (pythonPath: string | null): string | null => {
  if (pythonPath) {
    const vllmBin = join(dirname(pythonPath), "vllm");
    if (existsSync(vllmBin)) return vllmBin;
  }
  return resolveBinary("vllm");
};

const VLLM_IMPORT_PROBE =
  "import json, sys\ntry:\n import vllm\n print(json.dumps({'version': vllm.__version__, 'python': sys.executable}))\nexcept Exception:\n print(json.dumps({'version': None, 'python': sys.executable}))";

export const getVllmRuntimeInfo = async (preferredPython?: string | null): Promise<{
  installed: boolean;
  version: string | null;
  python_path: string | null;
  vllm_bin: string | null;
  upgrade_command_available: boolean;
  bundled_wheel: { path: string; version: string | null } | null;
}> => {
  const bundledWheel = resolveBundledWheel();
  const candidates = collectPythonCandidates(preferredPython);
  for (const candidate of candidates) {
    const check = await runCommandAsync(candidate, ["--version"], { timeoutMs: 2_000 });
    if (check.status !== 0) continue;
    const result = await runCommandAsync(candidate, ["-c", VLLM_IMPORT_PROBE], {
      timeoutMs: VLLM_RUNTIME_COMMAND_TIMEOUT_MS,
    });
    if (result.status !== 0) continue;
    let parsed: { version?: string | null; python?: string | null } | null = null;
    try {
      parsed = JSON.parse(result.stdout) as { version?: string | null; python?: string | null };
    } catch {
      continue;
    }
    if (parsed?.version) {
      const vllmBin = resolveVllmBinary(parsed.python ?? candidate);
      return {
        installed: true,
        version: parsed.version,
        python_path: parsed.python ?? candidate,
        vllm_bin: vllmBin,
        upgrade_command_available: true,
        bundled_wheel: bundledWheel,
      };
    }
  }
  const fallbackPython = await resolvePythonBinary();
  const vllmBin = resolveVllmBinary(fallbackPython);
  return {
    installed: false,
    version: null,
    python_path: fallbackPython,
    vllm_bin: vllmBin,
    upgrade_command_available: Boolean(fallbackPython),
    bundled_wheel: bundledWheel,
  };
};

export const getVllmConfigHelp = async (): Promise<{
  config: string | null;
  error: string | null;
}> => {
  const pythonPath = await resolvePythonBinary();
  const vllmBin = resolveVllmBinary(pythonPath);
  if (!pythonPath && !vllmBin) return { config: null, error: "vLLM runtime not available" };
  const command = vllmBin ?? pythonPath ?? "";
  const args = vllmBin
    ? ["serve", "--help"]
    : ["-m", "vllm.entrypoints.openai.api_server", "--help"];
  const result = await runCommandAsync(command, args, { timeoutMs: 15_000 });
  if (result.status !== 0)
    return { config: result.stdout || null, error: result.stderr || "Failed to fetch vLLM config" };
  return { config: result.stdout || null, error: null };
};

const runEnvironmentUpgradeCommand = async (
  command: string,
  onSpawn?: ((child: ChildProcess) => void) | undefined,
): Promise<RuntimeUpgradeResult> => {
  const result = await runCommandAsync(command, [], {
    timeoutMs: VLLM_UPGRADE_TIMEOUT_MS,
    onSpawn,
  });
  if (result.status === 0) {
    return {
      success: true,
      version: null,
      output: result.stdout || null,
      error: result.stderr || null,
      used_command: command,
    };
  }
  return {
    success: false,
    version: null,
    output: result.stdout || null,
    error: result.timedOut
      ? `Upgrade timed out after ${Math.round(VLLM_UPGRADE_TIMEOUT_MS / 60_000)} minutes`
      : result.stderr || "Upgrade failed",
    used_command: command,
  };
};

export const installVllmRuntime = async (
  options: InstallOptions,
): Promise<RuntimeUpgradeResult> => {
  const envCommand = getUpgradeCommandFromEnvironment(VLLM_UPGRADE_ENV);
  if (envCommand) return runEnvironmentUpgradeCommand(envCommand, options.onSpawn);

  const preferBundled = options.preferBundled !== false;
  const bundledWheel = preferBundled ? resolveBundledWheel() : null;
  const packageSpec = bundledWheel
    ? bundledWheel.path
    : resolveVllmUpgradeTarget(options.version);

  const installTimeoutMs = options.pythonPath
    ? VLLM_UPGRADE_TIMEOUT_MS
    : ENGINE_INSTALL_TIMEOUT_MS;
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

