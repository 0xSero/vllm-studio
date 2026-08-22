import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { Effect } from "effect";
import type { Config } from "../../../config/env";
import { loadPersistedConfig, savePersistedConfig } from "../../../config/persisted-config";
import { resolveBinary, runCommandEffect } from "../../../core/command";
import type { ProcessInfo } from "../../models/types";
import type {
  EngineBackend,
  RuntimeBackendInfo,
  RuntimeTarget,
} from "@local-studio/contracts/system";
import { detectBackend, listProcesses } from "./process-scan";
import { makeRuntimeTarget } from "./runtime-target-factory";
import { managedLlamaServerPath } from "./managed-llamacpp";
import {
  compareVersions,
  parseCommandBinary,
  parseCommandPython,
  probeBinaryRuntime,
  probePythonRuntime,
  splitEnvironmentList,
  type PythonProbeBackend,
} from "./runtime-target-probes";
import { type EngineOperationError, getEngineSpec } from "../engine-spec";

/**
 * Runtime-target discovery: every way an engine can exist on this box (running process,
 * configured python/binary, managed venv, system install, docker image, bundled wheel),
 * probed and merged into the RuntimeTarget rows the Settings UI shows.
 *
 * Shape: pure candidate builders per stage -> one `materialize` that runs the right
 * probe -> priority merge. The stages only describe *where to look*; how to probe and
 * how to merge lives in exactly one place each.
 */

const BACKENDS: readonly EngineBackend[] = ["vllm", "sglang", "llamacpp", "mlx"];
const ENGINE_LABEL: Record<EngineBackend, string> = {
  vllm: "vLLM",
  sglang: "SGLang",
  llamacpp: "llama.cpp",
  mlx: "MLX",
};

const skipSystem = (): boolean => process.env["LOCAL_STUDIO_RUNTIME_SKIP_SYSTEM"] === "1";

/** A place a runtime might live, before probing. `probe` picks the materializer. */
interface Candidate {
  readonly backend: EngineBackend;
  readonly kind: RuntimeTarget["kind"];
  readonly source: RuntimeTarget["source"];
  readonly probe: "python" | "binary" | "spec-binary" | "none";
  readonly candidate: string;
  readonly label: (resolvedPath: string) => string;
  readonly installed?: boolean;
  readonly version?: string | null;
  readonly active?: boolean;
  readonly pythonPath?: string | null;
  readonly binaryPath?: string | null;
  readonly dockerImage?: string | null;
}

const unique = (values: Array<string | null | undefined>): string[] => [
  ...new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value)),
];

/* ── candidate stages ────────────────────────────────────────────────────── */

const runningCandidates = (
  backend: EngineBackend,
  runningProcess?: ProcessInfo | null,
): Candidate[] => {
  const candidates: Candidate[] = [];
  const activePid = runningProcess?.pid ?? null;
  for (const entry of listProcesses()) {
    if (detectBackend(entry.args) !== backend) continue;
    const pythonPath = backend === "llamacpp" ? null : parseCommandPython(entry.args);
    const binaryPath = backend === "llamacpp" ? parseCommandBinary(entry.args) : null;
    const key = pythonPath ?? binaryPath ?? `${entry.pid}:${entry.args.join(" ")}`;
    candidates.push({
      backend,
      kind: pythonPath ? "venv" : "binary",
      source: "running",
      probe: "none",
      candidate: key,
      label: () => `${backend} running (${basename(key)})`,
      installed: true,
      active: activePid !== null && entry.pid === activePid,
      pythonPath,
      binaryPath,
    });
  }
  return candidates;
};

const configuredPythons = (backend: PythonProbeBackend, config: Config): string[] => {
  const sources: Record<PythonProbeBackend, Array<string | null | undefined>> = {
    vllm: [
      process.env["LOCAL_STUDIO_RUNTIME_PYTHON"],
      ...splitEnvironmentList(process.env["LOCAL_STUDIO_VLLM_PYTHONS"]),
      ...splitEnvironmentList(process.env["LOCAL_STUDIO_RUNTIME_PYTHONS"]),
    ],
    sglang: [
      config.sglang_python,
      ...splitEnvironmentList(process.env["LOCAL_STUDIO_SGLANG_PYTHONS"]),
    ],
    mlx: [config.mlx_python, ...splitEnvironmentList(process.env["LOCAL_STUDIO_MLX_PYTHONS"])],
  };
  return sources[backend].filter((value): value is string => Boolean(value));
};

