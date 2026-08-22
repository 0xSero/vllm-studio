"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import { AppPage, ModelButton, PageContainer, PageHeader } from "@/ui";
import { ModelMachineSelect, useModelMachines } from "@/features/recipes/model-management-machine";
import { ModelManagementApiProvider } from "@/features/recipes/model-management-api";
import { TableNotice } from "./catalog-table-shell";
import type { RecipesTableProps } from "./types";
import { useRecipesContentModel, type RecipesContentTab } from "./recipes-content-model";
import { RecipesContentView } from "./recipes-content-view";

export function RecipesContent({ embedded = false }: { embedded?: boolean }) {
  const management = useModelMachines();
  const managementAction = (
    <ModelMachineSelect
      machines={management.machines}
      selectedMachine={management.selectedMachine}
      onSelect={management.selectMachine}
    />
  );

  if (management.loading && management.machines.length === 0) {
    return (
      <ModelsWorkerGate
        embedded={embedded}
        action={null}
        title="Loading machines"
        body="Checking which controllers are available for model management."
      />
    );
  }

  if (!management.selectedMachine || !management.client) {
    const hasMachines = management.machines.length > 0;
    return (
      <ModelsWorkerGate
        embedded={embedded}
        action={managementAction}
        title={hasMachines ? "Choose a machine" : "No model machines available"}
        body={
          management.error ??
          (hasMachines
            ? "Choose where recommendations are fitted, weights are downloaded, and model servers are hosted. Chat routing remains automatic."
            : "Connect this desktop controller or add a Worker in Configure → Machines.")
        }
        openMachines={!hasMachines}
      />
    );
  }

  return (
    <ModelManagementApiProvider client={management.client}>
      <WorkerRecipesContent
        key={management.selectedMachine.key}
        embedded={embedded}
        managementAction={managementAction}
      />
    </ModelManagementApiProvider>
  );
}

function WorkerRecipesContent({
  embedded,
  managementAction,
}: {
  embedded: boolean;
  managementAction: ReactNode;
}) {
  const model = useRecipesContentModel();
  const setTab = model.setTab;
  const selectTab = useCallback(
    (tab: RecipesContentTab) => {
      setTab(tab);
      const url = new URL(window.location.href);
      url.searchParams.set("tab", tab);
      if (embedded) url.hash = "models";
      window.history.replaceState(null, "", url);
    },
    [embedded, setTab],
  );

  const table = useMemo<RecipesTableProps>(
    () => ({
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
    }),
    [
      model.actions.handleEditRecipe,
      model.actions.handleEvictModel,
      model.actions.handleLaunchRecipe,
      model.actions.handleRequestDelete,
      model.actions.handleToggleRecipeMenu,
      model.derived.sortedRecipes,
      model.launching,
      model.pinnedRecipes,
      model.recipeMenuOpen,
      model.runningRecipeId,
      model.togglePin,
    ],
  );

  return (
    <RecipesContentView
      embedded={embedded}
      managementAction={managementAction}
      tab={model.tab}
      setTab={selectTab}
      loading={model.loading}
      refreshing={model.refreshing}
      filter={model.filter}
      setFilter={model.setFilter}
      modalOpen={model.modalOpen}
      modalRecipe={model.modalRecipe}
      setModalRecipe={model.setModalRecipe}
      saving={model.saving}
      recipes={model.recipes}
      deleteConfirm={model.deleteConfirm}
      deleteRecipeName={model.derived.deleteRecipe?.name ?? ""}
      runningRecipeId={model.runningRecipeId}
      runningRecipeName={model.derived.runningRecipe?.name ?? null}
      launchProgressMessage={model.launchProgress?.message ?? null}
      availableModels={model.availableModels}
      runtimeTargets={model.runtimeTargets}
      sortedRecipes={model.derived.sortedRecipes}
      onRefresh={model.actions.handleRefresh}
      onNewRecipe={model.actions.handleNewRecipe}
      onCreateServeFromDownload={model.actions.handleCreateServeFromDownload}
      onSaveRecipe={model.actions.handleSaveRecipe}
      onCloseRecipeModal={model.actions.closeRecipeModal}
      onCancelDelete={() => model.setDeleteConfirm(null)}
      onConfirmDelete={async () => {
        if (model.deleteConfirm) {
          await model.actions.handleDeleteRecipe(model.deleteConfirm);
        }
      }}
      onEvictModel={model.actions.handleEvictModel}
      table={table}
    />
  );
}

function ModelsWorkerGate({
  embedded,
  action,
  title,
  body,
  openMachines = false,
}: {
  embedded: boolean;
  action: ReactNode;
  title: string;
  body: string;
  openMachines?: boolean;
}) {
  const notice = (
    <TableNotice
      title={title}
      body={body}
      action={
        openMachines ? (
          <ModelButton
            tone="primary"
            onClick={() => {
              window.location.href = "/configure?section=rig#rig";
            }}
          >
            Open Machines
          </ModelButton>
        ) : undefined
      }
    />
  );

  if (embedded) {
    return (
      <div className="space-y-6">
        <div className="flex justify-end">{action}</div>
        {notice}
      </div>
    );
  }

  return (
    <AppPage>
      <PageContainer width="md" className="pt-6 sm:pt-8">
        <PageHeader
          title="Models"
          description="Choose a machine, then manage its recommendations, downloads, recipes, and model servers."
          actions={action}
        />
        <div className="mt-8">{notice}</div>
      </PageContainer>
    </AppPage>
  );
}
