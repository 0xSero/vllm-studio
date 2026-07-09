import assert from "node:assert/strict";
import test from "node:test";
import type { RecipeWithStatus } from "../src/lib/types";
import { commandCenterView } from "../src/features/dashboard/command-center-model";

const base = {
  connected: true,
  currentProcess: null,
  gpus: [],
  recipes: [],
  runtimeSummary: null,
  services: [],
};

const configuredRecipe: RecipeWithStatus = {
  id: "one",
  name: "One",
  model_path: "/models/one",
  backend: "vllm",
  runtime: { kind: "managed_venv", ref: "vllm" },
  env_vars: null,
  tensor_parallel_size: 1,
  pipeline_parallel_size: 1,
  max_model_len: 4096,
  gpu_memory_utilization: 0.9,
  kv_cache_dtype: "auto",
  max_num_seqs: 1,
  trust_remote_code: false,
  tool_call_parser: null,
  reasoning_parser: null,
  enable_auto_tool_choice: false,
  quantization: null,
  dtype: "auto",
  host: "127.0.0.1",
  port: 8000,
  served_model_name: "one",
  python_path: null,
  extra_args: {},
  max_thinking_tokens: null,
  thinking_mode: "default",
  status: "stopped",
};

test("guides an empty controller to models", () => {
  const view = commandCenterView(base);
  assert.equal(view.actionHref, "/recipes");
  assert.equal(view.phases.find((phase) => phase.id === "model")?.state, "active");
});

test("guides a configured idle controller to Serves", () => {
  const view = commandCenterView({
    ...base,
    recipes: [configuredRecipe],
    runtimeSummary: {
      platform: { kind: "cuda", vendor: "nvidia" },
      gpu_monitoring: { available: true, tool: "nvidia-smi" },
      backends: {
        vllm: { installed: true, version: "1" },
        sglang: { installed: false, version: null },
        llamacpp: { installed: false, version: null },
      },
    },
  });
  assert.equal(view.actionHref, "/recipes?tab=serves");
  assert.equal(view.phases.find((phase) => phase.id === "serve")?.state, "active");
});

test("opens the workbench for a running model", () => {
  const view = commandCenterView({
    ...base,
    currentProcess: {
      pid: 1,
      backend: "vllm",
      model_path: "/models/Qwen",
      port: 8000,
      served_model_name: "qwen",
    },
  });
  assert.equal(view.actionHref, "/agent");
  assert.equal(view.statusLabel, "operational");
  assert.equal(view.phases.find((phase) => phase.id === "work")?.state, "active");
});

test("sends an offline controller to connection settings", () => {
  const view = commandCenterView({ ...base, connected: false });
  assert.equal(view.actionHref, "/settings#connection");
  assert.equal(view.phases[0]?.state, "blocked");
});