const venvPythonsOnDisk = (config: Config): string[] => {
  const roots = unique([
    resolve(process.cwd(), "runtime", "venvs"),
    resolve(process.cwd(), "venvs"),
    resolve(process.cwd(), ".venv"),
    resolve(config.data_dir, "runtime", "venvs"),
    resolve(config.data_dir, "venvs"),
    "/opt/venvs/active",
    "/opt/venvs",
  ]);
  const pythons: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    try {
      if (!statSync(root).isDirectory()) continue;
      if (existsSync(join(root, "bin", "python"))) pythons.push(join(root, "bin", "python"));
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const python = join(root, entry.name, "bin", "python");
        if (existsSync(python)) pythons.push(python);
      }
    } catch {
      continue;
    }
  }
  return pythons;
};

const pythonCandidates = (backend: PythonProbeBackend, config: Config): Candidate[] => {
  const spec = getEngineSpec(backend);
  const managedPython = spec.resolvePythonPath?.(config) ?? null;
  const discovered = unique(
    backend === "vllm"
      ? [managedPython, ...venvPythonsOnDisk(config)]
      : [
          backend === "sglang" ? config.sglang_python : config.mlx_python,
          managedPython,
          ...venvPythonsOnDisk(config),
        ],
  );
  const candidates: Candidate[] = [
    ...unique(configuredPythons(backend, config)).map(
      (candidate): Candidate => ({
        backend,
        kind: "venv",
        source: "configured",
        probe: "python",
        candidate,
        label: (path) => `${backend} configured (${basename(path)})`,
      }),
    ),
    ...discovered.map(
      (candidate): Candidate => ({
        backend,
        kind: "venv",
        source: "discovered",
        probe: "python",
        candidate,
        label: (path) => `${backend} venv (${basename(dirname(dirname(path)))})`,
      }),
    ),
  ];
  const systemPython = skipSystem() ? null : (resolveBinary("python3") ?? resolveBinary("python"));
  if (systemPython) {
    candidates.push({
      backend,
      kind: "system",
      source: "discovered",
      probe: "python",
      candidate: systemPython,
      label: () => `${backend} system Python`,
    });
  }
  const specBinary = spec.cliBinary && !skipSystem() ? resolveBinary(spec.cliBinary) : null;
  if (specBinary && spec.probeBinary) {
    candidates.push({
      backend,
      kind: "system",
      source: "discovered",
      probe: "spec-binary",
      candidate: specBinary,
      label: () => `${ENGINE_LABEL[backend]} system binary`,
    });
  }
  return candidates;
};

const llamacppCandidates = (config: Config): Candidate[] => {
  const managedBinary = managedLlamaServerPath(config);
  const candidates: Candidate[] = unique([
    config.llama_bin,
    existsSync(managedBinary) ? managedBinary : undefined,
  ]).map((candidate) => ({
    backend: "llamacpp",
    kind: candidate.includes("/") ? "binary" : "system",
    source: "configured",
    probe: "binary",
    candidate,
    label: (path) => `llama.cpp configured (${basename(path)})`,
  }));
  const systemBinary = skipSystem() ? null : resolveBinary("llama-server");
  if (systemBinary) {
    candidates.push({
      backend: "llamacpp",
      kind: "system",
      source: "discovered",
      probe: "binary",
      candidate: systemBinary,
      label: () => "llama.cpp system binary",
    });
  }
  return candidates;
};

const DOCKER_IMAGE_PATTERN: Record<EngineBackend, RegExp> = {
  vllm: /(^|[/:_-])vllm($|[/:_-])/i,
  sglang: /(^|[/:_-])sglang($|[/:_-])/i,
  llamacpp: /(llama\.cpp|llamacpp|llama-server)/i,
  mlx: /(mlx-lm|mlx_lm|mlx)/i,
};

const dockerCandidates = (): Effect.Effect<Candidate[]> =>
  Effect.gen(function* () {
    if (process.env["LOCAL_STUDIO_RUNTIME_SKIP_DOCKER"] === "1") return [];
    const docker = resolveBinary("docker");
    if (!docker) return [];
    const candidates: Candidate[] = [];
    const collect = (stdout: string, running: boolean): void => {
      for (const image of stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)) {
        for (const backend of BACKENDS) {
          if (!DOCKER_IMAGE_PATTERN[backend].test(image)) continue;
          candidates.push({
            backend,
            kind: "docker",
            source: running ? "running" : "discovered",
            probe: "none",
            candidate: image,
            label: () =>
              running
                ? `${backend} running Docker (${image})`
                : `${backend} Docker image (${image})`,
            installed: true,
            active: running,
            dockerImage: image,
          });
        }
      }
    };
    const images = yield* runCommandEffect(
      docker,
      ["images", "--format", "{{.Repository}}:{{.Tag}}"],
      3_000,
    );
    if (images.status === 0) collect(images.stdout, false);
    const processes = yield* runCommandEffect(docker, ["ps", "--format", "{{.Image}}"], 3_000);
    if (processes.status === 0) collect(processes.stdout, true);
    return candidates;
  });

