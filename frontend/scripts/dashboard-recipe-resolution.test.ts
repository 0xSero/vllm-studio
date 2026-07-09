import assert from "node:assert/strict";
import test from "node:test";
import type { ProcessInfo, RecipeWithStatus } from "../src/lib/types";
import {
  resolveDashboardLogs,
  resolveDashboardRecipe,
} from "../src/features/dashboard/use-dashboard-recipes";

const process: ProcessInfo = {
  pid: 1,
  backend: "vllm",
  model_path: "/models/active",
  port: 8000,
  served_model_name: "active",
};

const recipe = (id: string, status: RecipeWithStatus["status"]): RecipeWithStatus => ({
  id,
  name: id,
  model_path: `/models/${id}`,
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
  served_model_name: id,
  python_path: null,
  extra_args: {},
  max_thinking_tokens: null,
  thinking_mode: "default",
  status,
});

test("running Serve replaces the cached dashboard selection", () => {
  const previous = recipe("previous", "stopped");
  const running = recipe("active", "running");
  assert.equal(resolveDashboardRecipe(process, [previous, running], previous), running);
});

test("active process keeps the cached Serve while controller rows settle", () => {
  const previous = recipe("previous", "running");
  assert.equal(resolveDashboardRecipe(process, [], previous), previous);
});

test("no active process clears the dashboard selection", () => {
  const previous = recipe("previous", "running");
  assert.equal(resolveDashboardRecipe(null, [previous], previous), null);
});

test("active process keeps visible logs through an empty refresh", () => {
  assert.deepEqual(resolveDashboardLogs(["ready"], "1|vllm|active|/models/active", process, []), [
    "ready",
  ]);
});

test("a different process does not inherit stale logs", () => {
  assert.deepEqual(resolveDashboardLogs(["old"], "2|vllm|old|/models/old", process, null), []);
});
