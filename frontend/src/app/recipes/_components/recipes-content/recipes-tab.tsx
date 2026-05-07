// CRITICAL
"use client";

import { Plus, Search, Square } from "lucide-react";
import type { RecipeWithStatus } from "@/lib/types";
import {
  SettingsButton,
  SettingsGroup,
  SettingsInput,
  SettingsRow,
  SettingsValue,
  StatusPill,
} from "@/components/settings-primitives";
import type { RecipesTableProps } from "./types";
import { RecipesTable } from "./recipes-table";

type Props = {
  loading: boolean;
  filter: string;
  setFilter: (value: string) => void;
  sortedRecipes: RecipeWithStatus[];
  runningRecipeId: string | null;
  runningRecipeName: string | null;
  launchProgressMessage: string | null;
  onEvictModel: () => void;
  onNewRecipe: () => void;
  table: RecipesTableProps;
};

export function RecipesTab({
  loading,
  filter,
  setFilter,
  sortedRecipes,
  runningRecipeId,
  runningRecipeName,
  launchProgressMessage,
  onEvictModel,
  onNewRecipe,
  table,
}: Props) {
  return (
    <div className="space-y-5">
      <SettingsGroup
        title="Model control"
        description="Search, launch status, and creation live in rows instead of a wide toolbar."
        actions={
          <StatusPill tone={runningRecipeId ? "good" : loading ? "info" : "default"}>
            {runningRecipeId ? "running" : loading ? "syncing" : "ready"}
          </StatusPill>
        }
      >
        <SettingsRow
          label="Search recipes"
          description="Filter by recipe name or model path without hiding the page shell."
          control={
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-(--dim)" />
              <SettingsInput
                value={filter}
                onChange={setFilter}
                placeholder="Search recipes, paths, served names"
                className="pl-8"
              />
            </div>
          }
          status={<StatusPill>{sortedRecipes.length || "defaults"}</StatusPill>}
          actions={
            <SettingsButton onClick={onNewRecipe} tone="primary">
              <Plus className="h-3 w-3" />
              New
            </SettingsButton>
          }
        />
        <SettingsRow
          label="Active model"
          description="The currently loaded recipe, if the controller reports one."
          value={
            <SettingsValue mono dim={!runningRecipeName}>
              {runningRecipeName ?? "No active launch"}
            </SettingsValue>
          }
          status={
            <StatusPill tone={runningRecipeId ? "good" : "default"}>
              {runningRecipeId ? "live" : "idle"}
            </StatusPill>
          }
          actions={
            runningRecipeId ? (
              <SettingsButton onClick={onEvictModel} tone="danger">
                <Square className="h-3 w-3" />
                Stop
              </SettingsButton>
            ) : null
          }
        >
          {launchProgressMessage ? (
            <div className="text-[11px] text-(--dim)">{launchProgressMessage}</div>
          ) : null}
        </SettingsRow>
      </SettingsGroup>

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
