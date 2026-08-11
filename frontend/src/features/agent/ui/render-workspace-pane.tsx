"use client";

import { useStore } from "zustand";
import { AgentModelPicker } from "@/features/agent/ui/agent-model-picker";
import { ChatPane } from "@/features/agent/ui/chat-pane";
import { useProjects } from "@/features/agent/projects/context";
import { activeSession } from "@/features/agent/runtime/selectors";
import { terminalOwnerFor } from "@/features/agent/terminal-owners";
import { collectLeaves } from "@/features/agent/workspace/layout";
import { focusPane } from "@/features/agent/workspace/pane-controller";
import type { AgentModel, PaneId } from "@/features/agent/workspace/types";
import { useWorkspaceContext } from "@/features/agent/ui/use-workspace";

function modelIdFor(
  sessionModelId: string | undefined,
  selectedModelId: string,
  models: AgentModel[],
): string {
  for (const candidate of [sessionModelId, selectedModelId]) {
    if (!candidate?.trim()) continue;
    const model = models.find(
      (entry) =>
        entry.id === candidate ||
        entry.rawId === candidate ||
        entry.name === candidate ||
        entry.id.endsWith(`/${candidate}`),
    );
    if (model) return model.id;
  }
  return (
    selectedModelId ||
    sessionModelId ||
    models.find((model) => model.active)?.id ||
    models[0]?.id ||
    ""
  );
}

export function WorkspacePane({
  paneId,
  compact = false,
  composerOnly = false,
}: {
  paneId: PaneId;
  compact?: boolean;
  composerOnly?: boolean;
}) {
  const { store, dispatch, handles } = useWorkspaceContext();
  const state = useStore(store);
  const projects = useProjects();
  const pane = state.panesById.get(paneId);
  if (!pane) return null;
  const session = activeSession(state, paneId);
  const project = projects.resolveProject(session);
  const modelId = modelIdFor(session?.modelId, state.selectedModel, state.models);
  const model = state.models.find((entry) => entry.id === modelId) ?? null;
  return (
    <ChatPane
      paneId={paneId}
      modelId={modelId}
      modelName={model?.name ?? (modelId || null)}
      modelSupportsVision={model?.vision ?? false}
      modelThinkingLevels={model?.thinkingLevels ?? ["off"]}
      modelsLoading={state.modelsLoading}
      contextWindow={model?.contextWindow ?? 0}
      cwd={session?.cwd ?? project?.path ?? projects.agentCwd}
      onInitGit={handles.initGitForActiveProject}
      modelSelector={(reasoning) => (
        <AgentModelPicker
          models={state.models}
          selectedModel={modelId}
          defaultModel={state.selectedModel}
          onSelect={(next) => handles.selectPaneModel(paneId, next)}
          onSetDefault={handles.setDefaultModel}
          loading={state.modelsLoading}
          {...reasoning}
        />
      )}
      onPiSessionIdChange={handles.notifySessionsChanged}
      isFocused={state.focusedPaneId === paneId}
      onFocus={() => dispatch((current) => focusPane(current, { paneId }))}
      tabs={session ? [session] : []}
      activeTabId={pane.sessionId}
      onUpdateSession={handles.updateSession}
      onRenameSession={(tabId, title) => handles.renameTab(paneId, tabId, title)}
      onClose={collectLeaves(state.layout).length > 1 ? () => handles.closePane(paneId) : undefined}
      onForkSession={() => handles.splitTabIntoNewPane(paneId, pane.sessionId)}
      terminalOwner={terminalOwnerFor(project, session)}
      onRegisterHandle={(handle) => handles.registerPaneHandle(paneId, handle)}
      showHeader={!compact}
      composerOnly={composerOnly}
    />
  );
}
