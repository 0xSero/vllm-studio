import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { Effect } from "effect";
import type { Config } from "../../config/env";
import { resolveBinary, runCommandAsyncEffect } from "../../core/command";
import { isInternalRecipeKey, isJsonStringArgumentKey } from "@local-studio/contracts/engine-args";
import { getExtraArgument } from "../engines/argument-utilities";
import { resolveLlamaBinary } from "../engines/specs/backend-specs";
import type { GpuInfo, ProcessInfo, Recipe } from "../models/types";
import type { EventManager } from "../system/event-manager";
import { resolveRecipeGpuUuids } from "../system/gpu-leases";
import { getGpuInfo } from "../system/platform/gpu";
import type {
  DeviceId,
  EngineId,
  HostProfile,
  EngineRuntimeKind,
  InstanceRecord,
  LaunchFailure,
} from "./contracts";
import { makeTelemetry, profileFrom, type Telemetry } from "./devices/snapshot";
import { makeInstanceStore, type InstanceStore } from "./instances/store";
import { makeDockerLauncher } from "./launchers/docker";
import { makeProcessLauncher } from "./launchers/process";
import type { Launcher } from "./launchers/launcher";
import {
  getDefaultReasoningParser,
  getDefaultToolCallParser,
  shouldEnableExpertParallel,
} from "./recipe-defaults";
import { makeComputeService, type ComputeLaunchInput, type ComputeService } from "./lifecycle";

/**
 * Assembly point: telemetry + store + launchers wired into one ComputeService. This is
 * the compute layer's entire footprint in AppContext — there is no other state.
 */

export interface Compute {
  readonly service: ComputeService;
  readonly telemetry: Telemetry;
  readonly store: InstanceStore;
  readonly host: () => Effect.Effect<HostProfile>;
  readonly findInferenceProcess: () => Effect.Effect<ProcessInfo | null>;
  readonly getCurrentRecipe: () => Effect.Effect<Recipe | null, unknown>;
  readonly launchingRecipeId: () => string | null;
  readonly launchRecipe: (recipe: Recipe) => Effect.Effect<InstanceRecord, LaunchFailure>;
  readonly evict: () => Effect.Effect<boolean>;
  readonly cancelLaunch: () => Effect.Effect<boolean>;
  readonly waitForHealthy: (timeoutMs: number) => Effect.Effect<boolean>;
}

const DOCKER_PROBE_TIMEOUT_MS = 5_000;
/** Docker appearing or losing GPU passthrough mid-run is rare; refresh occasionally. */
const DOCKER_PROBE_TTL_MS = 60_000;

interface DockerStatus {
  readonly docker: boolean;
  readonly dockerGpu: boolean;
}

const LLM_INSTANCE = "llm";
const RUNNING_STATES = new Set(["starting", "ready", "unhealthy"]);

const normalizeJsonArgument = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeJsonArgument);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key.replace(/-/g, "_"),
        normalizeJsonArgument(entry),
      ]),
    );
  }
  return value;
};

const serializeExtraArgument = (flag: string, key: string, value: unknown): string[] => {
  if (value === true) return [flag];
  if (value === false || value === undefined || value === null) return [];
  if (typeof value === "string" && isJsonStringArgumentKey(key)) {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return [flag, JSON.stringify(normalizeJsonArgument(JSON.parse(trimmed) as unknown))];
      } catch {
        return [flag, value];
      }
    }
  }
  if (Array.isArray(value) || (value && typeof value === "object")) {
    return [flag, JSON.stringify(normalizeJsonArgument(value))];
  }
  return [flag, String(value)];
};

export const serializeRecipeExtraArguments = (recipe: Recipe): string[] => {
  const argv: string[] = [];
  for (const [key, value] of Object.entries(recipe.extra_args ?? {})) {
    if (!isInternalRecipeKey(key)) {
      argv.push(...serializeExtraArgument(`--${key.replace(/_/g, "-")}`, key, value));
    }
  }
  if (
    recipe.backend === "vllm" &&
    !argv.includes("--enable-expert-parallel") &&
    shouldEnableExpertParallel(
      recipe,
      getExtraArgument(recipe.extra_args, "enable-expert-parallel"),
    )
  ) {
    argv.push("--enable-expert-parallel");
  }
  return argv;
};

