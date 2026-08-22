"use client";

import { Suspense, lazy, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { triggerAddProjectFlow } from "@/features/agent/ui/projects-nav/helpers";
import { CloseIcon, PlusIcon } from "@/ui/icons";
import type { WorkspaceDispatch } from "@/features/agent/workspace/effects";
import type { AgentModel, WorkspaceState } from "@/features/agent/workspace/types";
import { useProjects, type ProjectsContextValue } from "@/features/agent/projects/context";
import { useTools } from "@/features/agent/tools/context";
import type { Project } from "@/features/agent/projects/types";
import { focusedSession } from "@/features/agent/runtime/selectors";
import { PaneGrid } from "@/features/agent/ui/pane-grid";
import { useWorkspace, type WorkspaceHandles } from "@/features/agent/ui/use-workspace";
import { renderWorkspacePane } from "@/features/agent/ui/render-workspace-pane";
import { useAgentWorkspaceNavigationEffects } from "@/features/agent/ui/agent-workspace-navigation";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { POPOVER_SURFACE_CLASS } from "@/ui/popover";
import { collectLeaves } from "@/features/agent/workspace/layout";

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
  const activeProject = projects.resolveProject(focusedTab) ?? projects.selectedProject;
  // A pi-backed session is addressed by its runtime id, with the tab id kept as
  // an alias; a tab that has not started one yet is addressed by its own id.
  const viewKey = focusedTab ? focusedTab.piSessionId || focusedTab.id : null;
  const viewAlias = focusedTab?.piSessionId ? focusedTab.id : null;
  const { setActiveComputerSession } = tools;
  useMountSubscription(() => {
    setActiveComputerSession(
      viewKey ? { key: viewKey, aliases: viewAlias ? [viewAlias] : [] } : null,
    );
  }, [viewKey, viewAlias, setActiveComputerSession]);
  const focusedModel =
    state.models.find((model) => model.id === (focusedTab?.modelId ?? state.selectedModel)) ?? null;
  const focusedGitSummary = projects.gitSummary(activeProject?.path ?? focusedTab?.cwd);
  const showProjectEmptyState = shouldShowProjectEmptyState(projects, projectParam);
  return (
    <div className="agent-workspace flex h-full min-h-0 w-full flex-col bg-(--agent-bg) text-(--fg) md:h-[100dvh]">
      <div
        className="agent-workspace-panel-row relative flex min-h-0 flex-1"
        data-multi-pane={collectLeaves(state.layout).length > 1 ? "true" : undefined}
      >
        <section className="relative flex min-w-0 flex-1 flex-col">
          <WorkspaceTopBar
            error={state.error}
            setupWarning={state.setupWarning}
            onClearError={() => dispatch({ type: "setError", error: "" })}
          />
          {showProjectEmptyState ? (
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
        <Suspense fallback={tools.computer.open ? <ComputerPanelFallback /> : null}>
          <LazyAgentBrowserPanel
            handles={handles}
            activeProject={activeProject}
            focusedSession={focusedTab}
            sessions={[...state.sessions.values()]}
            activeModelId={focusedTab?.modelId ?? state.selectedModel}
            activeModel={focusedModel}
            gitSummary={focusedGitSummary}
            models={state.models}
            modelsLoading={state.modelsLoading}
          />
        </Suspense>
      </div>
    </div>
  );
}

function ComputerPanelFallback() {
  return (
    <aside className="relative flex w-[360px] shrink-0 flex-col bg-(--color-panel) shadow-[var(--elev-side-panel)]">
      <div className="h-[var(--h-toolbar-pane)] shrink-0 border-b border-(--border) bg-(--color-header)" />
      <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-(--dim)">
        Loading tools...
      </div>
    </aside>
  );
}

function humanizeWorkspaceNotice(message: string): string {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("fetch failed") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("network") ||
    normalized.includes("econnrefused") ||
    normalized.includes("terminated") ||
    normalized.includes("socket") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out")
  ) {
    return "Can't reach the controller right now — retrying in the background. Check Settings → General if this persists.";
  }
  if (normalized.includes("unauthorized") || normalized.includes("401")) {
    return "The controller rejected the API key. Update it in Settings → General.";
  }
  return message;
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
  if (!error && !setupWarning) return null;
  return (
    <div className="pointer-events-none absolute right-3 top-[calc(var(--h-toolbar-pane)+0.75rem)] z-[110] flex max-w-[26rem] flex-col items-end gap-2">
      {error ? (
        <WorkspaceBanner tone="error" onDismiss={onClearError}>
          {humanizeWorkspaceNotice(error)}
        </WorkspaceBanner>
      ) : null}
      {setupWarning ? <WorkspaceBanner tone="warning">{setupWarning}</WorkspaceBanner> : null}
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
  return (
    <div
      className={`pointer-events-auto flex min-w-0 max-w-full items-start gap-2.5 px-3 py-2.5 text-[length:var(--fs-md)] text-(--fg) ${POPOVER_SURFACE_CLASS}`}
    >
      <span
        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${tone === "error" ? "bg-(--err)" : "bg-(--warn)"}`}
        aria-hidden
      />
      <span className="min-w-0 flex-1 leading-5 [overflow-wrap:anywhere]">{children}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="mt-0.5 shrink-0 text-(--hl2) hover:text-(--fg)"
          aria-label="Dismiss"
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
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-full bg-(--fg)/5 px-4 text-[length:var(--fs-base)] font-medium text-(--fg) hover:bg-(--fg)/10"
        >
          <PlusIcon className="h-4 w-4" />
          Add a project
        </button>
      </div>
    </div>
  );
}

export function AgentWorkspace() {
  const { state, dispatch, handles } = useWorkspace();
  return <AgentWorkspaceShell state={state} dispatch={dispatch} handles={handles} />;
}