const bundledCandidates = (): Candidate[] => {
  const wheelRoot = resolve(process.cwd(), "runtime", "wheels");
  if (!existsSync(wheelRoot)) return [];
  try {
    return readdirSync(wheelRoot)
      .filter((file) => file.startsWith("vllm-") && file.endsWith(".whl"))
      .map((file) => {
        const fullPath = join(wheelRoot, file);
        const version = file.match(/^vllm-([0-9A-Za-z.+-]+)-/)?.[1] ?? null;
        return {
          backend: "vllm",
          kind: "binary",
          source: "bundled",
          probe: "none",
          candidate: fullPath,
          label: () => `vLLM bundled wheel (${version ?? file})`,
          installed: true,
          version,
          binaryPath: fullPath,
        } satisfies Candidate;
      });
  } catch {
    return [];
  }
};

/* ── materialize + merge ─────────────────────────────────────────────────── */

/** What a probe (or the candidate itself, when `probe === "none"`) contributes to a target. */
type ProbedFacts = Omit<
  Parameters<typeof makeRuntimeTarget>[0],
  "backend" | "kind" | "source" | "label"
>;

/** Union-safe readers: the binary probes only sometimes carry these fields. */
const probedPython = (probe: { installed: boolean; pythonPath?: string | null }): string | null =>
  probe.pythonPath ?? null;
const probedMessage = (probe: { installed: boolean; message?: string }): string | undefined =>
  probe.message;

const probeFacts = (candidate: Candidate): Effect.Effect<ProbedFacts, EngineOperationError> =>
  Effect.gen(function* () {
    if (candidate.probe === "none") {
      return {
        key: candidate.candidate,
        installed: candidate.installed ?? false,
        version: candidate.version ?? null,
        active: candidate.active ?? false,
        pythonPath: candidate.pythonPath ?? null,
        binaryPath: candidate.binaryPath ?? null,
        dockerImage: candidate.dockerImage ?? null,
      };
    }
    if (candidate.probe === "python") {
      const probe = yield* probePythonRuntime(
        candidate.backend as PythonProbeBackend,
        candidate.candidate,
      );
      const key = probe.pythonPath ?? candidate.candidate;
      return {
        key,
        installed: probe.installed,
        version: probe.version,
        pythonPath: key,
        healthMessage: probe.message,
      };
    }
    const specProbe = getEngineSpec(candidate.backend).probeBinary;
    const probe =
      candidate.probe === "binary"
        ? yield* probeBinaryRuntime(candidate.candidate)
        : specProbe
          ? yield* specProbe(candidate.candidate)
          : { installed: false, version: null, binaryPath: candidate.candidate };
    return {
      key: probe.binaryPath ?? candidate.candidate,
      installed: probe.installed,
      version: probe.version,
      pythonPath: probedPython(probe),
      binaryPath: probe.binaryPath,
      healthMessage: probedMessage(probe),
    };
  });

const materialize = (candidate: Candidate): Effect.Effect<RuntimeTarget, EngineOperationError> =>
  probeFacts(candidate).pipe(
    Effect.map((facts) =>
      makeRuntimeTarget({
        backend: candidate.backend,
        kind: candidate.kind,
        source: candidate.source,
        label: candidate.label(facts.key),
        ...facts,
      }),
    ),
  );

const sourcePriority = (source: RuntimeTarget["source"]): number =>
  source === "running" ? 4 : source === "configured" ? 3 : source === "bundled" ? 2 : 1;

/** Same id discovered twice: keep the higher-priority identity, union the facts. */
const addTarget = (targets: RuntimeTarget[], target: RuntimeTarget): void => {
  const existingIndex = targets.findIndex((candidate) => candidate.id === target.id);
  if (existingIndex === -1) {
    targets.push(target);
    return;
  }
  const existing = targets[existingIndex];
  if (!existing) return;
  const keepExisting = sourcePriority(existing.source) >= sourcePriority(target.source);
  targets[existingIndex] = {
    ...existing,
    ...target,
    label: keepExisting ? existing.label : target.label,
    active: existing.active || target.active,
    installed: existing.installed || target.installed,
    version: existing.version ?? target.version,
    health: existing.health.status === "ok" ? existing.health : target.health,
    source: keepExisting ? existing.source : target.source,
  };
};

