// CRITICAL
"use client";

import { Compass, HardDrive } from "lucide-react";
import type { ModelInfo, RecipeEditor, RecipeWithStatus } from "@/lib/types";
import { SettingsLayout, type SettingsSectionDef } from "@/components/settings-primitives";
import type { RecipesContentTab } from "./recipes-content-model";
import type { RecipesTableProps } from "./types";
import { DeleteRecipeConfirmModal } from "./delete-recipe-confirm-modal";
import { RecipesTab } from "./recipes-tab";
import { RecipeModal } from "../recipe-modal/recipe-modal";
import { ExploreTab } from "./explore-tab";

type Props = {
  tab: RecipesContentTab;
  setTab: (tab: RecipesContentTab) => void;
  loading: boolean;
  refreshing: boolean;
  filter: string;
  setFilter: (value: string) => void;
  modalOpen: boolean;
  modalRecipe: RecipeEditor | null;
  setModalRecipe: (recipe: RecipeEditor | null) => void;
  saving: boolean;
  recipes: RecipeWithStatus[];
  deleteConfirm: string | null;
  deleteRecipeName: string;
  runningRecipeId: string | null;
  runningRecipeName: string | null;
  launchProgressMessage: string | null;
  availableModels: ModelInfo[];
  modelServedNames: Record<string, string>;
  sortedRecipes: RecipeWithStatus[];
  onRefresh: () => void;
  onNewRecipe: () => void;
  onSaveRecipe: () => void;
  onCloseRecipeModal: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onEvictModel: () => void;
  table: RecipesTableProps;
};

const MODEL_SECTIONS: SettingsSectionDef<RecipesContentTab>[] = [
  {
    id: "recipes",
    label: "Your models",
    description: "Local launch recipes, running state, and engine actions.",
    icon: <HardDrive className="h-3.5 w-3.5" />,
  },
  {
    id: "explore",
    label: "Explore",
    description: "Hugging Face discovery, downloads, and VRAM fit hints.",
    icon: <Compass className="h-3.5 w-3.5" />,
  },
];

export function RecipesContentView(props: Props) {
  const {
    tab,
    setTab,
    loading,
    refreshing,
    filter,
    setFilter,
    modalOpen,
    modalRecipe,
    setModalRecipe,
    saving,
    recipes,
    deleteConfirm,
    deleteRecipeName,
    runningRecipeId,
    runningRecipeName,
    launchProgressMessage,
    availableModels,
    modelServedNames,
    sortedRecipes,
    onRefresh,
    onNewRecipe,
    onSaveRecipe,
    onCloseRecipeModal,
    onCancelDelete,
    onConfirmDelete,
    onEvictModel,
    table,
  } = props;
  const status = loading
    ? "syncing recipes"
    : recipes.length
      ? `${recipes.length} configured`
      : "stable defaults";

  return (
    <>
      <SettingsLayout<RecipesContentTab>
        sections={MODEL_SECTIONS}
        activeSection={tab}
        title="Models"
        eyebrow="Model library"
        status={refreshing ? "refreshing" : status}
        loading={refreshing || loading}
        onReload={onRefresh}
        onSelectSection={setTab}
        refreshLabel="Refresh models"
      >
        {tab === "recipes" ? (
          <RecipesTab
            loading={loading}
            filter={filter}
            setFilter={setFilter}
            sortedRecipes={sortedRecipes}
            runningRecipeId={runningRecipeId}
            runningRecipeName={runningRecipeName}
            launchProgressMessage={launchProgressMessage}
            onEvictModel={onEvictModel}
            onNewRecipe={onNewRecipe}
            table={table}
          />
        ) : (
          <ExploreTab />
        )}
      </SettingsLayout>

      {deleteConfirm ? (
        <DeleteRecipeConfirmModal
          recipeName={deleteRecipeName}
          onCancel={onCancelDelete}
          onConfirm={onConfirmDelete}
        />
      ) : null}

      {modalOpen && modalRecipe ? (
        <RecipeModal
          recipe={modalRecipe}
          onClose={onCloseRecipeModal}
          onSave={onSaveRecipe}
          onChange={setModalRecipe}
          saving={saving}
          availableModels={availableModels}
          recipes={recipes}
        />
      ) : null}
    </>
  );
}