const splitLaunchCommand = (command: string): string[] => {
  const result: string[] = [];
  let current = "";
  let quote: string | null = null;
  let escaping = false;
  for (const character of command) {
    if (escaping) {
      current += character;
      escaping = false;
    } else if (character === "\\") {
      escaping = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) {
        result.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }
  if (escaping) current += "\\";
  if (current) result.push(current);
  return result;
};

const launchCommandOverride = (recipe: Recipe): string[] | null => {
  const override =
    getExtraArgument(recipe.extra_args, "launch_command") ??
    getExtraArgument(recipe.extra_args, "custom_command");
  if (typeof override !== "string" || !override.trim()) return null;
  if (process.env["LOCAL_STUDIO_ALLOW_CUSTOM_LAUNCH_COMMAND"] !== "true") return null;
  const argv = splitLaunchCommand(override);
  return argv.length > 0 ? argv : null;
};

const siblingBinary = (pythonPath: string | undefined | null, name: string): string | null => {
  if (!pythonPath) return null;
  const candidate = join(dirname(pythonPath), name);
  return existsSync(candidate) ? candidate : null;
};

const resolveEngineBinary = (recipe: Recipe, config: Config): string | null => {
  const recipePython =
    recipe.python_path && existsSync(recipe.python_path) ? recipe.python_path : null;
  if (recipe.backend === "vllm")
    return siblingBinary(recipePython, "vllm") ?? resolveBinary("vllm");
  if (recipe.backend === "sglang") {
    return siblingBinary(recipePython ?? config.sglang_python, "sglang") ?? resolveBinary("sglang");
  }
  if (recipe.backend === "llamacpp") {
    try {
      return resolveLlamaBinary(recipe, config);
    } catch {
      return null;
    }
  }
  if (recipe.backend === "mlx") {
    return (
      siblingBinary(recipePython ?? config.mlx_python, "mlx_lm.server") ??
      resolveBinary("mlx_lm.server")
    );
  }
  return null;
};

const resolveRecipeBinary = (recipe: Recipe, config: Config): string | null => {
  if (recipe.runtime.kind === "binary" || recipe.runtime.kind === "system") {
    return recipe.runtime.ref;
  }
  return recipe.runtime.kind === "docker" ? null : resolveEngineBinary(recipe, config);
};

export const recipeToLaunchInput = (
  recipe: Recipe,
  config: Config,
  devices: readonly DeviceId[],
): ComputeLaunchInput => {
  const override = launchCommandOverride(recipe);
  const dockerImage = recipe.runtime.kind === "docker" ? recipe.runtime.ref : null;
  return {
    name: LLM_INSTANCE,
    engine: recipe.backend as EngineId,
    recipeId: recipe.id,
    runtime: dockerImage ? "docker" : "process",
    deviceCount: devices.length,
    ...(devices.length > 0 ? { devices } : {}),
    portOverride: recipe.port || config.inference_port,
    modelPath: recipe.model_path,
    servedModelName: recipe.served_model_name ?? recipe.model_path,
    options: {
      tensorParallel: recipe.tensor_parallel_size,
      pipelineParallel: recipe.pipeline_parallel_size,
      maxContextLength: recipe.max_model_len,
      memoryFraction: recipe.gpu_memory_utilization,
      maxConcurrentRequests: recipe.max_num_seqs,
      kvCacheDtype: recipe.kv_cache_dtype === "auto" ? null : recipe.kv_cache_dtype,
      dtype: recipe.dtype ?? null,
      quantization: recipe.quantization ?? null,
      trustRemoteCode: recipe.trust_remote_code,
      toolCallParser: recipe.tool_call_parser ?? getDefaultToolCallParser(recipe) ?? null,
      reasoningParser: recipe.reasoning_parser ?? getDefaultReasoningParser(recipe) ?? null,
    },
    extraArgs: serializeRecipeExtraArguments(recipe),
    env: recipe.env_vars ?? {},
    dockerImage,
    binary: resolveRecipeBinary(recipe, config),
    ...(override ? { commandOverride: override } : {}),
  };
};

const probeDocker = (): Effect.Effect<DockerStatus> =>
  Effect.gen(function* () {
    const info = yield* runCommandAsyncEffect("docker", ["info", "--format", "{{.Runtimes}}"], {
      timeoutMs: DOCKER_PROBE_TIMEOUT_MS,
    });
    if (info.status !== 0) return { docker: false, dockerGpu: false };
    // The NVIDIA container runtime advertises itself in `docker info`; ROCm needs no
    // special runtime (plain device mounts), so any working docker on linux counts.
    const gpuRuntime = info.stdout.includes("nvidia");
    return { docker: true, dockerGpu: gpuRuntime || process.platform === "linux" };
  }).pipe(Effect.catchCause(() => Effect.succeed({ docker: false, dockerGpu: false })));

export const makeCompute = (
  config: Config,
  eventManager: EventManager,
  getRecipe: (recipeId: string) => Effect.Effect<Recipe | null, unknown>,
): Compute => {
  const telemetry = makeTelemetry({
    storagePaths: [config.data_dir, config.models_dir],
  });
  const store = makeInstanceStore(config.data_dir);

  let dockerCache: { readonly at: number; readonly value: DockerStatus } | null = null;
  const dockerStatus = (): Effect.Effect<DockerStatus> =>
    Effect.gen(function* () {
      if (dockerCache && Date.now() - dockerCache.at < DOCKER_PROBE_TTL_MS) {
        return dockerCache.value;
      }
      const value = yield* probeDocker();
      dockerCache = { at: Date.now(), value };
      return value;
    });

  let lastProfile: HostProfile | null = null;
  const host = (): Effect.Effect<HostProfile> =>
    Effect.gen(function* () {
      const snapshot = yield* telemetry.snapshot();
      const docker = yield* dockerStatus();
      const profile = profileFrom(snapshot, {
        nodeId: "self",
        docker: docker.docker,
        dockerGpu: docker.dockerGpu,
      });
      lastProfile = profile;
      return profile;
    });

  const processLauncher = makeProcessLauncher(store.logPath);
  const launcherFor = (runtime: EngineRuntimeKind): Launcher =>
    runtime === "docker" ? makeDockerLauncher(lastProfile?.accelerator ?? "cuda") : processLauncher;

  const freeDevices = (): Effect.Effect<readonly DeviceId[]> =>
    telemetry
      .snapshot()
      .pipe(Effect.map((snapshot) => snapshot.accelerators.map((accelerator) => accelerator.id)));

  const service = makeComputeService({
    store,
    launcherFor,
    host,
    freeDevices,
    onEvent: (name, stage, message) => eventManager.publishLaunchProgress(name, stage, message),
  });

  const llmRecord = (): InstanceRecord | null => store.read(LLM_INSTANCE);
  const findInferenceProcess = (): Effect.Effect<ProcessInfo | null> =>
    Effect.gen(function* () {
      const record = llmRecord();
      if (!record || record.ref === null || !RUNNING_STATES.has(yield* service.stateOf(record))) {
        return null;
      }
      const recipe = yield* getRecipe(record.recipeId).pipe(
        Effect.catch(() => Effect.succeed(null)),
      );
      return {
        pid: record.ref.kind === "process" ? record.ref.pid : 0,
        backend: record.engine === "exllamav3" ? "unknown" : record.engine,
        model_path: recipe?.model_path ?? null,
        port: record.port,
        served_model_name: recipe?.served_model_name ?? null,
      } satisfies ProcessInfo;
    });
  const getCurrentRecipe = (): Effect.Effect<Recipe | null, unknown> => {
    const record = llmRecord();
    return record ? getRecipe(record.recipeId) : Effect.succeed(null);
  };
  const launchingRecipeId = (): string | null => {
    const record = llmRecord();
    return record?.ref === null ? record.recipeId : null;
  };
  const launchRecipe = (recipe: Recipe): Effect.Effect<InstanceRecord, LaunchFailure> =>
    Effect.gen(function* () {
      const gpus = yield* getGpuInfo().pipe(Effect.catch(() => Effect.succeed([] as GpuInfo[])));
      const resolution = resolveRecipeGpuUuids(recipe, gpus);
      if (resolution.unresolvedTokens.length > 0) {
        return yield* Effect.fail<LaunchFailure>({
          kind: "spawn-failed",
          detail: `GPU selectors could not be resolved: ${resolution.unresolvedTokens.join(", ")}`,
        });
      }
      return yield* service.launch(recipeToLaunchInput(recipe, config, resolution.uuids));
    });
  const waitForHealthy = (timeoutMs: number): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const record = llmRecord();
        if (record && (yield* service.stateOf(record)) === "ready") return true;
        yield* Effect.sleep(2_000);
      }
      return false;
    });

  return {
    service,
    telemetry,
    store,
    host,
    findInferenceProcess,
    getCurrentRecipe,
    launchingRecipeId,
    launchRecipe,
    evict: () => service.stop(LLM_INSTANCE),
    cancelLaunch: () => service.cancel(LLM_INSTANCE),
    waitForHealthy,
  };
};
