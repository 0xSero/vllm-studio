"use client";

import { Plus, Search, Square } from "@/ui/icon-registry";
import type { RecipeWithStatus } from "@/lib/types";
import { ModelButton, ModelInput } from "@/ui";
import { visionModeOverrideLabel } from "@/features/recipes/recipe-vision";
import type { RecipesTableProps } from "./types";
import { RecipesTable } from "./recipes-table";

type Props = {
  loading: boolean;
  filter: string;
  setFilter: (value: string) => void;
  recipes: RecipeWithStatus[];
  sortedRecipes: RecipeWithStatus[];
  runningRecipeId: string | null;
  runningRecipeName: string | null;
  launchProgressMessage: string | null;
  onEvictModel: () => void;
  onNewRecipe: () => void;
  table: RecipesTableProps;
};

const activeRecipeFor = (recipes: RecipeWithStatus[], runningRecipeId: string | null) =>
  recipes.find((recipe) => recipe.id === runningRecipeId) ??
  recipes.find((recipe) => recipe.status === "running") ??
  null;

const activeFactsFor = (recipe: RecipeWithStatus): string[] => {
  const tp = recipe.tp || recipe.tensor_parallel_size || 1;
  const pp = recipe.pp || recipe.pipeline_parallel_size || 1;
  const inputMode = visionModeOverrideLabel(recipe);
  return [
    recipe.backend,
    recipe.max_model_len ? `${recipe.max_model_len.toLocaleString()} ctx` : "ctx auto",
    `tp/pp ${tp}/${pp}`,
    ...(inputMode ? [inputMode] : []),
    `served as ${recipe.served_model_name ?? recipe.name}`,
  ];
};

export function RecipesTab({
  loading,
  filter,
  setFilter,
  recipes,
  sortedRecipes,
  runningRecipeId,
  runningRecipeName,
  launchProgressMessage,
  onEvictModel,
  onNewRecipe,
  table,
}: Props) {
  const activeRecipe = activeRecipeFor(recipes, runningRecipeId);
  const live = Boolean(runningRecipeId || activeRecipe);

  return (
    <div className="space-y-4">
      {/* Same quiet header line as Recommended: what is true on this machine
          right now, stated once, with the single action that changes it. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-(--ui-separator) pb-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-[length:var(--fs-md)] text-(--ui-fg)">
            {runningRecipeName ?? activeRecipe?.name ?? "No server running"}
          </span>
          <span className="truncate text-[length:var(--fs-sm)] text-(--ui-muted)">
            {activeRecipe
              ? activeFactsFor(activeRecipe).join(" · ")
              : loading
                ? "Syncing with the controller…"
                : "This controller is idle — launch one of the servers below."}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {launchProgressMessage ? (
            <span className="text-[length:var(--fs-xs)] text-(--ui-info)">
              {launchProgressMessage}
            </span>
          ) : null}
          {live ? (
            <ModelButton onClick={onEvictModel} tone="danger">
              <Square className="h-3 w-3" />
              Stop
            </ModelButton>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--ui-muted)" />
          <ModelInput
            value={filter}
            onChange={setFilter}
            placeholder="Search by name, weights path, runtime, or API model name"
            className="w-full pl-8"
          />
        </div>
        <ModelButton onClick={onNewRecipe} tone="primary">
          <Plus className="h-3 w-3" />
          New server
        </ModelButton>
      </div>

      <RecipesTable
        {...table}
        recipes={sortedRecipes}
        loading={loading}
        filter={filter}
        onNewRecipe={onNewRecipe}
      />
    </div>
  );
}
