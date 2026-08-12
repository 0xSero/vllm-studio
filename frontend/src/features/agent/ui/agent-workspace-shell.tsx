"use client";

import { Suspense, lazy, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { triggerAddProjectFlow } from "@/features/agent/ui/projects-nav/helpers";
import {
  QuickPanelTopBar,
  useQuickPanelExpandEffect,
} from "@/features/agent/ui/quick-panel/quick-panel-top-bar";
import { CloseIcon, PlusIcon } from "@/ui/icons";
import { useProjectsStore, type ProjectsStore } from "@/features/agent/projects/store";
import { useToolsStore, type ToolsContextValue } from "@/features/agent/tools/store";
import { activeSession, focusedSession } from "@/features/agent/runtime/selectors";
import { PaneGrid } from "@/features/agent/ui/pane-grid";
import { useWorkspace, type UseWorkspaceResult } from "@/features/agent/ui/use-workspace";
import { ChatPane } from "@/features/agent/ui/chat-pane";
import { useAgentWorkspaceNavigationEffects } from "@/features/agent/ui/agent-workspace-navigation";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { POPOVER_SURFACE_CLASS } from "@/ui/popover";
import { cx } from "@/ui/utils";
import { collectLeaves } from "@/features/agent/workspace/layout";
import { focusPane } from "@/features/agent/workspace/pane-controller";
import { terminalOwnerFor } from "@/features/agent/terminal-owners";
import type { AgentModel, PaneId } from "@/features/agent/workspace/types";

const LazyAgentBrowserPanel = lazy(() =>
  import("@/features/agent/ui/agent-browser-panel").then(({ AgentBrowserPanel }) => ({
    default: AgentBrowserPanel,
  })),
);

type QuickPanelMode = "composer" | "thread" | undefined;

function quickPanelMode(
  compact: boolean,
  showProjectEmptyState: boolean,
  focusedMessageCount: number,
): QuickPanelMode {
  if (!compact) return undefined;
  return showProjectEmptyState || focusedMessageCount > 0 ? "thread" : "composer";
}

function workspaceClassName(mode: QuickPanelMode): string {
  return cx(
    "agent-workspace flex h-full min-h-0 w-full flex-col text-(--fg) md:h-[100dvh]",
    mode === "composer" ? "bg-transparent" : "bg-(--agent-bg)",
    mode === "thread" && "overflow-hidden rounded-[var(--rad-xl)] shadow-[var(--shadow-2xl)]",
  );
}

function workspaceSessionIdentity(session: ReturnType<typeof focusedSession>) {
  if (!session) return { viewKey: null, viewAlias: null };
  if (!session.piSessionId) {
    return { viewKey: session.id, viewAlias: null };
  }
  return { viewKey: session.piSessionId, viewAlias: session.id };
}

const firstValue = (...values: Array<string | undefined>): string =>
  values.find((value) => Boolean(value)) ?? "";

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

export function shouldShowProjectEmptyState(
  projects: ProjectsStore,
  projectParam: string | null,
): boolean {
  return projects.loaded && !projectParam && !projects.selectedId && projects.projects.length === 0;
}

export function AgentWorkspace({ compact = false }: { compact?: boolean } = {}) {
  const workspace = useWorkspace({ ephemeral: compact });
  const { state, dispatch } = workspace;
  const projects = useProjectsStore();
  const tools = useToolsStore();
  const searchParams = useSearchParams();
  const projectParam = searchParams.get("project");

  useAgentWorkspaceNavigationEffects({
    lastHandledNavKey: state.lastHandledNavKey,
    projects,
    searchParams,
    dispatch,
  });

  const focusedTab = focusedSession(state);
  const activeSessionIdentity = workspaceSessionIdentity(focusedTab);
  const activeProject = projects.resolveProject(focusedTab);
  useActiveSessionEffects({
    ...activeSessionIdentity,
    setActiveComputerSession: tools.setActiveComputerSession,
  });
  const showProjectEmptyState = shouldShowProjectEmptyState(projects, projectParam);
  const focusedMessageCount = focusedTab?.messages.length ?? 0;
  const panelMode = quickPanelMode(compact, showProjectEmptyState, focusedMessageCount);
  const composerOnly = panelMode === "composer";
  useQuickPanelExpandEffect(compact, panelMode === "thread");
  return (
    <div data-quick-panel-state={panelMode} className={workspaceClassName(panelMode)}>
      <div
        className="agent-workspace-panel-row relative flex min-h-0 flex-1"
        data-multi-pane={collectLeaves(state.layout).length > 1 ? "true" : undefined}
      >
        <section className="relative flex min-w-0 flex-1 flex-col">
          <WorkspaceTopBar
            error={state.error}
            setupWarning={state.setupWarning}
            onClearError={() => dispatch((current) => ({ ...current, error: "" }))}
          />
          {compact ? (
            <QuickPanelTopBar
              projects={projects}
              projectId={activeProject?.id ?? null}
              sessionId={focusedTab?.piSessionId ?? null}
              hasThread={focusedMessageCount > 0}
            />
          ) : null}
          <WorkspacePaneContent
            workspace={workspace}
            showEmptyState={showProjectEmptyState}
            compact={compact}
            composerOnly={composerOnly}
          />
        </section>
        {!compact ? (
          <Suspense fallback={tools.computer.open ? <ComputerPanelFallback /> : null}>
            <LazyAgentBrowserPanel workspace={workspace} />
          </Suspense>
        ) : null}
      </div>
    </div>
  );
}

function WorkspacePaneContent({
  workspace,
  showEmptyState,
  compact,
  composerOnly,
}: {
  workspace: UseWorkspaceResult;
  showEmptyState: boolean;
  compact?: boolean;
  composerOnly: boolean;
}) {
  const { state, handles } = workspace;
  if (showEmptyState) return <ProjectEmptyState />;
  if (compact) {
    return (
      <div className="flex min-h-0 flex-1">
        <WorkspacePane
          workspace={workspace}
          paneId={state.focusedPaneId}
          compact
          composerOnly={composerOnly}
        />
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1">
      <PaneGrid
        layout={state.layout}
        renderPane={(paneId) => <WorkspacePane workspace={workspace} paneId={paneId} />}
        onSplit={handles.splitPaneWithPayload}
        onOpenTab={handles.openSessionPayloadInPane}
        onResize={handles.setSplitRatio}
      />
    </div>
  );
}

function WorkspacePane({
  workspace,
  paneId,
  compact = false,
  composerOnly = false,
}: {
  workspace: UseWorkspaceResult;
  paneId: PaneId;
  compact?: boolean;
  composerOnly?: boolean;
}) {
  const { state, dispatch, handles } = workspace;
  const projects = useProjectsStore();
  const pane = state.panesById.get(paneId);
  const session = activeSession(state, paneId);
  if (!pane || !session) return null;
  const project = projects.resolveProject(session);
  const modelId = modelIdFor(session.modelId, state.selectedModel, state.models);
  return (
    <ChatPane
      paneId={paneId}
      modelId={modelId}
      models={state.models}
      defaultModel={state.selectedModel}
      onSelectModel={(next) => handles.selectPaneModel(paneId, next)}
      onSetDefaultModel={handles.setDefaultModel}
      modelsLoading={state.modelsLoading}
      cwd={firstValue(session.cwd, project?.path, projects.selectedProject()?.path)}
      onInitGit={handles.initGitForActiveProject}
      onPiSessionIdChange={handles.notifySessionsChanged}
      isFocused={state.focusedPaneId === paneId}
      onFocus={() => dispatch((current) => focusPane(current, { paneId }))}
      session={session}
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
    <div className="pointer-events-none absolute bottom-3 right-3 z-30 flex max-w-[26rem] flex-col items-end gap-2">
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

function useActiveSessionEffects({
  viewKey,
  viewAlias,
  setActiveComputerSession,
}: {
  viewKey: string | null;
  viewAlias: string | null;
  setActiveComputerSession: ToolsContextValue["setActiveComputerSession"];
}): void {
  useMountSubscription(() => {
    setActiveComputerSession(
      viewKey ? { key: viewKey, aliases: viewAlias ? [viewAlias] : [] } : null,
    );
  }, [viewKey, viewAlias, setActiveComputerSession]);
}
