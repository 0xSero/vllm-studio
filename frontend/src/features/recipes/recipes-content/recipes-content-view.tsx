"use client";

import { useCallback, type ReactNode } from "react";
import { Compass, Download, HardDrive, Sparkles } from "@/ui/icon-registry";
import { RefreshButton, TabbedPage, Tabs } from "@/ui";
import { useRecipesContentModel, type RecipesContentTab } from "./recipes-content-model";
import type { RecipesTableProps } from "./types";
import { DeleteRecipeConfirmModal } from "./delete-recipe-confirm-modal";
import { RecipesTab } from "./recipes-tab";
import { RecipeModal } from "../recipe-modal/recipe-modal";
import { ExploreTab } from "./explore-tab";
import { DownloadsTab } from "./downloads-tab";
import { PicksTab } from "./picks-tab";

const MODEL_TABS: Array<{ id: RecipesContentTab; label: string; icon: ReactNode }> = [
  { id: "picks", label: "Picks", icon: <Sparkles className="h-3.5 w-3.5" /> },
  { id: "get", label: "Get", icon: <Compass className="h-3.5 w-3.5" /> },
  { id: "serves", label: "Serves", icon: <HardDrive className="h-3.5 w-3.5" /> },
  { id: "downloads", label: "Downloads", icon: <Download className="h-3.5 w-3.5" /> },
];

const TAB_HEADINGS: Record<RecipesContentTab, { title: string; description: string }> = {
  picks: {
    title: "Picks",
    description: "Curated model catalog grouped by hardware tier, with per-variant downloads.",
  },
  get: {
    title: "Get",
    description: "Find the right model, check hardware fit, and download its weights.",
  },
  serves: {
    title: "Serves",
    description: "Saved model, runtime, and configuration combinations ready to launch.",
  },
  downloads: {
    title: "Downloads",
    description: "Download queue, progress, retry, and cancel controls.",
  },
};

export function RecipesContentView({ embedded = false }: { embedded?: boolean }) {
  const model = useRecipesContentModel();
  const setTab = model.setTab;
  const selectTab = useCallback(
    (tab: RecipesContentTab) => {
      setTab(tab);
      if (!embedded) {
        window.history.replaceState(window.history.state, "", `/models?tab=${tab}`);
        return;
      }
      const url = new URL(window.location.href);
      url.searchParams.set("tab", tab);
      url.hash = "models";
      window.history.replaceState(window.history.state, "", url);
    },
    [embedded, setTab],
  );
  const table: RecipesTableProps = {
    recipes: model.derived.sortedRecipes,
    pinnedRecipes: model.pinnedRecipes,
    recipeMenuOpen: model.recipeMenuOpen,
    launching: model.launching,
    runningRecipeId: model.runningRecipeId,
    onTogglePin: model.togglePin,
    onToggleMenu: model.actions.handleToggleRecipeMenu,
    onLaunch: model.actions.handleLaunchRecipe,
    onStop: model.actions.handleEvictModel,
    onEdit: model.actions.handleEditRecipe,
    onRequestDelete: model.actions.handleRequestDelete,
  };
  const tab = model.tab;
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
            loading={model.loading}
            filter={model.filter}
            setFilter={model.setFilter}
            recipes={model.recipes}
            sortedRecipes={model.derived.sortedRecipes}
            runningRecipeId={model.runningRecipeId}
            runningRecipeName={model.derived.runningRecipe?.name ?? null}
            launchProgressMessage={model.launchProgress?.message ?? null}
            onEvictModel={model.actions.handleEvictModel}
            onNewRecipe={model.actions.handleNewRecipe}
            table={table}
          />
        ) : tab === "picks" ? (
          <PicksTab />
        ) : tab === "get" ? (
          <ExploreTab />
        ) : (
          <DownloadsTab onCreateServe={model.actions.handleCreateServeFromDownload} />
        )}
      </div>
    </section>
  );

  return (
    <>
      {embedded ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--ui-separator) pb-3">
            <Tabs variant="pill" items={MODEL_TABS} activeTab={tab} onSelectTab={selectTab} />
            <RefreshButton
              onRefresh={model.actions.handleRefresh}
              loading={model.refreshing || model.loading}
              label="Refresh models"
              className="h-8 w-8"
            />
          </div>
          {content}
        </div>
      ) : (
        <TabbedPage
          title="Models"
          description="Manage model profiles, downloads, and the model marketplace available to Local Studio."
          width="md"
          tabs={MODEL_TABS}
          activeTab={tab}
          onSelectTab={selectTab}
          actions={
            <RefreshButton
              onRefresh={model.actions.handleRefresh}
              loading={model.refreshing || model.loading}
              label="Refresh models"
              className="h-8 w-8"
            />
          }
        >
          {content}
        </TabbedPage>
      )}

      {model.modalOpen && model.modalRecipe ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            aria-label="Close recipe editor"
            className="absolute inset-0 bg-(--color-scrim) backdrop-blur-[2px]"
            onClick={model.actions.closeRecipeModal}
          />
          <RecipeModal
            recipe={model.modalRecipe}
            onClose={model.actions.closeRecipeModal}
            onSave={model.actions.handleSaveRecipe}
            onChange={model.setModalRecipe}
            saving={model.saving}
            availableModels={model.availableModels}
            runtimeTargets={model.runtimeTargets}
            recipes={model.recipes}
          />
        </div>
      ) : null}

      {model.deleteConfirm ? (
        <DeleteRecipeConfirmModal
          recipeName={model.derived.deleteRecipe?.name ?? ""}
          onCancel={() => model.setDeleteConfirm(null)}
          onConfirm={() => model.actions.handleDeleteRecipe(model.deleteConfirm!)}
        />
      ) : null}
    </>
  );
}
