"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  consumeAgentSessionNavTitle,
  triggerAddProjectFlow,
} from "@/components/projects-nav-section";
import { makeFreshTab, newPaneId, newRuntimeId } from "@/lib/agent/session/helpers";
import { ChevronDownIcon, CloseIcon, ComputerIcon, PlusIcon } from "@/components/icons";
import type { WorkspaceDispatch } from "@/lib/agent/workspace/effects";
import type { AgentModel, PaneId, WorkspaceState } from "@/lib/agent/workspace/types";
import { useProjects, type ProjectsContextValue } from "@/lib/agent/projects/context";
import { useTools } from "@/lib/agent/tools/context";
import type { Project } from "@/lib/agent/projects/types";
import { useClickOutside } from "@/hooks/use-click-outside";
import { useAgentWorkspaceNavigationEffects } from "@/hooks/agent/use-agent-workspace-navigation-effects";
import { useActiveCanvasSessionEffects } from "@/hooks/agent/use-active-canvas-session-effects";
import { focusedSession, materializePaneSessions } from "@/lib/agent/sessions/selectors";
import { AgentBrowserPanel } from "./agent-browser-panel";
import { ChatPane } from "./chat-pane";
import { PaneGrid } from "./pane-grid";
import { collectLeaves } from "@/lib/agent/workspace/layout";
import type { WorkspaceHandles } from "./use-workspace";

type SearchParamsReader = {
  get: (key: string) => string | null;
};

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

export function requestWorkspaceUrlNavigation(
  state: WorkspaceState,
  projects: ProjectsContextValue,
  searchParams: SearchParamsReader,
  dispatch: WorkspaceDispatch,
): void {
  const projectParam = searchParams.get("project");
  const sessionParam = searchParams.get("session");
  const newParam = searchParams.get("new");
  const splitParam = searchParams.get("split");
  const navKey =
    projectParam || sessionParam || newParam
      ? `${projectParam ?? ""}|${sessionParam ?? ""}|${newParam ?? ""}|${splitParam ?? ""}`
      : "";
  if (!navKey || state.lastHandledNavKey === navKey) return;
  const target = projectParam ? projects.findById(projectParam) : null;
  // Wait until projects have loaded (or until the named project resolves).
  if (projectParam && !target) return;
  if (target) projects.selectProject(target);
  const sessionTitle = sessionParam ? consumeAgentSessionNavTitle(sessionParam) : undefined;
  dispatch({
    type: "urlNavRequested",
    key: navKey,
    project: target,
    sessionId: sessionParam,
    ...(sessionTitle ? { sessionTitle } : {}),
    newSession: newParam === "1",
    split: splitParam === "1",
    paneId: newPaneId(),
    runtimeSessionId: newRuntimeId(),
    tab: makeFreshTab(),
  });
}

export function AgentWorkspaceShell({ state, dispatch, handles }: AgentWorkspaceShellProps) {
  const projects = useProjects();
  const tools = useTools();
  const searchParams = useSearchParams();
  const projectParam = searchParams.get("project");

  useAgentWorkspaceNavigationEffects(
    useCallback(() => {
      requestWorkspaceUrlNavigation(state, projects, searchParams, dispatch);
    }, [searchParams, state, projects, dispatch]),
  );

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
  const focusedComputerUseLoaded = tools
    .selectionFor(focusedTab?.id)
    .plugins.some((plugin) =>
      [plugin.id, plugin.name, plugin.path].some((value) =>
        value?.toLowerCase().includes("computer-use"),
      ),
    );

  return (
    <div className="agent-workspace flex h-full min-h-0 w-full flex-col bg-(--bg) text-(--fg) md:h-[100dvh]">
      <div className="flex min-h-0 flex-1">
        <section className="relative flex min-w-0 flex-1 flex-col">
          <WorkspaceTopBar
            error={state.error}
            setupWarning={state.setupWarning}
            rightPanelOpen={tools.computer.open}
            focusedComputerUseLoaded={focusedComputerUseLoaded}
            onToggleComputer={tools.toggleComputerOpen}
            onClearError={() => dispatch({ type: "setError", error: "" })}
          />
          {shouldShowProjectEmptyState(projects, projectParam) ? (
            <ProjectEmptyState />
          ) : (
            <div className="min-h-0 flex-1">
              <PaneGrid
                layout={state.layout}
                renderPane={(paneId) =>
                  renderWorkspacePane(paneId, state, projects, tools, dispatch, handles)
                }
                onSplit={handles.splitPaneWithPayload}
                onOpenTab={handles.openSessionPayloadInPane}
                onResize={handles.setSplitRatio}
              />
            </div>
          )}
        </section>
        <AgentBrowserPanel
          handles={handles}
          activeProject={activeProject}
          focusedSession={focusedTab}
          sessions={[...state.sessions.values()]}
          activeModel={focusedModel}
          gitSummary={focusedGitSummary}
        />
      </div>
    </div>
  );
}

