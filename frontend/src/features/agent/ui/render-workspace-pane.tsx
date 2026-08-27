"use client";

import { memo, useMemo } from "react";
import { AgentModelPicker } from "@/features/agent/ui/agent-model-picker";
import { ChatPane } from "@/features/agent/ui/chat-pane";
import { ComposerFocusContext } from "@/features/agent/workspace/pane-context";
import type { ProjectsContextValue } from "@/features/agent/projects/context";
import type { useTools } from "@/features/agent/tools/context";
import { isChatsProject, type Project } from "@/features/agent/projects/types";
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
import type { WorkspaceHandles } from "@/features/agent/ui/use-workspace";
import { isMessagingSessionId, type AgentHarness } from "@/features/agent/runtime/types";
import { readAgentDefaults } from "@/features/agent/workspace/model-preference";
import { openWorkbenchResource } from "@/features/workbench/controller-state";

export type WorkspacePaneRenderContext = {
  paneId: PaneId;
  state: WorkspaceState;
  projects: ProjectsContextValue;
  tools: ReturnType<typeof useTools>;
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
  modelRouteId: string;
  model: AgentModel | null;
  gitSummary: ReturnType<ProjectsContextValue["gitSummary"]>;
  gitBranch: string | null;
  isNewSession: boolean;
  canClose: boolean;
  isFocused: boolean;
};

function paneGitBranch(
  summary: ReturnType<ProjectsContextValue["gitSummary"]>,
  project: Project | null,
): string | null {
  return summary?.isRepo === false ? null : (summary?.branch ?? project?.branch ?? null);
}

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
        model.name === candidate ||
        model.id.endsWith(`/${candidate}`) ||
        model.routes.some((route) => route.id === candidate || route.rawModelId === candidate),
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
  const model = state.models.find((candidate) => candidate.id === modelId) ?? null;
  const preferredRouteId = session?.modelRouteId || state.selectedRoute;
  const modelRouteId =
    model?.routes.find((route) => route.id === preferredRouteId)?.id ??
    model?.defaultRouteId ??
    model?.routes[0]?.id ??
    "";
  const gitSummary = projects.gitSummary(project?.path);
  return {
    paneId,
    pane,
    session,
    project,
    cwd: session?.cwd ?? project?.path ?? projects.agentCwd,
    modelId,
    modelRouteId,
    model,
    gitSummary,
    gitBranch: paneGitBranch(gitSummary, project),
    isNewSession: Boolean(session && !session.piSessionId && session.messages.length === 0),
    canClose: collectLeaves(state.layout).length > 1,
    isFocused: state.focusedPaneId === paneId,
  };
}

export function sameWorkspacePaneView(
  previous: WorkspacePaneView,
  next: WorkspacePaneView,
): boolean {
  return (
    previous.paneId === next.paneId &&
    previous.pane === next.pane &&
    previous.session === next.session &&
    previous.project === next.project &&
    previous.cwd === next.cwd &&
    previous.modelId === next.modelId &&
    previous.modelRouteId === next.modelRouteId &&
    previous.model === next.model &&
    previous.gitSummary === next.gitSummary &&
    previous.gitBranch === next.gitBranch &&
    previous.isNewSession === next.isNewSession &&
    previous.canClose === next.canClose &&
    previous.isFocused === next.isFocused
  );
}

type WorkspacePaneProps = {
  view: WorkspacePaneView;
  composerFocusIntent: WorkspaceState["composerFocusIntent"];
  models: AgentModel[];
  modelsLoading: boolean;
  defaultModel: string;
  tools: ReturnType<typeof useTools>;
  dispatch: WorkspaceDispatch;
  handles: WorkspaceHandles;
  compact: boolean;
  composerOnly: boolean;
};

function sameWorkspacePaneProps(previous: WorkspacePaneProps, next: WorkspacePaneProps): boolean {
  return (
    sameWorkspacePaneView(previous.view, next.view) &&
    previous.composerFocusIntent === next.composerFocusIntent &&
    previous.models === next.models &&
    previous.modelsLoading === next.modelsLoading &&
    previous.defaultModel === next.defaultModel &&
    previous.tools.browser.enabled === next.tools.browser.enabled &&
    previous.tools.browser.backend === next.tools.browser.backend &&
    previous.tools.computer.open === next.tools.computer.open &&
    previous.tools.toggleBrowserBackend === next.tools.toggleBrowserBackend &&
    previous.tools.setBrowserEnabled === next.tools.setBrowserEnabled &&
    previous.tools.closeComputerTab === next.tools.closeComputerTab &&
    previous.tools.setComputerTab === next.tools.setComputerTab &&
    previous.tools.toggleComputerOpen === next.tools.toggleComputerOpen &&
    previous.dispatch === next.dispatch &&
    previous.handles === next.handles &&
    previous.compact === next.compact &&
    previous.composerOnly === next.composerOnly
  );
}

