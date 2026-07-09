import assert from "node:assert/strict";
import test from "node:test";

import { buildStarterRecipe } from "../src/features/setup/setup-helpers";
import type { ModelDownload, StarterPreset } from "../src/lib/types";

const download = (modelId: string, targetDir: string): ModelDownload =>
  ({
    id: "dl-1",
    model_id: modelId,
    revision: null,
    target_dir: targetDir,
    status: "completed",
    source: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T00:00:00Z",
    total_bytes: 1,
    downloaded_bytes: 1,
    speed_bytes_per_second: 0,
    files: [],
    error: null,
  }) satisfies ModelDownload;

test("no preset creates an explicit managed vllm Serve", () => {
  const recipe = buildStarterRecipe(download("Qwen/Qwen3-8B", "/models/Qwen/Qwen3-8B"), []);
  assert.equal(recipe.backend, "vllm");
  assert.deepEqual(recipe.runtime, {
    kind: "managed_venv",
    ref: "vllm",
    label: "Managed vLLM",
  });
  assert.equal(recipe.model_path, "/models/Qwen/Qwen3-8B");
  assert.equal(recipe.id, "qwen3-8b");
});

test("vllm preset applies overrides", () => {
  const preset: StarterPreset = {
    id: "qwen3-6-35b",
    name: "Qwen3.6 35B",
    description: "",
    kind: "download",
    tags: [],
    size_gb: 20,
    min_vram_gb: 24,
    model_id: "nvidia/Qwen3.6-35B-A3B-NVFP4",
    backend: "vllm",
    recipe_overrides: {
      served_model_name: "qwen3.6-35b",
      max_model_len: 131072,
      tool_call_parser: "qwen3_coder",
    },
  };
  const recipe = buildStarterRecipe(
    download(preset.model_id ?? "", "/models/nvidia/Qwen3.6-35B-A3B-NVFP4"),
    [],
    preset,
  );
  assert.equal(recipe.id, "qwen3-6-35b");
  assert.equal(recipe.served_model_name, "qwen3.6-35b");
  assert.equal(recipe.max_model_len, 131072);
  assert.equal(recipe.tool_call_parser, "qwen3_coder");
  assert.equal(recipe.model_path, "/models/nvidia/Qwen3.6-35B-A3B-NVFP4");
});

test("llamacpp preset points model_path at the gguf file", () => {
  const preset: StarterPreset = {
    id: "lfm2-5",
    name: "LFM2.5 8B",
    description: "",
    kind: "download",
    tags: [],
    size_gb: 5,
    min_vram_gb: null,
    model_id: "LiquidAI/LFM2.5-8B-A1B-GGUF",
    allow_patterns: ["*Q4_K_M.gguf"],
    backend: "llamacpp",
    gguf_file: "LFM2.5-8B-A1B-Q4_K_M.gguf",
    recipe_overrides: { served_model_name: "lfm2.5" },
  };
  const recipe = buildStarterRecipe(
    download(preset.model_id ?? "", "/models/LiquidAI/LFM2.5-8B-A1B-GGUF/"),
    [],
    preset,
  );
  assert.equal(recipe.backend, "llamacpp");
  assert.deepEqual(recipe.runtime, {
    kind: "binary",
    ref: "llama-server",
    label: "Managed llama.cpp",
  });
  assert.equal(recipe.model_path, "/models/LiquidAI/LFM2.5-8B-A1B-GGUF/LFM2.5-8B-A1B-Q4_K_M.gguf");
  assert.equal(recipe.served_model_name, "lfm2.5");
});

test("preset ids dedupe against existing recipes", () => {
  const preset: StarterPreset = {
    id: "lfm2-5",
    name: "LFM2.5 8B",
    description: "",
    kind: "download",
    tags: [],
    size_gb: 5,
    min_vram_gb: null,
    model_id: "LiquidAI/LFM2.5-8B-A1B-GGUF",
    backend: "llamacpp",
    gguf_file: "LFM2.5-8B-A1B-Q4_K_M.gguf",
  };
  const recipe = buildStarterRecipe(
    download(preset.model_id ?? "", "/models/x"),
    [{ id: "lfm2-5" }],
    preset,
  );
  assert.equal(recipe.id, "lfm2-5-1");
});
