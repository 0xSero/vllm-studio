// CRITICAL
"use client";

import { Plus } from "lucide-react";
import type { RecipeWithStatus } from "@/lib/types";
import {
  SettingsButton,
  SettingsGroup,
  SettingsRow,
  SettingsValue,
  StatusPill,
} from "@/components/settings-primitives";
import { RecipeRow } from "./recipe-row";

type Props = {
  recipes: RecipeWithStatus[];
  pinnedRecipes: Set<string>;
  recipeMenuOpen: string | null;
  launching: boolean;
  runningRecipeId: string | null;
  loading: boolean;
  filter: string;
  onTogglePin: (recipeId: string) => void;
  onToggleMenu: (recipeId: string) => void;
  onLaunch: (recipeId: string) => void;
  onStop: () => void;
  onEdit: (recipe: RecipeWithStatus) => void;
  onRequestDelete: (recipeId: string) => void;
  onNewRecipe: () => void;
};

const TEMPLATE_ROWS = [
  {
    label: "vLLM default",
    description: "CUDA-first OpenAI-compatible launch recipe.",
    value: "backend vLLM · tp/pp 1/1",
    status: "template",
  },
  {
    label: "SGLang server",
    description: "Structured generation runtime with metrics enabled by default.",
    value: "backend SGLang · metrics ready",
    status: "template",
  },
  {
    label: "llama.cpp local",
    description: "GGUF-oriented CPU, Metal, or CUDA target.",
    value: "backend llama.cpp · local path",
    status: "template",
  },
];

export function RecipesTable({
  recipes,
  pinnedRecipes,
  recipeMenuOpen,
  launching,
  runningRecipeId,
  loading,
  filter,
  onTogglePin,
  onToggleMenu,
  onLaunch,
  onStop,
  onEdit,
  onRequestDelete,
  onNewRecipe,
}: Props) {
  const emptyBecauseSearch = Boolean(filter.trim()) && recipes.length === 0;
  return (
    <SettingsGroup
      title="Launch recipes"
      description="Compact rows show identity, path, backend, parallelism, state, and actions."
      actions={
        <StatusPill tone={recipes.length ? "good" : loading ? "info" : "default"}>
          {recipes.length ? `${recipes.length} rows` : loading ? "syncing" : "defaults"}
        </StatusPill>
      }
    >
      {loading ? (
        <SettingsRow
          label="Controller sync"
          description="Recipe requests are still in flight; stable defaults stay visible below."
          value={<SettingsValue dim>Loading controller recipe rows…</SettingsValue>}
          status={<StatusPill tone="info">syncing</StatusPill>}
        />
      ) : null}

      {recipes.length
        ? recipes.map((recipe) => (
            <RecipeRow
              key={recipe.id}
              recipe={recipe}
              isPinned={pinnedRecipes.has(recipe.id)}
              isMenuOpen={recipeMenuOpen === recipe.id}
              launchDisabled={launching || Boolean(runningRecipeId)}
              onTogglePin={onTogglePin}
              onToggleMenu={onToggleMenu}
              onLaunch={onLaunch}
              onStop={onStop}
              onEdit={onEdit}
              onRequestDelete={onRequestDelete}
            />
          ))
        : TEMPLATE_ROWS.map((row) => (
            <SettingsRow
              key={row.label}
              label={row.label}
              description={
                emptyBecauseSearch
                  ? `No exact match for "${filter.trim()}". ${row.description}`
                  : row.description
              }
              value={<SettingsValue mono>{row.value}</SettingsValue>}
              status={<StatusPill>{row.status}</StatusPill>}
              actions={
                <SettingsButton onClick={onNewRecipe}>
                  <Plus className="h-3 w-3" />
                  Use
                </SettingsButton>
              }
            />
          ))}
    </SettingsGroup>
  );
}
