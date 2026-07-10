import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { Config } from "../../config/env";
import { createLaunchFailureBudget } from "./process/launch-failure-budget";
import type { ProcessManager } from "./process/process-manager";
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

const recipe = (visibleDevices?: string): Recipe =>
  parseRecipe({
    id: "lease-test",
    name: "Lease test",
    model_path: "/models/test",
    ...(visibleDevices ? { env_vars: { CUDA_VISIBLE_DEVICES: visibleDevices } } : {}),
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
): EngineCoordinator =>
  new EngineCoordinator({
    config: config(directory),
    eventManager: new EventManager(),
    processManager,
    recipeStore: new RecipeStore(join(directory, "controller.db")),
    launchFailureBudget: createLaunchFailureBudget(),
    gpuLeaseRegistry: registry,
    gpuInfo: gpus,
  });

test("blocks an all-GPU model before launch while speech owns the 3090", async () => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-engine-lease-"));
  const registry = createGpuLeaseRegistry();
  let launches = 0;
  const processManager: ProcessManager = {
    findInferenceProcess: async () => null,
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
