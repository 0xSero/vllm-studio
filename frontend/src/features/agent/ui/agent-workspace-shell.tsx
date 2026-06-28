"use client";

import { Suspense, lazy, useCallback, useSyncExternalStore, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  consumeAgentSessionNavTitle,
  triggerAddProjectFlow,
} from "@/features/agent/ui/projects-nav-section";
import { AgentModelPicker } from "@/features/agent/ui/agent-model-picker";
import { CloseIcon, PlusIcon } from "@/ui/icons";
import type { WorkspaceDispatch } from "@/features/agent/workspace/effects";
import type {
  AgentModel,
  PaneId,
  PaneState,
  WorkspaceState,
} from "@/features/agent/workspace/types";
import { useProjects, type ProjectsContextValue } from "@/features/agent/projects/context";
import { useTools } from "@/features/agent/tools/context";
import type { Project } from "@/features/agent/projects/types";
import type { SessionId } from "@/features/agent/runtime/types";
import { makeFreshTab, newPaneId } from "@/features/agent/messages/helpers";
import { loadPersistedActiveAgentSessions } from "@/features/agent/workspace/store";
import { activeSession, focusedSession } from "@/features/agent/runtime/selectors";
import { ChatPane } from "@/features/agent/ui/chat-pane";
import { PaneGrid } from "@/features/agent/ui/pane-grid";
import { collectLeaves } from "@/features/agent/workspace/layout";
import { useWorkspace, type WorkspaceHandles } from "@/features/agent/ui/use-workspace";

const LazyAgentBrowserPanel = lazy(() =>
  import("@/features/agent/ui/agent-browser-panel").then(({ AgentBrowserPanel }) => ({
    default: AgentBrowserPanel,
  })),
);

type AgentWorkspaceShellProps = {
  state: WorkspaceState;
  dispatch: WorkspaceDispatch;
  handles: WorkspaceHandles;
};

export function shouldShowProjectEmptyState(
  projects: ProjectsContextValue,
  projectParam: string | null,
): boolean {
  return (
    projects.loaded &&
    !projectParam &&
    !projects.selectedProjectId &&
    projects.projects.length === 0
  );
}

export function AgentWorkspaceShell({ state, dispatch, handles }: AgentWorkspaceShellProps) {
  const projects = useProjects();
  const tools = useTools();
  const searchParams = useSearchParams();
  const projectParam = searchParams.get("project");

  useAgentWorkspaceNavigationEffects({
    lastHandledNavKey: state.lastHandledNavKey,
    projects,
    searchParams,
    dispatch,
  });

  const focusedTab = focusedSession(state);
  // The right panel (browser / files / git / terminal / status) follows the
  // FOCUSED session, not the workspace-global selectedProject. Otherwise
  // splitting/switching panes leaves the right panel pinned to whichever
  // project was active when the panel was first opened.
  const activeProject = projects.resolveProject(focusedTab) ?? projects.selectedProject;
  useActiveCanvasSessionEffects({
    sessionId: focusedTab?.id ?? null,
    setActiveCanvasSession: tools.setActiveCanvasSession,
  });
  const focusedModel =
    state.models.find((model) => model.id === (focusedTab?.modelId ?? state.selectedModel)) ?? null;
  const focusedGitSummary = projects.gitSummary(activeProject?.path ?? focusedTab?.cwd);
  return (
    <div className="agent-workspace flex h-full min-h-0 w-full flex-col bg-(--agent-bg) text-(--fg) md:h-[100dvh]">
      <div className="flex min-h-0 flex-1">
        <section className="relative flex min-w-0 flex-1 flex-col">
          <WorkspaceTopBar
            error={state.error}
            setupWarning={state.setupWarning}
            onClearError={() => dispatch({ type: "setError", error: "" })}
          />
          {shouldShowProjectEmptyState(projects, projectParam) ? (
            <ProjectEmptyState />
          ) : (
            <div className="min-h-0 flex-1">
              <PaneGrid
                layout={state.layout}
                renderPane={(paneId) =>
                  renderWorkspacePane({ paneId, state, projects, tools, dispatch, handles })
                }
                onSplit={handles.splitPaneWithPayload}
                onOpenTab={handles.openSessionPayloadInPane}
                onResize={handles.setSplitRatio}
              />
            </div>
          )}
        </section>
        {tools.computer.open ? (
          <Suspense fallback={<ComputerPanelFallback />}>
            <LazyAgentBrowserPanel
              handles={handles}
              activeProject={activeProject}
              focusedSession={focusedTab}
              sessions={[...state.sessions.values()]}
              activeModelId={focusedTab?.modelId ?? state.selectedModel}
              activeModel={focusedModel}
              gitSummary={focusedGitSummary}
            />
          </Suspense>
        ) : null}
      </div>
    </div>
  );
}

function ComputerPanelFallback() {
  return (
    <aside className="relative flex w-[360px] shrink-0 flex-col border-l border-(--border) bg-(--color-panel)">
      <div className="h-10 shrink-0 border-b border-(--border)/85 bg-(--color-header)" />
      <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-(--dim)">
        Loading tools...
      </div>
    </aside>
  );
}

