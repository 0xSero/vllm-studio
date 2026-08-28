import { describe, expect, test } from "bun:test";
import type { Recipe } from "../src/modules/models/types";
import type { RegistryHardware } from "@local-studio/contracts/registry";
import {
  buildContribution,
  paramsFromName,
  precisionFromRecipe,
  repositoryFromModelPath,
} from "../src/modules/registry/serialize";

const NOW = "2026-08-29T12:00:00.000Z";

const hardwareRecord: RegistryHardware = {
  schema_version: "local-ai-registry/v1",
  id: "rtx-5090-32gb",
  vendor: "nvidia",
  name: "GeForce RTX 5090",
  kind: "discrete",
  accelerator_backend: "nvidia",
  memory: { vram_gb: 32, vram_type: "GDDR7", cpu_memory_gb: null, bandwidth_gb_per_s: 1792 },
};

const baseRecipe: Recipe = {
  id: "gemma-local",
  name: "Gemma 4 12B",
  model_path: "/models/unsloth/gemma-4-12b-it-NVFP4",
  vision: false,
  backend: "sglang",
  runtime: { kind: "docker", ref: "lmsysorg/sglang:dev-cu13" },
  env_vars: null,
  tensor_parallel_size: 1,
  pipeline_parallel_size: 1,
  max_model_len: 131072,
  gpu_memory_utilization: 0.88,
  kv_cache_dtype: "auto",
  max_num_seqs: 24,
  trust_remote_code: true,
  tool_call_parser: "gemma4",
  reasoning_parser: null,
  enable_auto_tool_choice: true,
  quantization: "nvfp4",
  dtype: null,
  host: "0.0.0.0",
  port: 30000,
  served_model_name: "gemma-4-12b",
  python_path: null,
  extra_args: {},
  max_thinking_tokens: null,
  thinking_mode: "auto",
} as unknown as Recipe;

const baseInput = {
  recipe: baseRecipe,
  repository: null,
  modelName: "",
  paramsB: null,
  precision: null,
  sizeGb: 7.2,
  revision: "b1f649734b34aa5575b03d186abd1b9be3d0d5c4",
  hardware: hardwareRecord,
  hardwareCount: 1,
  engineVersion: "0.5.2",
  launch: {
    argv: ["/models", "--tp", "1"],
    image: "lmsysorg/sglang:dev-cu13@sha256:6cd4635214f279e0a43019f88e3120d407567640a58aa7dcc0085e3d91402cc4",
    env: { SGLANG_SAFE: "1" },
    containerPort: 30000,
    hostPort: 30000,
    modelMountTarget: "/models",
  },
  peaks: { generation_tps: 41.2, prompt_tps: 980, ttft_ms: 210, measured_at: NOW },
  nowIso: NOW,
};

describe("contribution serialization", () => {
  test("carries everything required for reproducibility", () => {
    const contribution = buildContribution(baseInput);
    const instance = contribution.model_instance as Record<string, any>;
    const recipe = contribution.recipe as Record<string, any>;

    expect(instance["repository"]).toBe("unsloth/gemma-4-12b-it-NVFP4");
    expect(instance["revision"]).toBe("b1f649734b34aa5575b03d186abd1b9be3d0d5c4");
    expect(instance["weights"]).toMatchObject({ precision: "nvfp4", size_gb: 7.2 });
    expect(recipe["engine"]).toEqual({ name: "sglang", version: "0.5.2", graph_mode: null });
    expect(recipe["hardware_id"]).toBe("rtx-5090-32gb");
    expect(recipe["hardware_count"]).toBe(1);
    expect(recipe["serving"]["configured_max_context_tokens"]).toBe(131072);
    expect(recipe["serving"]["measured"]).toMatchObject({ peak_generation_tps: 41.2 });
    const launch = recipe["launch"] as Record<string, any>;
    expect(launch["kind"]).toBe("controller");
    expect(launch["image"]).toBe("lmsysorg/sglang:dev-cu13");
    expect(launch["digest"]).toContain("sha256:6cd46352");
    expect(launch["arguments"]).toEqual(["/models", "--tp", "1"]);
    expect(recipe["capabilities"]).toEqual({ chat: true, reasoning: false, tools: true, vision: false });
    expect(recipe["status"]).toBe("candidate");
    expect(recipe["schema_version"]).toBe("local-ai-registry/v1");
  });

  test("derives registry-compatible ids deterministically", () => {
    const contribution = buildContribution(baseInput);
    expect(contribution.instance_id).toBe("unsloth-gemma-4-12b-it-nvfp4--nvfp4");
    expect(contribution.recipe_id).toBe("gemma-4-12b-it-nvfp4-nvfp4-rtx-5090-32gb-sglang-tp1");
    expect(contribution.recipe_id).toMatch(/^[a-z0-9][a-z0-9.-]*$/);
    const again = buildContribution(baseInput);
    expect(again.recipe_id).toBe(contribution.recipe_id);
    expect(again.paths.model_instance).toBe(`model-instance/${contribution.instance_id}.json`);
  });

  test("drops the model record when the parameter count is unknown", () => {
    const contribution = buildContribution({ ...baseInput, paramsB: null, modelName: "mystery-model" });
    expect(contribution.model).toBeUndefined();
  });

  test("measured evidence is optional but included when present", () => {
    const withoutPeaks = buildContribution({ ...baseInput, peaks: null });
    const serving = (withoutPeaks.recipe as Record<string, any>)["serving"];
    expect(serving["measured"]).toBeUndefined();
  });

  test("precision falls back to the artifact name suffix", () => {
    expect(precisionFromRecipe(baseRecipe)).toBe("nvfp4");
    const bf16 = { ...baseRecipe, quantization: null, model_path: "/models/google/gemma-4-12b-it-bf16" };
    expect(precisionFromRecipe(bf16 as Recipe)).toBe("bf16");
    const unknown = { ...baseRecipe, quantization: null, model_path: "/models/google/some-model" };
    expect(precisionFromRecipe(unknown as Recipe)).toBeNull();
  });

  test("repository and parameter parsing handle common layouts", () => {
    expect(repositoryFromModelPath("/models/unsloth/gemma-4-12b-it")).toBe("unsloth/gemma-4-12b-it");
    expect(repositoryFromModelPath("Qwen/Qwen3-4B")).toBe("Qwen/Qwen3-4B");
    expect(paramsFromName("Qwen3-4B")).toBe(4);
    expect(paramsFromName("deepseek-v4-flash-180b")).toBe(180);
    expect(paramsFromName("mystery")).toBeNull();
  });
});
