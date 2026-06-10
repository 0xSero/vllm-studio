import type { ModelDownload, Recipe, RecipeWithStatus } from "@/lib/types";

const normalizeId = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

export function buildStarterRecipe(
  download: ModelDownload,
  existingRecipes: Pick<RecipeWithStatus, "id">[],
): Recipe {
  const recipeBase = normalizeId(download.model_id.split("/").pop() ?? download.model_id);
  const existingIds = new Set(existingRecipes.map((recipe) => recipe.id));
  let recipeId = recipeBase || `model-${Date.now()}`;
  let suffix = 1;
  while (existingIds.has(recipeId)) {
    recipeId = `${recipeBase}-${suffix}`;
    suffix += 1;
  }

  return {
    id: recipeId,
    name: download.model_id,
    model_path: download.target_dir,
    backend: "vllm",
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
  };
}