function WorkspaceTopBar({
  error,
  setupWarning,
  rightPanelOpen,
  focusedComputerUseLoaded,
  onToggleComputer,
  onClearError,
}: {
  error: string;
  setupWarning: string;
  rightPanelOpen: boolean;
  focusedComputerUseLoaded: boolean;
  onToggleComputer: () => void;
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
      <button
        type="button"
        onClick={onToggleComputer}
        aria-pressed={rightPanelOpen}
        className={`pointer-events-auto inline-flex !h-8 !min-h-8 !w-8 !min-w-8 items-center justify-center rounded-md border-0 backdrop-blur ${
          rightPanelOpen
            ? "bg-(--accent)/10 text-(--accent)"
            : "bg-transparent text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
        }`}
        title={rightPanelOpen ? "Hide computer" : "Show computer"}
        aria-label={rightPanelOpen ? "Hide computer" : "Show computer"}
      >
        <span className="relative inline-flex">
          <ComputerIcon className="h-4 w-4" />
          {focusedComputerUseLoaded ? (
            <span
              className="absolute -right-1.5 -top-1 inline-flex h-2.5 w-2.5 items-center justify-center"
              aria-hidden="true"
            >
              <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-(--accent)/35" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-(--accent)" />
            </span>
          ) : null}
        </span>
      </button>
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

function renderWorkspacePane(
  paneId: PaneId,
  state: WorkspaceState,
  projects: ProjectsContextValue,
  tools: ReturnType<typeof useTools>,
  dispatch: WorkspaceDispatch,
  handles: WorkspaceHandles,
) {
  const pane = state.panesById.get(paneId);
  if (!pane) return null;
  const onlyOne = collectLeaves(state.layout).length === 1;
  // Materialize the pane's session list from the flat sessions map. Sessions
  // are the source of truth — the pane just stores ids.
  const paneTabs = materializePaneSessions(state, pane);
  const paneActiveTab =
    paneTabs.find((tab) => tab.id === pane.activeSessionId) ?? paneTabs[0] ?? null;
  const paneProject = projects.resolveProject(paneActiveTab);
  const paneCwd = paneActiveTab?.cwd ?? paneProject?.path ?? projects.agentCwd;
  const paneModelId = paneActiveTab?.modelId ?? state.selectedModel;
  const paneModel = state.models.find((model) => model.id === paneModelId) ?? null;
  const paneGitSummary = projects.gitSummary(paneProject?.path);
  const paneGitBranch =
    paneGitSummary?.isRepo === false
      ? null
      : (paneGitSummary?.branch ?? paneProject?.branch ?? null);
  const paneTabIsNew =
    Boolean(paneActiveTab) &&
    !paneActiveTab?.piSessionId &&
    (paneActiveTab?.messages.length ?? 0) === 0;

  return (
    <ChatPane
      key={paneId}
      paneId={paneId}
      runtimeSessionId={pane.runtimeSessionId}
      modelId={paneModelId}
      modelName={paneModel?.name ?? null}
      modelsLoading={state.modelsLoading}
      contextWindow={paneModel?.contextWindow ?? 0}
      cwd={paneCwd}
      projectName={paneProject?.name ?? null}
      projectSelector={renderProjectSelector(
        paneId,
        projects.projects,
        paneProject,
        paneTabIsNew,
        handles,
      )}
      gitBranch={paneGitBranch}
      gitSummary={paneGitSummary}
      onInitGit={handles.initGitForActiveProject}
      modelSelector={
        <ModelPicker
          models={state.models}
          selectedModel={paneModelId}
          onSelect={(modelId) => handles.selectPaneModel(paneId, modelId)}
          loading={state.modelsLoading}
        />
      }
      browserToolEnabled={state.focusedPaneId === paneId && tools.browser.enabled}
      onToggleBrowserTool={tools.toggleBrowser}
      canvasEnabled={state.focusedPaneId === paneId && tools.computer.canvasEnabled}
      onToggleCanvas={tools.toggleCanvas}
      onPiSessionIdChange={handles.notifySessionsChanged}
      isFocused={state.focusedPaneId === paneId}
      onFocus={() => dispatch({ type: "focusPane", paneId })}
      tabs={paneTabs}
      activeTabId={pane.activeSessionId}
      onTabsChange={(nextTabsOrUpdater) => handles.setPaneTabs(paneId, nextTabsOrUpdater)}
      onClose={onlyOne ? undefined : () => handles.closePane(paneId)}
      onRegisterHandle={(handle) => handles.registerPaneHandle(paneId, handle)}
    />
  );
}

function renderProjectSelector(
  paneId: PaneId,
  projects: Project[],
  paneProject: Project | null | undefined,
  paneTabIsNew: boolean,
  handles: WorkspaceHandles,
) {
  if (!paneProject || projects.length === 0) return null;
  return (
    <ProjectSelector
      paneId={paneId}
      projects={projects}
      paneProject={paneProject}
      paneTabIsNew={paneTabIsNew}
      handles={handles}
    />
  );
}

function basenameOfPath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).pop() || value;
}

