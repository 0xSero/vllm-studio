"use client";

import { memo } from "react";
import { shallow } from "zustand/shallow";
import { AgentModelPicker } from "@/features/agent/ui/agent-model-picker";
import { ChatPane } from "@/features/agent/ui/chat-pane";
import type { ProjectsContextValue } from "@/features/agent/projects/context";
import type { Project } from "@/features/agent/projects/types";
import type { WorkspaceDispatch } from "@/features/agent/workspace/effects";
import type {
  AgentModel,
  ChatPaneState,
  PaneId,
  WorkspaceState,
} from "@/features/agent/workspace/types";
import { activeSession } from "@/features/agent/runtime/selectors";
import { terminalOwnerFor } from "@/features/agent/terminal-owners";
import { collectLeaves } from "@/features/agent/workspace/layout";
import { focusPane } from "@/features/agent/workspace/pane-controller";
import type { WorkspaceHandles } from "@/features/agent/ui/use-workspace";

export type WorkspacePaneRenderContext = {
  paneId: PaneId;
  state: WorkspaceState;
  projects: ProjectsContextValue;
  dispatch: WorkspaceDispatch;
  handles: WorkspaceHandles;
  compact?: boolean;
  composerOnly?: boolean;
};

export type WorkspacePaneView = {
  paneId: PaneId;
  pane: ChatPaneState;
  session: ReturnType<typeof activeSession>;
  project: Project | null;
  cwd: string;
  modelId: string;
  model: AgentModel | null;
  isNewSession: boolean;
  canClose: boolean;
  isFocused: boolean;
};

function resolvePaneModelId(
  sessionModelId: string | undefined,
  selectedModelId: string,
  models: AgentModel[],
): string {
  const candidates = [sessionModelId, selectedModelId].filter((value): value is string =>
    Boolean(value?.trim()),
  );
  for (const candidate of candidates) {
    const exact = models.find((model) => model.id === candidate);
    if (exact) return exact.id;
    const alias = models.find(
      (model) =>
        model.rawId === candidate || model.name === candidate || model.id.endsWith(`/${candidate}`),
    );
    if (alias) return alias.id;
  }
  return (
    selectedModelId ||
    sessionModelId ||
    models.find((model) => model.active)?.id ||
    models[0]?.id ||
    ""
  );
}

function selectWorkspacePaneView(
  paneId: PaneId,
  state: WorkspaceState,
  projects: ProjectsContextValue,
): WorkspacePaneView | null {
  const pane = state.panesById.get(paneId);
  if (!pane) return null;
  const session = activeSession(state, paneId);
  const project = projects.resolveProject(session);
  const modelId = resolvePaneModelId(session?.modelId, state.selectedModel, state.models);
  return {
    paneId,
    pane,
    session,
    project,
    cwd: session?.cwd ?? project?.path ?? projects.agentCwd,
    modelId,
    model: state.models.find((model) => model.id === modelId) ?? null,
    isNewSession: Boolean(session && !session.piSessionId && session.messages.length === 0),
    canClose: collectLeaves(state.layout).length > 1,
    isFocused: state.focusedPaneId === paneId,
  };
}

export function sameWorkspacePaneView(
  previous: WorkspacePaneView,
  next: WorkspacePaneView,
): boolean {
  return shallow(previous, next);
}

type WorkspacePaneProps = {
  view: WorkspacePaneView;
  models: AgentModel[];
  modelsLoading: boolean;
  defaultModel: string;
  dispatch: WorkspaceDispatch;
  handles: WorkspaceHandles;
  compact: boolean;
  composerOnly: boolean;
};

function sameWorkspacePaneProps(previous: WorkspacePaneProps, next: WorkspacePaneProps): boolean {
  return (
    sameWorkspacePaneView(previous.view, next.view) &&
    previous.models === next.models &&
    previous.modelsLoading === next.modelsLoading &&
    previous.defaultModel === next.defaultModel &&
    previous.dispatch === next.dispatch &&
    previous.handles === next.handles &&
    previous.compact === next.compact &&
    previous.composerOnly === next.composerOnly
  );
}

const WorkspacePane = memo(function WorkspacePane({
  view,
  models,
  modelsLoading,
  defaultModel,
  dispatch,
  handles,
  compact,
  composerOnly,
}: WorkspacePaneProps) {
  const sessions = view.session ? [view.session] : [];
  return (
    <ChatPane
      paneId={view.paneId}
      modelId={view.modelId}
      modelName={view.model?.name ?? view.modelId ?? null}
      modelSupportsVision={view.model?.vision ?? false}
      modelThinkingLevels={view.model?.thinkingLevels ?? ["off"]}
      modelsLoading={modelsLoading}
      contextWindow={view.model?.contextWindow ?? 0}
      cwd={view.cwd}
      onInitGit={handles.initGitForActiveProject}
      modelSelector={(reasoning) => (
        <AgentModelPicker
          models={models}
          selectedModel={view.modelId}
          defaultModel={defaultModel}
          onSelect={(modelId) => handles.selectPaneModel(view.paneId, modelId)}
          onSetDefault={handles.setDefaultModel}
          loading={modelsLoading}
          {...reasoning}
        />
      )}
      onPiSessionIdChange={handles.notifySessionsChanged}
      isFocused={view.isFocused}
      onFocus={() => dispatch((state) => focusPane(state, { paneId: view.paneId }))}
      tabs={sessions}
      activeTabId={view.pane.sessionId}
      onUpdateSession={handles.updateSession}
      onRenameSession={(tabId, title) => handles.renameTab(view.paneId, tabId, title)}
      onClose={view.canClose ? () => handles.closePane(view.paneId) : undefined}
      onForkSession={() => handles.splitTabIntoNewPane(view.paneId, view.pane.sessionId)}
      terminalOwner={terminalOwnerFor(view.project, view.session)}
      onRegisterHandle={(handle) => handles.registerPaneHandle(view.paneId, handle)}
      showHeader={!compact}
      composerOnly={composerOnly}
    />
  );
}, sameWorkspacePaneProps);

export function renderWorkspacePane({
  paneId,
  state,
  projects,
  dispatch,
  handles,
  compact = false,
  composerOnly = false,
}: WorkspacePaneRenderContext) {
  const view = selectWorkspacePaneView(paneId, state, projects);
  if (!view) return null;

  return (
    <WorkspacePane
      key={view.paneId}
      view={view}
      models={state.models}
      modelsLoading={state.modelsLoading}
      defaultModel={state.selectedModel}
      dispatch={dispatch}
      handles={handles}
      compact={compact}
      composerOnly={composerOnly}
    />
  );
}