function WorkspaceTopBar({
  error,
  setupWarning,
  onClearError,
}: {
  error: string;
  setupWarning: string;
  onClearError: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start gap-3 px-3 pt-2">
      <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2">
        {error ? (
          <WorkspaceBanner tone="error" onDismiss={onClearError}>
            {error}
          </WorkspaceBanner>
        ) : null}
        {setupWarning ? <WorkspaceBanner tone="warning">{setupWarning}</WorkspaceBanner> : null}
      </div>
    </div>
  );
}

function WorkspaceBanner({
  tone,
  onDismiss,
  children,
}: {
  tone: "error" | "warning";
  onDismiss?: () => void;
  children: ReactNode;
}) {
  const toneClass =
    tone === "error"
      ? "border-(--err)/35 bg-(--err)/10 text-(--err)"
      : "border-(--warn)/35 bg-(--warn)/10 text-(--fg)";
  return (
    <div
      className={`flex min-w-0 max-w-full items-center gap-2 rounded border px-2 py-1 text-xs ${toneClass}`}
    >
      <span className="min-w-0 truncate">{children}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-current opacity-70 hover:opacity-100"
          aria-label="Dismiss error"
        >
          <CloseIcon className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function ProjectEmptyState() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <div className="text-sm font-semibold text-(--fg)">Add a project to get started</div>
        <p className="mt-2 text-xs leading-5 text-(--dim)">
          Choose a local folder so the agent can scope files and sessions to your work.
        </p>
        <button
          type="button"
          onClick={triggerAddProjectFlow}
          className="mt-4 inline-flex h-9 items-center gap-2 rounded border border-(--border) bg-(--surface) px-3 text-sm font-medium text-(--fg) hover:bg-(--bg)"
        >
          <PlusIcon className="h-4 w-4" />
          Add a project
        </button>
      </div>
    </div>
  );
}

type WorkspacePaneRenderContext = {
  paneId: PaneId;
  state: WorkspaceState;
  projects: ProjectsContextValue;
  tools: ReturnType<typeof useTools>;
  dispatch: WorkspaceDispatch;
  handles: WorkspaceHandles;
};

