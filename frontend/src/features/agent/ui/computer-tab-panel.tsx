"use client";

import { Suspense, lazy, type ReactNode } from "react";
import { useToolsStore } from "@/features/agent/tools/store";
import type { ComputerTab } from "@/features/agent/tools/types";
import { LAUNCHER_RESOURCES } from "@/features/agent/tools/resources";
import { useProjectsStore } from "@/features/agent/projects/store";
import type { Project } from "@/features/agent/projects/types";
import type { Session } from "@/features/agent/runtime/types";
import { focusedSession as selectFocusedSession } from "@/features/agent/runtime/selectors";
import type { WorkbenchState } from "@/features/agent/workbench/store";
import type { AgentModel } from "@/features/agent/workspace/types";
import { ChatPane } from "@/features/agent/ui/chat-pane";

const LazyAgentBrowser = lazy(() =>
  import("@/features/agent/ui/agent-browser").then(({ AgentBrowser }) => ({
    default: AgentBrowser,
  })),
);
const LazyComputerStatusPanel = lazy(() =>
  import("@/features/agent/ui/computer-status-panel").then(({ ComputerStatusPanel }) => ({
    default: ComputerStatusPanel,
  })),
);
const LazyFilesystemPanel = lazy(() =>
  import("@/features/agent/ui/filesystem-panel").then(({ FilesystemPanel }) => ({
    default: FilesystemPanel,
  })),
);
const LazyGitDiffPanel = lazy(() =>
  import("@/features/agent/ui/git-diff-panel").then(({ GitDiffPanel }) => ({
    default: GitDiffPanel,
  })),
);

export function ComputerTabPanel({ workbench: state }: { workbench: WorkbenchState }) {
  const projects = useProjectsStore();
  const tools = useToolsStore();
  const focusedSession = selectFocusedSession(state);
  const activeProject = projects.resolveProject(focusedSession);
  const activeModelId = focusedSession?.modelId ?? state.selectedModel;
  const activeModel = state.models.find((model) => model.id === activeModelId) ?? null;
  const focusedCwd = focusedSession?.cwd ?? activeProject?.path ?? null;
  const resourceContext = {
    project: activeProject,
    session: focusedSession,
    modelId: activeModelId,
  };
  const panels: Record<ComputerTab, ReactNode> = {
    status: (
      <LazyComputerStatusPanel
        activeProject={activeProject}
        activeModel={activeModel}
        focusedSession={focusedSession}
        sessions={[...state.sessions.values()]}
        gitSummary={projects.gitSummary(activeProject?.path ?? focusedSession?.cwd)}
        onCompactSession={state.compactFocusedSession}
      />
    ),
    tools: (
      <ComputerLauncherPanel
        activeTab={tools.computer.tab}
        context={resourceContext}
        workbench={state}
      />
    ),
    "side-chat": (
      <SideChatTab
        activeModel={activeModel}
        activeModelId={activeModelId}
        activeProject={activeProject}
        focusedSession={focusedSession}
        models={state.models}
        modelsLoading={state.modelsLoading}
        sideChatSession={state.sideChatSession()}
        workbench={state}
      />
    ),
    browser: (
      <LazyAgentBrowser
        url={tools.browser.url}
        inputValue={tools.browser.input}
        onInputChange={tools.setBrowserInput}
        onNavigate={(value) => state.navigateBrowser(value, resourceContext)}
        onLocationChange={(next) => tools.setBrowserUrl(next, next)}
        onClose={() => tools.setComputerOpen(false)}
        visible={tools.computer.open}
      />
    ),
    files: (
      <section className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          <LazyFilesystemPanel cwd={focusedCwd} />
        </div>
      </section>
    ),
    diff: <LazyGitDiffPanel cwd={focusedCwd} />,
    terminal: null,
  };
  return <Suspense fallback={<ComputerTabFallback />}>{panels[tools.computer.tab]}</Suspense>;
}

function SideChatTab({
  workbench,
  activeModel,
  activeModelId,
  activeProject,
  focusedSession,
  models,
  modelsLoading,
  sideChatSession,
}: {
  workbench: WorkbenchState;
  activeModel: AgentModel | null;
  activeModelId: string;
  activeProject: Project | null;
  focusedSession: Session | null;
  models: AgentModel[];
  modelsLoading: boolean;
  sideChatSession: Session;
}) {
  const modelId = sideChatSession.modelId ?? focusedSession?.modelId ?? activeModelId;
  const cwd = sideChatSession.cwd ?? focusedSession?.cwd ?? activeProject?.path ?? "";
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <ChatPane
        paneId="computer-side-chat"
        modelId={modelId}
        models={models}
        modelFallback={activeModel}
        modelsLoading={modelsLoading}
        cwd={cwd}
        onSelectModel={(nextModelId) =>
          workbench.updateSession(sideChatSession.id, (session) => ({
            ...session,
            modelId: nextModelId,
          }))
        }
        isFocused
        onFocus={() => undefined}
        session={sideChatSession}
        onUpdateSession={workbench.updateSession}
        onRenameSession={(sessionId, title) =>
          workbench.updateSession(sessionId, (session) => ({ ...session, title }))
        }
        onClose={() => workbench.closeResource("side-chat")}
        insideComputerPanel
        showHeader={false}
      />
    </section>
  );
}

function ComputerTabFallback() {
  return (
    <section className="flex min-h-0 flex-1 items-center justify-center bg-(--color-panel) text-xs text-(--dim)">
      Loading...
    </section>
  );
}

function ComputerLauncherPanel({
  activeTab,
  context,
  workbench,
}: {
  activeTab: ComputerTab;
  context: Parameters<WorkbenchState["openResource"]>[1];
  workbench: WorkbenchState;
}) {
  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-(--color-panel) px-3 py-3">
      <div className="flex flex-col gap-1">
        {LAUNCHER_RESOURCES.map((resource) => {
          const Icon = resource.icon;
          const selected = resource.tab !== "side-chat" && activeTab === resource.tab;
          return (
            <button
              key={resource.tab}
              type="button"
              onClick={() => workbench.openResource(resource.tab, context)}
              className={`group flex min-h-0 items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                selected
                  ? "bg-(--color-surface-hover) text-(--fg)"
                  : "text-(--fg)/75 hover:bg-(--hover) hover:text-(--fg)"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0 text-(--dim)/75 transition-colors group-hover:text-(--fg)/80" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[length:var(--fs-lg)] font-medium">
                  {resource.label}
                </span>
                <span className="block truncate text-[length:var(--fs-sm)] text-(--dim)">
                  {resource.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
