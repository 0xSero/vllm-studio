"use client";

import { Suspense, lazy, useCallback, type ReactNode } from "react";
import { FolderTree, GitBranch, Globe2, MessageSquarePlus, TerminalSquare } from "lucide-react";
import { useTools } from "@/features/agent/tools/context";
import type { ComputerTab } from "@/features/agent/tools/types";
import { useProjects } from "@/features/agent/projects/context";
import type { Project } from "@/features/agent/projects/types";
import type { Session, UpdateSession } from "@/features/agent/runtime/types";
import { focusedSession as selectFocusedSession } from "@/features/agent/runtime/selectors";
import { useWorkspaceContext } from "@/features/agent/ui/use-workspace";
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

export type SideChatTabsUpdater = Session[] | ((tabs: Session[]) => Session[]);

type ComputerTabPanelProps = {
  onCloseSideChat: () => void;
  onNavigateBrowser: (value: string) => void;
  onOpenSideChat: () => void;
  onOpenTerminal: () => void;
  onRenameSideChat: (tabId: string, title: string) => void;
  onUpdateSideChatTabs: (nextTabsOrUpdater: SideChatTabsUpdater) => void;
  sideChatSession: Session;
};

export function ComputerTabPanel(props: ComputerTabPanelProps) {
  const { state, handles } = useWorkspaceContext();
  const projects = useProjects();
  const tools = useTools();
  const focusedSession = selectFocusedSession(state);
  const activeProject = projects.resolveProject(focusedSession) ?? projects.selectedProject;
  const activeModelId = focusedSession?.modelId ?? state.selectedModel;
  const activeModel = state.models.find((model) => model.id === activeModelId) ?? null;
  const focusedCwd = focusedSession?.cwd ?? activeProject?.path ?? null;
  const panels: Record<ComputerTab, ReactNode> = {
    status: (
      <LazyComputerStatusPanel
        activeProject={activeProject}
        activeModel={activeModel}
        focusedSession={focusedSession}
        sessions={[...state.sessions.values()]}
        gitSummary={projects.gitSummary(activeProject?.path ?? focusedSession?.cwd)}
        onCompactSession={handles.compactFocusedSession}
      />
    ),
    tools: (
      <ComputerLauncherPanel
        activeTab={tools.computer.tab}
        onOpenSideChat={props.onOpenSideChat}
        onOpenTerminal={props.onOpenTerminal}
        tools={tools}
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
        {...props}
      />
    ),
    browser: (
      <LazyAgentBrowser
        url={tools.browser.url}
        inputValue={tools.browser.input}
        onInputChange={tools.setBrowserInput}
        onNavigate={props.onNavigateBrowser}
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
  activeModel,
  activeModelId,
  activeProject,
  focusedSession,
  models,
  modelsLoading,
  onCloseSideChat,
  onRenameSideChat,
  onUpdateSideChatTabs,
  sideChatSession,
}: ComputerTabPanelProps & {
  activeModel: AgentModel | null;
  activeModelId: string;
  activeProject: Project | null;
  focusedSession: Session | null;
  models: AgentModel[];
  modelsLoading: boolean;
}) {
  const modelId = sideChatSession.modelId ?? focusedSession?.modelId ?? activeModelId;
  const cwd = sideChatSession.cwd ?? focusedSession?.cwd ?? activeProject?.path ?? "";
  const updateSession = useCallback<UpdateSession>(
    (sessionId, patch) =>
      onUpdateSideChatTabs((tabs) => tabs.map((tab) => (tab.id === sessionId ? patch(tab) : tab))),
    [onUpdateSideChatTabs],
  );
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
          onUpdateSideChatTabs((tabs) => tabs.map((tab) => ({ ...tab, modelId: nextModelId })))
        }
        isFocused
        onFocus={() => undefined}
        session={sideChatSession}
        onUpdateSession={updateSession}
        onRenameSession={onRenameSideChat}
        onClose={onCloseSideChat}
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
  onOpenSideChat,
  onOpenTerminal,
  tools,
}: {
  activeTab: ComputerTab;
  onOpenSideChat: () => void;
  onOpenTerminal: () => void;
  tools: ReturnType<typeof useTools>;
}) {
  const cards = [
    {
      key: "files",
      title: "Files",
      description: "Browse project files",
      icon: FolderTree,
      onClick: () => tools.setComputerTab("files"),
    },
    {
      key: "side-chat",
      title: "Side chat",
      description: "Start a side conversation",
      icon: MessageSquarePlus,
      onClick: () => onOpenSideChat(),
    },
    {
      key: "browser",
      title: "Browser",
      description: "Open a website",
      icon: Globe2,
      onClick: () => tools.setComputerTab("browser"),
    },
    {
      key: "diff",
      title: "Review",
      description: "Diff, commit, push, and PR",
      icon: GitBranch,
      onClick: () => tools.setComputerTab("diff"),
    },
    {
      key: "terminal",
      title: "Terminal",
      description: "Start an interactive shell",
      icon: TerminalSquare,
      onClick: onOpenTerminal,
    },
  ] as const;
  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-(--color-panel) px-3 py-3">
      <div className="flex flex-col gap-1">
        {cards.map((card) => {
          const Icon = "icon" in card ? card.icon : null;
          const selected = card.key !== "side-chat" && activeTab === card.key;
          return (
            <button
              key={card.key}
              type="button"
              onClick={card.onClick}
              className={`group flex min-h-0 items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                selected
                  ? "bg-(--color-surface-hover) text-(--fg)"
                  : "text-(--fg)/75 hover:bg-(--hover) hover:text-(--fg)"
              }`}
            >
              {Icon ? (
                <Icon className="h-4 w-4 shrink-0 text-(--dim)/75 transition-colors group-hover:text-(--fg)/80" />
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[length:var(--fs-lg)] font-medium">
                  {card.title}
                </span>
                <span className="block truncate text-[length:var(--fs-sm)] text-(--dim)">
                  {card.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