type WorkspacePaneView = {
  paneId: PaneId;
  pane: PaneState;
  session: ReturnType<typeof activeSession>;
  sessionList: NonNullable<ReturnType<typeof activeSession>>[];
  project: Project | null;
  cwd: string;
  modelId: string;
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
  const gitSummary = projects.gitSummary(project?.path);
  return {
    paneId,
    pane,
    session,
    sessionList: session ? [session] : [],
    project,
    cwd: session?.cwd ?? project?.path ?? projects.agentCwd,
    modelId,
    model: state.models.find((model) => model.id === modelId) ?? null,
    gitSummary,
    gitBranch: paneGitBranch(gitSummary, project),
    isNewSession: Boolean(session && !session.piSessionId && session.messages.length === 0),
    canClose: collectLeaves(state.layout).length > 1,
    isFocused: state.focusedPaneId === paneId,
  };
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

function renderWorkspacePane({
  paneId,
  state,
  projects,
  tools,
  dispatch,
  handles,
}: WorkspacePaneRenderContext) {
  const view = selectWorkspacePaneView(paneId, state, projects);
  if (!view) return null;
  const browserPanelOpen =
    view.isFocused &&
    tools.browser.enabled &&
    tools.computer.open &&
    tools.computer.tab === "browser";

  return (
    <ChatPane
      key={view.paneId}
      paneId={view.paneId}
      runtimeSessionId={view.session?.runtimeSessionId ?? ""}
      modelId={view.modelId}
      modelName={view.model?.name ?? view.modelId ?? null}
      modelSupportsVision={view.model?.vision ?? false}
      modelsLoading={state.modelsLoading}
      contextWindow={view.model?.contextWindow ?? 0}
      cwd={view.cwd}
      projectName={view.project?.name ?? null}
      gitBranch={view.gitBranch}
      gitSummary={view.gitSummary}
      onInitGit={handles.initGitForActiveProject}
      modelSelector={
        <AgentModelPicker
          models={state.models}
          selectedModel={view.modelId}
          onSelect={(modelId) => handles.selectPaneModel(view.paneId, modelId)}
          loading={state.modelsLoading}
        />
      }
      browserToolEnabled={browserPanelOpen}
      browserBackend={tools.browser.backend}
      onToggleBrowserBackend={tools.toggleBrowserBackend}
      onToggleBrowserTool={() => {
        if (browserPanelOpen) {
          tools.closeComputerTab("browser");
          tools.setBrowserEnabled(false);
          return;
        }
        tools.setComputerTab("browser");
        tools.setBrowserEnabled(true);
      }}
      canvasEnabled={view.isFocused && tools.computer.canvasEnabled}
      onToggleCanvas={tools.toggleCanvas}
      onPiSessionIdChange={handles.notifySessionsChanged}
      isFocused={view.isFocused}
      onFocus={() => dispatch({ type: "focusPane", paneId: view.paneId })}
      tabs={view.sessionList}
      activeTabId={view.pane.sessionId}
      onTabsChange={(nextTabsOrUpdater) => handles.setPaneTabs(view.paneId, nextTabsOrUpdater)}
      onRenameSession={(tabId, title) => handles.renameTab(view.paneId, tabId, title)}
      onClose={view.canClose ? () => handles.closePane(view.paneId) : undefined}
      onForkSession={() => handles.splitTabIntoNewPane(view.paneId, view.pane.sessionId)}
      rightPanelOpen={tools.computer.open}
      onToggleRightPanel={tools.toggleComputerOpen}
      onRegisterHandle={(handle) => handles.registerPaneHandle(view.paneId, handle)}
    />
  );
}

function useActiveCanvasSessionEffects({
  sessionId,
  setActiveCanvasSession,
}: {
  sessionId: SessionId | null;
  setActiveCanvasSession: (id: SessionId | null) => void;
}): void {
  const subscribe = useCallback(
    (_notify: () => void) => {
      setActiveCanvasSession(sessionId);
      return () => {};
    },
    [sessionId, setActiveCanvasSession],
  );

  useSyncExternalStore(subscribe, getActiveCanvasSessionSnapshot, getActiveCanvasSessionSnapshot);
}

const getActiveCanvasSessionSnapshot = (): number => 0;

type SearchParamsReader = {
  get: (key: string) => string | null;
};

type WorkspaceNavigationDeps = {
  lastHandledNavKey: string;
  projects: ProjectsContextValue;
  searchParams: SearchParamsReader;
  dispatch: WorkspaceDispatch;
};

type PersistedSession = ReturnType<typeof loadPersistedActiveAgentSessions>[number];

function navigationKey(
  projectId: string | null,
  sessionId: string | null,
  newParam: string | null,
  openParam: string | null,
  splitParam: string | null,
): string {
  if (!(projectId || sessionId || newParam || openParam)) return "";
  return `${projectId ?? ""}|${sessionId ?? ""}|${newParam ?? ""}|${openParam ?? ""}|${splitParam ?? ""}`;
}

function persistedSessionFor(sessionId: string | null): PersistedSession | null {
  if (!sessionId) return null;
  return (
    loadPersistedActiveAgentSessions().find((session) => session.piSessionId === sessionId) ?? null
  );
}

function projectForNavigation(
  projects: ProjectsContextValue,
  projectId: string | null,
  persistedSession: PersistedSession | null,
) {
  if (projectId) return projects.findById(projectId);
  if (persistedSession?.projectId) return projects.findById(persistedSession.projectId);
  return null;
}

function replayTabFor(persistedSession: PersistedSession | null) {
  const tab = makeFreshTab();
  if (!persistedSession) return tab;
  return {
    ...tab,
    id: persistedSession.tabId || tab.id,
    runtimeSessionId: persistedSession.runtimeSessionId || tab.runtimeSessionId,
    piSessionId: persistedSession.piSessionId,
    projectId: persistedSession.projectId,
    cwd: persistedSession.cwd,
    modelId: persistedSession.modelId,
    title: persistedSession.title || tab.title,
    startedAt: persistedSession.startedAt ?? persistedSession.updatedAt,
  };
}

function requestWorkspaceUrlNavigation({
  lastHandledNavKey,
  projects,
  searchParams,
  dispatch,
}: WorkspaceNavigationDeps): void {
  const projectId = searchParams.get("project");
  const sessionId = searchParams.get("session");
  const newParam = searchParams.get("new");
  const openParam = searchParams.get("open");
  const splitParam = searchParams.get("split");
  const key = navigationKey(projectId, sessionId, newParam, openParam, splitParam);
  if (!key || lastHandledNavKey === key) return;

  const persistedSession = persistedSessionFor(sessionId);
  const project = projectForNavigation(projects, projectId, persistedSession);
  if (projectId && !project) return;

  if (project) projects.selectProject(project);
  const sessionTitle = sessionId ? consumeAgentSessionNavTitle(sessionId) : undefined;

  dispatch({
    type: "urlNavRequested",
    key,
    project,
    sessionId,
    ...(sessionTitle ? { sessionTitle } : {}),
    newSession: newParam !== null,
    split: splitParam === "1",
    paneId: newPaneId(),
    tab: replayTabFor(persistedSession),
  });
}

function useAgentWorkspaceNavigationEffects({
  lastHandledNavKey,
  projects,
  searchParams,
  dispatch,
}: WorkspaceNavigationDeps): void {
  const subscribe = useCallback(
    (_notify: () => void) => {
      requestWorkspaceUrlNavigation({ lastHandledNavKey, projects, searchParams, dispatch });
      return () => {};
    },
    [lastHandledNavKey, projects, searchParams, dispatch],
  );

  useSyncExternalStore(subscribe, getWorkspaceNavigationSnapshot, getWorkspaceNavigationSnapshot);
}

const getWorkspaceNavigationSnapshot = (): number => 0;

export function AgentWorkspace() {
  const { state, dispatch, handles } = useWorkspace();
  return <AgentWorkspaceShell state={state} dispatch={dispatch} handles={handles} />;
}