/* ── public surface (unchanged) ──────────────────────────────────────────── */

const TARGET_CACHE_TTL_MS = 300_000;
let targetsCache: {
  expiresAt: number;
  configDataDirectory: string;
  value: RuntimeTarget[];
} | null = null;

export const clearRuntimeTargetsCache = (): void => {
  targetsCache = null;
};

const withSelection = (targets: RuntimeTarget[], config: Config): RuntimeTarget[] => {
  const persisted = loadPersistedConfig(config.data_dir);
  const selectedIds = persisted.selected_runtime_target_ids ?? {};
  return targets.map((target) => ({
    ...target,
    active: target.active || selectedIds[target.backend] === target.id,
  }));
};

const BACKEND_ORDER: Record<EngineBackend, number> = { vllm: 0, sglang: 1, llamacpp: 2, mlx: 3 };

const sortTargets = (targets: RuntimeTarget[]): RuntimeTarget[] =>
  [...targets].sort(
    (first, second) =>
      BACKEND_ORDER[first.backend] - BACKEND_ORDER[second.backend] ||
      Number(second.active) - Number(first.active) ||
      Number(second.installed) - Number(first.installed) ||
      compareVersions(second.version, first.version) ||
      first.label.localeCompare(second.label),
  );

export const getRuntimeTargets = (
  config: Config,
  runningProcess?: ProcessInfo | null,
): Effect.Effect<RuntimeTarget[], EngineOperationError> =>
  Effect.gen(function* () {
    const now = Date.now();
    if (
      targetsCache &&
      targetsCache.expiresAt > now &&
      targetsCache.configDataDirectory === config.data_dir
    ) {
      return targetsCache.value;
    }

    const all = [
      ...BACKENDS.flatMap((backend) => [
        ...runningCandidates(backend, runningProcess),
        ...(backend === "llamacpp"
          ? llamacppCandidates(config)
          : pythonCandidates(backend as PythonProbeBackend, config)),
      ]),
      ...(yield* dockerCandidates()),
      ...bundledCandidates(),
    ];

    const materialized = yield* Effect.forEach(all, materialize, { concurrency: "unbounded" });
    const targets: RuntimeTarget[] = [];
    for (const target of materialized) addTarget(targets, target);

    const selectedTargets = sortTargets(withSelection(targets, config));
    targetsCache = {
      expiresAt: now + TARGET_CACHE_TTL_MS,
      configDataDirectory: config.data_dir,
      value: selectedTargets,
    };
    return selectedTargets;
  });

export const getRuntimeTarget = (
  config: Config,
  targetIdValue: string,
  runningProcess?: ProcessInfo | null,
): Effect.Effect<RuntimeTarget | null, EngineOperationError> =>
  getRuntimeTargets(config, runningProcess).pipe(
    Effect.map((targets) => targets.find((target) => target.id === targetIdValue) ?? null),
  );

export const selectRuntimeTarget = (
  config: Config,
  targetIdValue: string,
  runningProcess?: ProcessInfo | null,
): Effect.Effect<RuntimeTarget | null, EngineOperationError> =>
  Effect.gen(function* () {
    const target = yield* getRuntimeTarget(config, targetIdValue, runningProcess);
    if (!target) return null;
    const persisted = loadPersistedConfig(config.data_dir);
    savePersistedConfig(config.data_dir, {
      selected_runtime_target_ids: {
        ...(persisted.selected_runtime_target_ids ?? {}),
        [target.backend]: target.id,
      },
    });
    targetsCache = null;
    return { ...target, active: true };
  });

export const getDefaultRuntimeTarget = (
  config: Config,
  backend: EngineBackend,
  runningProcess?: ProcessInfo | null,
): Effect.Effect<RuntimeTarget | null, EngineOperationError> =>
  getRuntimeTargets(config, runningProcess).pipe(
    Effect.map((allTargets) => {
      const targets = allTargets.filter((target) => target.backend === backend);
      const newestInstalled = targets
        .filter((target) => target.installed)
        .sort((first, second) => compareVersions(second.version, first.version))[0];
      return (
        targets.find((target) => target.active) ??
        newestInstalled ??
        targets.find((target) => target.source === "configured") ??
        targets[0] ??
        null
      );
    }),
  );

export const runtimeTargetToBackendInfo = (target: RuntimeTarget | null): RuntimeBackendInfo => ({
  installed: target?.installed ?? false,
  version: target?.version ?? null,
  python_path: target?.pythonPath ?? null,
  binary_path: target?.binaryPath ?? null,
  upgrade_command_available: target?.capabilities.canUpdate ?? false,
});
