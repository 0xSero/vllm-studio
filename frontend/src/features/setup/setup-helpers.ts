import type { ModelDownload, Recipe, RecipeWithStatus, StarterPreset } from "@/lib/types";

const normalizeId = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

function dedupeRecipeId(base: string, existingRecipes: Pick<RecipeWithStatus, "id">[]): string {
  const existingIds = new Set(existingRecipes.map((recipe) => recipe.id));
  let recipeId = base || `model-${Date.now()}`;
  let suffix = 1;
  while (existingIds.has(recipeId)) {
    recipeId = `${base}-${suffix}`;
    suffix += 1;
  }
  return recipeId;
}

export function buildStarterRecipe(
  download: ModelDownload,
  existingRecipes: Pick<RecipeWithStatus, "id">[],
  preset?: StarterPreset | null,
): Recipe {
  const recipeBase = preset
    ? normalizeId(preset.id)
    : normalizeId(download.model_id.split("/").pop() ?? download.model_id);
  const recipeId = dedupeRecipeId(recipeBase, existingRecipes);

  // llama.cpp serves a single weights file, not the download directory.
  const modelPath =
    preset?.backend === "llamacpp" && preset.gguf_file
      ? `${download.target_dir.replace(/\/+$/, "")}/${preset.gguf_file}`
      : download.target_dir;

  return {
    id: recipeId,
    name: preset?.name ?? download.model_id,
    model_path: modelPath,
    backend: preset?.backend ?? "vllm",
    served_model_name: download.model_id,
    trust_remote_code: true,
    dtype: "auto",
    max_model_len: 32768,
    gpu_memory_utilization: 0.9,
    tensor_parallel_size: 1,
    pipeline_parallel_size: 1,
    max_num_seqs: 256,
    kv_cache_dtype: "auto",
    extra_args: {},
    ...(preset?.recipe_overrides ?? {}),
  };
}
