"use client";

import type { ReactNode } from "react";
import { Download, Search, Server, Sparkles } from "@/ui/icon-registry";
import type { ModelDownload, ModelInfo, RecipeWithStatus, RuntimeTarget } from "@/lib/types";
import type { RecipeEditor } from "@/features/recipes/recipe-editor";
import { ConfirmDeleteModal, RefreshButton, TabbedPage, Tabs } from "@/ui";
import { DrawerOverlay } from "@/ui/drawer";
import type { RecipesContentTab } from "./recipes-content-model";
import type { RecipesTableProps } from "./types";
import { RecipesTab } from "./recipes-tab";
import { RecipeModal } from "../recipe-modal/recipe-modal";
import { ExploreTab } from "./explore-tab";
import { DownloadsTab } from "./downloads-tab";
import { PicksTab } from "./picks-tab";

type Props = {
  embedded?: boolean;
  managementAction?: ReactNode;
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
      "Hand-picked models grouped by the hardware they need, each checked against the selected machine's memory.",
  },
  get: {
    title: "Search Hugging Face",
    description:
      "Search the Hub, check whether a model fits the selected machine, and pull its weights there.",
  },
  serves: {
    title: "Your servers",
    description: "The selected machine's saved model, runtime, and configuration combinations.",
  },
  downloads: {
    title: "Downloads",
    description:
      "Everything downloading on the selected machine, with progress, retry, and cancel.",
  },
};

export function RecipesContentView(props: Props) {
  const {
    embedded = false,
    managementAction,
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
  // No per-tab heading. The page is already titled "Models" and the active tab
  // is already named in the tab strip, so a second heading and a second
  // description restated both — four lines of chrome before any content, on a
  // page whose whole point is the table.
  const content = (
    <section>
      <div>
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
            <div className="flex items-center gap-2">
              {managementAction}
              <RefreshButton
                onRefresh={onRefresh}
                loading={refreshing || loading}
                label="Refresh models"
                className="h-8 w-8"
              />
            </div>
          </div>
          {content}
        </div>
      ) : (
        <TabbedPage
          title="Models"
          description={heading.description}
          width="md"
          tabs={MODEL_TABS}
          activeTab={tab}
          onSelectTab={setTab}
          actions={
            <div className="flex items-center gap-2">
              {managementAction}
              <RefreshButton
                onRefresh={onRefresh}
                loading={refreshing || loading}
                label="Refresh models"
                className="h-8 w-8"
              />
            </div>
          }
        >
          {content}
        </TabbedPage>
      )}

      {modalOpen && modalRecipe ? (
        <DrawerOverlay onClose={onCloseRecipeModal}>
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
        </DrawerOverlay>
      ) : null}

      {deleteConfirm ? (
        <ConfirmDeleteModal
          title="Delete Serve"
          message={`Delete "${deleteRecipeName}"? Model weights stay on disk.`}
          onCancel={onCancelDelete}
          onConfirm={onConfirmDelete}
        />
      ) : null}
    </>
  );
}
