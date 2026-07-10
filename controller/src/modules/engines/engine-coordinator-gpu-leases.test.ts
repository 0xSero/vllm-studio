import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { Config } from "../../config/env";
import { createLaunchFailureBudget } from "./process/launch-failure-budget";
import type { LaunchModelOptions, ProcessManager } from "./process/process-manager";
import { EngineCoordinator } from "./engine-coordinator";
import { RecipeStore } from "../models/recipes/recipe-store";
import { parseRecipe } from "../models/recipes/recipe-serializer";
import type { GpuInfo, Recipe } from "../models/types";
import { EventManager } from "../system/event-manager";
import { createGpuLeaseRegistry } from "../system/gpu-leases";

const proUuids = [
  "GPU-00000000-0000-0000-0000-000000000001",
  "GPU-00000000-0000-0000-0000-000000000002",
  "GPU-00000000-0000-0000-0000-000000000003",
  "GPU-00000000-0000-0000-0000-000000000004",
] as const;
const speechUuid = "GPU-00000000-0000-0000-0000-000000003090";

const gpu = (index: number, uuid: string, name: string): GpuInfo => ({
  uuid,
  index,
  name,
  memory_total_mb: 96_000,
  memory_used_mb: 0,
  memory_free_mb: 96_000,
  utilization_pct: 0,
  temp_c: 30,
  power_draw: 0,
  power_limit: 0,
});

const gpus = (): GpuInfo[] => [
  gpu(0, proUuids[0], "NVIDIA RTX PRO 6000 Blackwell"),
  gpu(1, proUuids[1], "NVIDIA RTX PRO 6000 Blackwell"),
  gpu(2, proUuids[2], "NVIDIA RTX PRO 6000 Blackwell"),
  gpu(3, speechUuid, "NVIDIA GeForce RTX 3090"),
  gpu(4, proUuids[3], "NVIDIA RTX PRO 6000 Blackwell"),
];

const recipe = (visibleDevices?: string, id = "lease-test", modelPath = "/models/test"): Recipe =>
  parseRecipe({
    id,
    name: id,
    model_path: modelPath,
    ...(visibleDevices !== undefined
      ? { env_vars: { CUDA_VISIBLE_DEVICES: visibleDevices } }
      : {}),
  });

const config = (directory: string): Config => ({
  host: "127.0.0.1",
  port: 8080,
  inference_host: "127.0.0.1",
  inference_port: 8000,
  data_dir: directory,
  db_path: join(directory, "controller.db"),
  models_dir: join(directory, "models"),
  strict_openai_models: false,
  providers: [],
});

const coordinator = (
  directory: string,
  processManager: ProcessManager,
  registry: ReturnType<typeof createGpuLeaseRegistry>,
  runtime: {
    processExists?: (pid: number) => boolean;
    healthProbe?: (path: string) => Promise<boolean>;
    livenessPollIntervalMs?: number;
    gpuInfo?: () => GpuInfo[];
    requiresNvidiaGpuLeases?: () => boolean;
  } = {},
): EngineCoordinator =>
  new EngineCoordinator({
    config: config(directory),
    eventManager: new EventManager(),
    processManager,
    recipeStore: new RecipeStore(join(directory, "controller.db")),
    launchFailureBudget: createLaunchFailureBudget(),
    gpuLeaseRegistry: registry,
    gpuInfo: gpus,
    ...runtime,
  });

