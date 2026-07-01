import type { RecipeStore } from "../models/recipes/recipe-store";
import { getDockerImage } from "../engines/process/backend-builder";
import type { Recipe } from "../models/types";
import { DEFAULT_ENGINE_IMAGE_SPECS } from "./image-registry";
import type { EnvironmentStore } from "./environment-store";
import type { Environment, EnvironmentEngineId } from "./types";

const SEEDABLE_ENGINES: ReadonlySet<string> = new Set(["vllm", "sglang", "llamacpp"]);

export const seededEnvironmentId = (recipeId: string): string => `env-${recipeId}`;

const isSeedableEngine = (backend: string): backend is EnvironmentEngineId =>
  SEEDABLE_ENGINES.has(backend);

const seedEnvironmentFromRecipe = (recipe: Recipe): Environment | null => {
  if (!isSeedableEngine(recipe.backend)) return null;
  const defaults = DEFAULT_ENGINE_IMAGE_SPECS[recipe.backend];
  const now = new Date().toISOString();
  return {
    id: seededEnvironmentId(recipe.id),
    name: recipe.name,
    recipeId: recipe.id,
    engineId: recipe.backend,
    version: defaults.version,
    variant: defaults.variant,
    image: getDockerImage(recipe),
    seeded: true,
    createdAt: now,
    updatedAt: now,
  };
};

/** Idempotently backfill one environment per docker-capable recipe. Existing
 * environments (seeded or user-created) for a recipe are left untouched, so
 * user edits and deliberate version pins survive re-seeding. */
export const seedEnvironmentsFromRecipes = (
  recipeStore: RecipeStore,
  environmentStore: EnvironmentStore,
): void => {
  const coveredRecipeIds = new Set(
    environmentStore.list().map((environment) => environment.recipeId),
  );
  for (const recipe of recipeStore.list()) {
    if (coveredRecipeIds.has(recipe.id)) continue;
    const seeded = seedEnvironmentFromRecipe(recipe);
    if (seeded) environmentStore.save(seeded);
  }
};
