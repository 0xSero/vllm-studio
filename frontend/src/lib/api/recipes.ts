import type { Recipe, RecipeWithStatus } from "../types";
import { encodePathSegments, type ApiCore } from "./core";

export function createRecipesApi(core: ApiCore) {
  return {
    getRecipes: async (): Promise<{ recipes: RecipeWithStatus[] }> => {
      const data = await core.request<RecipeWithStatus[]>("/recipes");
      return { recipes: Array.isArray(data) ? data : [] };
    },

    getRecipe: (id: string): Promise<RecipeWithStatus> =>
      core.request(`/recipes/${encodePathSegments(id)}`),

    createRecipe: (recipe: Recipe): Promise<{ success: boolean; id: string }> =>
      core.request("/recipes", { method: "POST", body: JSON.stringify(recipe) }),

    updateRecipe: (id: string, recipe: Recipe): Promise<{ success: boolean; id: string }> =>
      core.request(`/recipes/${encodePathSegments(id)}`, {
        method: "PUT",
        body: JSON.stringify(recipe),
      }),

    launchRecipe: (id: string): Promise<{ success: boolean; message: string }> =>
      core.request(`/launch/${encodePathSegments(id)}`, {
        method: "POST",
        timeout: 600_000,
        retries: 0,
      }),

    deleteRecipe: (id: string): Promise<void> =>
      core.request(`/recipes/${encodePathSegments(id)}`, { method: "DELETE" }),
  };
}
