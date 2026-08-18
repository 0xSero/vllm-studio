"use client";

import type { ReactNode } from "react";
import { Download, Search, Server, Sparkles } from "@/ui/icon-registry";
import type { ModelDownload, ModelInfo, RecipeWithStatus, RuntimeTarget } from "@/lib/types";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";
import { RefreshButton, TabbedPage, Tabs } from "@/ui";
import type { RecipesContentTab } from "./recipes-content-model";
import type { RecipesTableProps } from "./types";
import { DeleteRecipeConfirmModal } from "./delete-recipe-confirm-modal";
import { RecipesTab } from "./recipes-tab";
import { RecipeModal } from "../recipe-modal/recipe-modal";
import { ExploreTab } from "./explore-tab";
import { DownloadsTab } from "./downloads-tab";
import { PicksTab } from "./picks-tab";

type Props = {
  embedded?: boolean;
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
  runtimeTargets: RuntimeTarget[];
  sortedRecipes: RecipeWithStatus[];
  onRefresh: () => void;
  onNewRecipe: () => void;
  onCreateServeFromDownload: (download: ModelDownload) => void;
  onSaveRecipe: () => void;
  onCloseRecipeModal: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onEvictModel: () => void;
  table: RecipesTableProps;
};

// Tab ids are storage/URL keys and stay put; the labels say what each tab
// actually does, because "Picks / Get / Serves" told you nothing from outside.
const MODEL_TABS: Array<{ id: RecipesContentTab; label: string; icon: ReactNode }> = [
  { id: "picks", label: "Recommended", icon: <Sparkles className="h-3.5 w-3.5" /> },
  { id: "get", label: "Search Hugging Face", icon: <Search className="h-3.5 w-3.5" /> },
  { id: "serves", label: "Your servers", icon: <Server className="h-3.5 w-3.5" /> },
  { id: "downloads", label: "Downloads", icon: <Download className="h-3.5 w-3.5" /> },
];

const TAB_HEADINGS: Record<RecipesContentTab, { title: string; description: string }> = {
  picks: {
    title: "Recommended models",
    description:
      "Hand-picked models grouped by the hardware they need, each checked against this machine's memory.",
  },
  get: {
    title: "Search Hugging Face",
    description: "Search the Hub, check whether a model fits this machine, and pull its weights.",
  },
  serves: {
    title: "Your servers",
    description: "Saved model + runtime + configuration combinations, ready to launch.",
  },
  downloads: {
    title: "Downloads",
    description: "Everything currently downloading, with progress, retry, and cancel.",
  },
};

export function RecipesContentView(props: Props) {
  const {
    embedded = false,
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
    runtimeTargets,
    sortedRecipes,
    onRefresh,
    onNewRecipe,
    onCreateServeFromDownload,
    onSaveRecipe,
    onCloseRecipeModal,
    onCancelDelete,
    onConfirmDelete,
    onEvictModel,
    table,
  } = props;
  const heading = TAB_HEADINGS[tab];
  const content = (
    <section>
      <h2 className="text-[length:var(--fs-2xl)] font-medium tracking-[-0.015em] text-(--ui-fg)">
        {heading.title}
      </h2>
      <p className="mt-1 text-[length:var(--fs-sm)] text-(--ui-muted)">{heading.description}</p>
      <div className="mt-6">
        {tab === "serves" ? (
          <RecipesTab
            loading={loading}
            filter={filter}
            setFilter={setFilter}
            recipes={recipes}
            sortedRecipes={sortedRecipes}
            runningRecipeId={runningRecipeId}
            runningRecipeName={runningRecipeName}
            launchProgressMessage={launchProgressMessage}
            onEvictModel={onEvictModel}
            onNewRecipe={onNewRecipe}
            table={table}
          />
        ) : tab === "picks" ? (
          <PicksTab />
        ) : tab === "get" ? (
          <ExploreTab />
        ) : (
          <DownloadsTab onCreateServe={onCreateServeFromDownload} />
        )}
      </div>
    </section>
  );

  return (
    <>
      {embedded ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--ui-separator) pb-3">
            <Tabs variant="pill" items={MODEL_TABS} activeTab={tab} onSelectTab={setTab} />
            <RefreshButton
              onRefresh={onRefresh}
              loading={refreshing || loading}
              label="Refresh models"
              className="h-8 w-8"
            />
          </div>
          {content}
        </div>
      ) : (
        <TabbedPage
          title="Models"
          description="Find models that fit this machine, download their weights, and turn them into servers."
          width="md"
          tabs={MODEL_TABS}
          activeTab={tab}
          onSelectTab={setTab}
          actions={
            <RefreshButton
              onRefresh={onRefresh}
              loading={refreshing || loading}
              label="Refresh models"
              className="h-8 w-8"
            />
          }
        >
          {content}
        </TabbedPage>
      )}

      {modalOpen && modalRecipe ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            aria-label="Close recipe editor"
            className="absolute inset-0 bg-(--color-scrim) backdrop-blur-[2px]"
            onClick={onCloseRecipeModal}
          />
          <RecipeModal
            recipe={modalRecipe}
            onClose={onCloseRecipeModal}
            onSave={onSaveRecipe}
            onChange={setModalRecipe}
            saving={saving}
            availableModels={availableModels}
            runtimeTargets={runtimeTargets}
            recipes={recipes}
          />
        </div>
      ) : null}

      {deleteConfirm ? (
        <DeleteRecipeConfirmModal
          recipeName={deleteRecipeName}
          onCancel={onCancelDelete}
          onConfirm={onConfirmDelete}
        />
      ) : null}
    </>
  );
}