test("blocks an all-GPU model before launch while speech owns the 3090", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-engine-lease-"));
  const registry = createGpuLeaseRegistry();
  let launches = 0;
  const processManager: ProcessManager = {
    findInferenceProcess: async () => null,
    confirmInferenceStopped: async () => true,
    launchModel: async () => {
      launches += 1;
      return { success: false, pid: null, message: "not launched", log_file: null };
    },
    killProcess: async () => true,
  };
  try {
    await Effect.runPromise(registry.claim("speech", [speechUuid]));
    const result = await coordinator(directory, processManager, registry).setActiveRecipe(recipe());

    expect(result).toEqual({
      ok: false,
      error: "The selected model GPU is reserved by local speech",
    });
    expect(launches).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("launches a four-PRO recipe without releasing the speech lease", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-engine-lease-"));
  const registry = createGpuLeaseRegistry();
  let launches = 0;
  const processManager: ProcessManager = {
    findInferenceProcess: async () => null,
    confirmInferenceStopped: async () => true,
    launchModel: async () => {
      launches += 1;
      return { success: false, pid: null, message: "test stop", log_file: null };
    },
    killProcess: async () => true,
  };
  try {
    await Effect.runPromise(registry.claim("speech", [speechUuid]));
    const result = await coordinator(directory, processManager, registry).setActiveRecipe(
      recipe("0,1,2,4"),
    );

    expect(result).toEqual({ ok: false, error: "test stop" });
    expect(launches).toBe(1);
    expect(await Effect.runPromise(registry.snapshot())).toEqual([
      { uuid: speechUuid, owner: "speech" },
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("clears a stopped model lease before a conflicting replacement returns", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-engine-lease-"));
  const registry = createGpuLeaseRegistry();
  let launches = 0;
  const processManager: ProcessManager = {
    findInferenceProcess: async () => ({
      pid: 9001,
      backend: "vllm",
      model_path: "/models/current",
      port: 8000,
      served_model_name: null,
    }),
    confirmInferenceStopped: async () => true,
    launchModel: async () => {
      launches += 1;
      return { success: false, pid: null, message: "not launched", log_file: null };
    },
    killProcess: async () => true,
  };
  try {
    await Effect.runPromise(registry.claim("llm", proUuids));
    await Effect.runPromise(registry.claim("speech", [speechUuid]));
    const result = await coordinator(directory, processManager, registry).setActiveRecipe(recipe());

    expect(result).toEqual({
      ok: false,
      error: "The selected model GPU is reserved by local speech",
    });
    expect(launches).toBe(0);
    expect(await Effect.runPromise(registry.snapshot())).toEqual([
      { uuid: speechUuid, owner: "speech" },
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("releases the exact model lease when a ready process later dies", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-engine-lease-"));
  const registry = createGpuLeaseRegistry();
  let alive = true;
  let launchOptions: LaunchModelOptions | undefined;
  const processManager: ProcessManager = {
    findInferenceProcess: async () => null,
    confirmInferenceStopped: async () => true,
    launchModel: async (_recipe, options) => {
      launchOptions = options;
      return { success: true, pid: 9002, message: "started", log_file: null };
    },
    killProcess: async () => true,
  };
  try {
    const result = await coordinator(directory, processManager, registry, {
      processExists: () => alive,
      healthProbe: async () => true,
      livenessPollIntervalMs: 5,
    }).setActiveRecipe(recipe("0,1,2,4"));

    expect(result).toEqual({ ok: true });
    expect(launchOptions).toEqual({ gpuUuids: proUuids });
    expect(await Effect.runPromise(registry.snapshot())).toEqual(
      proUuids.map((uuid) => ({ uuid, owner: "llm" })),
    );

    alive = false;
    await Effect.runPromise(Effect.sleep(25));

    expect(await Effect.runPromise(registry.snapshot())).toEqual([]);
  } finally {
    alive = false;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an interrupted old monitor cannot release a replacement model lease", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-engine-lease-"));
  const registry = createGpuLeaseRegistry();
  const first = recipe("0,1,2,4", "first", "/models/first");
  const second = recipe("0,1,2,4", "second", "/models/second");
  let current = {
    pid: 9101,
    backend: "vllm" as const,
    model_path: first.model_path,
    port: 8000,
    served_model_name: null,
  };
  const alive = new Map([
    [9101, true],
    [9102, true],
  ]);
  const processManager: ProcessManager = {
    findInferenceProcess: async () => current,
    confirmInferenceStopped: async () => true,
    launchModel: async () => {
      current = { ...current, pid: 9102, model_path: second.model_path };
      return { success: true, pid: 9102, message: "started", log_file: null };
    },
    killProcess: async (pid) => {
      alive.set(pid, false);
      return true;
    },
  };
  const engine = coordinator(directory, processManager, registry, {
    processExists: (pid) => alive.get(pid) ?? false,
    healthProbe: async () => true,
    livenessPollIntervalMs: 5,
  });
  try {
    expect(await engine.setActiveRecipe(first)).toEqual({ ok: true });
    alive.set(9101, false);

    expect(await engine.setActiveRecipe(second)).toEqual({ ok: true });
    await Effect.runPromise(Effect.sleep(25));

    expect(await Effect.runPromise(registry.snapshot())).toEqual(
      proUuids.map((uuid) => ({ uuid, owner: "llm" })),
    );
  } finally {
    alive.set(9102, false);
    await Effect.runPromise(Effect.sleep(10));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects unresolved selectors before launch", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-engine-lease-"));
  const registry = createGpuLeaseRegistry();
  let launches = 0;
  const processManager: ProcessManager = {
    findInferenceProcess: async () => null,
    confirmInferenceStopped: async () => true,
    launchModel: async () => {
      launches += 1;
      return { success: false, pid: null, message: "not launched", log_file: null };
    },
    killProcess: async () => true,
  };
  try {
    const result = await coordinator(directory, processManager, registry).setActiveRecipe(
      recipe("GPU-00000000"),
    );
    expect(result).toEqual({ ok: false, error: "Cannot resolve GPU selectors: GPU-00000000" });
    expect(launches).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects an implicit all-GPU launch without telemetry", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-engine-lease-"));
  const registry = createGpuLeaseRegistry();
  let launches = 0;
  const processManager: ProcessManager = {
    findInferenceProcess: async () => null,
    confirmInferenceStopped: async () => true,
    launchModel: async () => {
      launches += 1;
      return { success: false, pid: null, message: "not launched", log_file: null };
    },
    killProcess: async () => true,
  };
  try {
    const result = await coordinator(directory, processManager, registry, {
      gpuInfo: () => [],
      requiresNvidiaGpuLeases: () => true,
    }).setActiveRecipe(recipe());
    expect(result).toEqual({
      ok: false,
      error: "Cannot verify GPU isolation for an implicit all-GPU launch",
    });
    expect(launches).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("allows an implicit non-NVIDIA launch without NVIDIA telemetry", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-engine-lease-"));
  const registry = createGpuLeaseRegistry();
  let launches = 0;
  const processManager: ProcessManager = {
    findInferenceProcess: async () => null,
    confirmInferenceStopped: async () => true,
    launchModel: async () => {
      launches += 1;
      return { success: false, pid: null, message: "test stop", log_file: null };
    },
    killProcess: async () => true,
  };
  try {
    const result = await coordinator(directory, processManager, registry, {
      gpuInfo: () => [],
      requiresNvidiaGpuLeases: () => false,
    }).setActiveRecipe(recipe());
    expect(result).toEqual({ ok: false, error: "test stop" });
    expect(launches).toBe(1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps an explicit empty selector GPU-free without telemetry", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-engine-lease-"));
  const registry = createGpuLeaseRegistry();
  let launchOptions: LaunchModelOptions | undefined;
  const processManager: ProcessManager = {
    findInferenceProcess: async () => null,
    confirmInferenceStopped: async () => true,
    launchModel: async (_recipe, options) => {
      launchOptions = options;
      return { success: false, pid: null, message: "test stop", log_file: null };
    },
    killProcess: async () => true,
  };
  try {
    const result = await coordinator(directory, processManager, registry, {
      gpuInfo: () => [],
    }).setActiveRecipe(recipe(""));
    expect(result).toEqual({ ok: false, error: "test stop" });
    expect(launchOptions).toEqual({ gpuUuids: [] });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("retains the model lease until cleanup is confirmed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-engine-lease-"));
  const registry = createGpuLeaseRegistry();
  let alive = true;
  let stopped = false;
  const processManager: ProcessManager = {
    findInferenceProcess: async () => null,
    confirmInferenceStopped: async () => stopped,
    launchModel: async () => ({
      success: true,
      pid: 9201,
      message: "started",
      log_file: null,
    }),
    killProcess: async () => true,
  };
  try {
    expect(
      await coordinator(directory, processManager, registry, {
        processExists: () => alive,
        healthProbe: async () => true,
        livenessPollIntervalMs: 5,
      }).setActiveRecipe(recipe("0,1,2,4")),
    ).toEqual({ ok: true });
    alive = false;
    await Effect.runPromise(Effect.sleep(25));
    expect(await Effect.runPromise(registry.snapshot())).toEqual(
      proUuids.map((uuid) => ({ uuid, owner: "llm" })),
    );
    stopped = true;
    await Effect.runPromise(Effect.sleep(15));
    expect(await Effect.runPromise(registry.snapshot())).toEqual([]);
  } finally {
    alive = false;
    rmSync(directory, { recursive: true, force: true });
  }
});
