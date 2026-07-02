import type { Recipe, RecipeWithStatus } from "../types";
import type { ApiCore } from "./core";

export function createRecipesApi(core: ApiCore) {
  return {
    getRecipes: async (): Promise<{ recipes: RecipeWithStatus[] }> => {
      const data = await core.request<RecipeWithStatus[]>("/recipes");
      return { recipes: Array.isArray(data) ? data : [] };
    },

    getRecipe: (id: string): Promise<RecipeWithStatus> => core.request(`/recipes/${id}`),

    createRecipe: (recipe: Recipe): Promise<{ success: boolean; id: string }> =>
      core.request("/recipes", { method: "POST", body: JSON.stringify(recipe) }),

    updateRecipe: (id: string, recipe: Recipe): Promise<{ success: boolean; id: string }> =>
      core.request(`/recipes/${id}`, { method: "PUT", body: JSON.stringify(recipe) }),

    deleteRecipe: (id: string): Promise<void> =>
      core.request(`/recipes/${id}`, { method: "DELETE" }),
  };
}