function ProjectSelector({
  paneId,
  projects,
  paneProject,
  paneTabIsNew,
  handles,
}: {
  paneId: PaneId;
  projects: Project[];
  paneProject: Project;
  paneTabIsNew: boolean;
  handles: WorkspaceHandles;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open, () => setOpen(false));
  const label = paneProject.name || basenameOfPath(paneProject.path);
  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => {
          if (paneTabIsNew) setOpen((value) => !value);
        }}
        disabled={!paneTabIsNew}
        className="inline-flex !h-6 !min-h-6 max-w-full min-w-0 items-center gap-1 rounded-md border-0 bg-transparent px-1.5 py-0 font-mono !text-[10px] text-(--dim) outline-none hover:bg-(--surface) hover:text-(--fg) disabled:opacity-100"
        title={paneTabIsNew ? "Change directory for this new session" : paneProject.path}
        aria-label="Session directory"
        aria-expanded={open}
      >
        <span className="min-w-0 max-w-[18ch] truncate">{label}</span>
        {paneTabIsNew ? (
          <ChevronDownIcon
            className={`h-2.5 w-2.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        ) : null}
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 z-50 mb-1 max-h-60 min-w-[min(34rem,70vw)] overflow-y-auto rounded-md border border-(--border) bg-[#151515] p-1 text-[11px] text-(--fg) shadow-[0_8px_28px_rgba(0,0,0,0.65)]">
          {projects.map((project) => (
            <button
              type="button"
              key={project.id}
              onClick={() => {
                handles.selectPaneProject(paneId, project);
                setOpen(false);
              }}
              className={`flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left font-mono ${
                project.id === paneProject.id
                  ? "bg-(--hover) text-(--fg)"
                  : "text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
              }`}
              title={project.path}
            >
              <span className="min-w-0 flex-1 truncate">{project.path}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ModelPicker({
  models,
  selectedModel,
  onSelect,
  loading,
}: {
  models: AgentModel[];
  selectedModel: string;
  onSelect: (id: string) => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const active = models.find((model) => model.id === selectedModel) || null;
  const triggerLabel = loading
    ? "Loading…"
    : active?.name || (models.length === 0 ? "No models" : "Select model");
  const disabled = loading || models.length === 0;

  return (
    <div
      className="relative shrink-0"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        setOpen(false);
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => {
          if (disabled) return;
          setOpen((value) => !value);
        }}
        disabled={disabled}
        className="inline-flex !h-7 !min-h-7 !min-w-0 max-w-[150px] items-center gap-1.5 bg-transparent px-2 !text-xs text-(--fg) hover:text-(--accent) disabled:opacity-60"
        title={active?.name || triggerLabel}
      >
        <span className="min-w-0 max-w-[118px] truncate">{triggerLabel}</span>
        <ChevronDownIcon className="h-3 w-3 shrink-0 text-(--dim)" />
      </button>
      {open ? (
        <div
          className="absolute bottom-9 right-0 z-[80] w-72 border border-(--border) bg-(--surface) shadow-lg"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="max-h-72 overflow-y-auto p-1">
            {models.map((model) => {
              const isActive = model.id === selectedModel;
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => {
                    onSelect(model.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-xs hover:bg-(--bg) ${
                    isActive ? "bg-(--bg)" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-left text-(--fg)">
                    {model.name}
                  </span>
                  {model.reasoning ? (
                    <span className="shrink-0 text-[10px] text-(--dim)">· reasoning</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