const WorkspacePane = memo(function WorkspacePane({
  view,
  composerFocusIntent,
  models,
  modelsLoading,
  defaultModel,
  tools,
  dispatch,
  handles,
  compact,
  composerOnly,
}: WorkspacePaneProps) {
  const sessions = view.session ? [view.session] : [];
  const chatWorkspace = isChatsProject(view.project);
  const defaultHarness =
    typeof window === "undefined" ? "pi" : readAgentDefaults(window.localStorage).harness;
  const composerFocus = useMemo(
    () => ({ tabId: view.pane.sessionId, composerFocusIntent }),
    [view.pane.sessionId, composerFocusIntent],
  );
  const messagingSession = isMessagingSessionId(view.pane.sessionId);
  return (
    <ComposerFocusContext.Provider value={composerFocus}>
      <ChatPane
        paneId={view.paneId}
        modelId={view.modelId}
        modelRouteId={view.modelRouteId}
        modelName={view.model?.name ?? view.modelId ?? null}
        modelSupportsVision={view.model?.vision ?? false}
        modelThinkingLevels={view.model?.thinkingLevels ?? ["off"]}
        modelsLoading={modelsLoading}
        contextWindow={view.model?.contextWindow ?? 0}
        cwd={view.cwd}
        projectId={view.project?.id ?? null}
        projectName={view.project?.name ?? null}
        gitBranch={view.gitBranch}
        gitSummary={view.gitSummary}
        onInitGit={handles.initGitForActiveProject}
        modelSelector={(reasoning) => (
          <AgentModelPicker
            models={models}
            selectedModel={view.modelId}
            selectedRoute={view.modelRouteId}
            defaultModel={defaultModel}
            onSelect={(modelId, routeId) => handles.selectPaneModel(view.paneId, modelId, routeId)}
            selectedHarness={view.session?.harness ?? defaultHarness}
            harnessDisabled={chatWorkspace || !view.isNewSession}
            {...(chatWorkspace
              ? {}
              : {
                  onSelectHarness: (harness: string) =>
                    handles.updateSession(view.pane.sessionId, (session) => ({
                      ...session,
                      harness: harness as AgentHarness,
                    })),
                })}
            loading={modelsLoading}
            {...reasoning}
          />
        )}
        browserToolEnabled={chatWorkspace ? true : tools.browser.enabled}
        browserBackend={chatWorkspace ? "embedded" : tools.browser.backend}
        onToggleBrowserBackend={tools.toggleBrowserBackend}
        onToggleBrowserTool={() => {
          if (chatWorkspace) return;
          if (tools.browser.enabled) {
            tools.setBrowserEnabled(false);
            tools.closeComputerTab("browser");
            return;
          }
          tools.setBrowserEnabled(true);
          tools.setComputerTab("browser");
        }}
        onPiSessionIdChange={handles.notifySessionsChanged}
        isFocused={view.isFocused}
        onFocus={() => dispatch({ type: "focusPane", paneId: view.paneId })}
        tabs={sessions}
        activeTabId={view.pane.sessionId}
        onUpdateSession={handles.updateSession}
        onRenameSession={(tabId, title) => handles.renameTab(view.paneId, tabId, title)}
        onClose={view.canClose ? () => handles.closePane(view.paneId) : undefined}
        terminalOwner={chatWorkspace ? null : terminalOwnerFor(view.project, view.session)}
        onOpenTerminal={
          chatWorkspace
            ? undefined
            : () =>
                openWorkbenchResource({
                  kind: "terminal",
                  resourceId: crypto.randomUUID(),
                  title: "Terminal",
                })
        }
        rightPanelOpen={tools.computer.open}
        onToggleRightPanel={tools.toggleComputerOpen}
        onRegisterHandle={(handle) => handles.registerPaneHandle(view.paneId, handle)}
        showHeader={!compact && chatWorkspace}
        composerOnly={composerOnly}
        readOnly={messagingSession}
      />
    </ComposerFocusContext.Provider>
  );
}, sameWorkspacePaneProps);

export function renderWorkspacePane({
  paneId,
  state,
  projects,
  tools,
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
      composerFocusIntent={state.composerFocusIntent}
      models={state.models}
      modelsLoading={state.modelsLoading}
      defaultModel={state.selectedModel}
      tools={tools}
      dispatch={dispatch}
      handles={handles}
      compact={compact}
      composerOnly={composerOnly}
    />
  );
}
