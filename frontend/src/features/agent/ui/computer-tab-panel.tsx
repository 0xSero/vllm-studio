"use client";

import type { ReactNode } from "react";
import { FolderTree, GitBranch, Globe2, MessageSquarePlus, TerminalSquare } from "lucide-react";
import type { ToolsContextValue } from "@/features/agent/tools/context";
import type { ComputerTab } from "@/features/agent/tools/types";
import type { Project, GitSummary } from "@/features/agent/projects/types";
import type { Session } from "@/features/agent/runtime/types";
import type { AgentModel } from "@/features/agent/workspace/types";
import { AgentBrowser, type AgentBrowserHandle } from "@/features/agent/ui/agent-browser";
import { CanvasPanel } from "@/features/agent/ui/canvas-panel";
import { ChatPane } from "@/features/agent/ui/chat-pane";
import { ComputerStatusPanel } from "@/features/agent/ui/computer-status-panel";
import { FilesystemPanel } from "@/features/agent/ui/filesystem-panel";
import { GitDiffPanel } from "@/features/agent/ui/git-diff-panel";

export type SideChatTabsUpdater = Session[] | ((tabs: Session[]) => Session[]);

type ComputerTabPanelProps = {
  activeModel: AgentModel | null;
  activeModelId: string;
  activeProject: Project | null;
  focusedSession: Session | null;
  gitSummary?: GitSummary | null;
  isElectron: boolean;
  onCloseSideChat: () => void;
  onCompactSession?: () => Promise<void>;
  onNavigateBrowser: (value: string) => void;
  onOpenSideChat: () => void;
  onOpenTerminal: () => void;
  onRenameSideChat: (tabId: string, title: string) => void;
  onUpdateSideChatTabs: (nextTabsOrUpdater: SideChatTabsUpdater) => void;
  registerBrowserHandle: (handle: AgentBrowserHandle | null) => void;
  sessions: Session[];
  sideChatSession: Session;
  tools: ToolsContextValue;
};

export function ComputerTabPanel(props: ComputerTabPanelProps) {
  const panels: Record<ComputerTab, ReactNode> = {
    status: <StatusTab {...props} />,
    tools: <ComputerLauncherPanel activeTab={props.tools.computer.tab} {...props} />,
    canvas: <CanvasPanel />,
    "side-chat": <SideChatTab {...props} />,
    browser: <BrowserTab {...props} />,
    files: <FilesTab cwd={props.activeProject?.path ?? null} />,
    diff: <GitDiffPanel cwd={props.activeProject?.path ?? null} />,
    terminal: null,
  };
  return panels[props.tools.computer.tab] ?? null;
}

function StatusTab({
  activeModel,
  activeProject,
  focusedSession,
  gitSummary,
  onCompactSession,
  sessions,
}: ComputerTabPanelProps) {
  return (
    <ComputerStatusPanel
      activeProject={activeProject}
      activeModel={activeModel}
      focusedSession={focusedSession}
      sessions={sessions}
      gitSummary={gitSummary}
      onCompactSession={onCompactSession}
    />
  );
}

function SideChatTab({
  activeModel,
  activeModelId,
  activeProject,
  focusedSession,
  onCloseSideChat,
  onRenameSideChat,
  onUpdateSideChatTabs,
  sideChatSession,
  tools,
}: ComputerTabPanelProps) {
  const modelId = sideChatSession.modelId ?? focusedSession?.modelId ?? activeModelId;
  const cwd = sideChatSession.cwd ?? activeProject?.path ?? focusedSession?.cwd ?? "";
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <ChatPane
        paneId="computer-side-chat"
        runtimeSessionId={sideChatSession.runtimeSessionId}
        modelId={modelId}
        modelName={activeModel?.name ?? modelId}
        modelSupportsVision={activeModel?.vision ?? false}
        modelsLoading={false}
        contextWindow={activeModel?.contextWindow ?? 0}
        cwd={cwd}
        projectName={activeProject?.name ?? null}
        browserToolEnabled={false}
        browserBackend={tools.browser.backend}
        onToggleBrowserBackend={tools.toggleBrowserBackend}
        onToggleBrowserTool={() => tools.setComputerTab("browser")}
        canvasEnabled={false}
        onToggleCanvas={tools.toggleCanvas}
        isFocused
        onFocus={() => undefined}
        tabs={[sideChatSession]}
        activeTabId={sideChatSession.id}
        onTabsChange={onUpdateSideChatTabs}
        onRenameSession={onRenameSideChat}
        onClose={onCloseSideChat}
        rightPanelOpen
        onToggleRightPanel={() => tools.setComputerOpen(false)}
        showHeader={false}
      />
    </section>
  );
}

function BrowserTab({
  isElectron,
  onNavigateBrowser,
  registerBrowserHandle,
  tools,
}: ComputerTabPanelProps) {
  return (
    <AgentBrowser
      ref={registerBrowserHandle}
      url={tools.browser.url}
      inputValue={tools.browser.input}
      onInputChange={tools.setBrowserInput}
      onNavigate={onNavigateBrowser}
      onLocationChange={(next) => tools.setBrowserUrl(next, next)}
      onClose={() => tools.setComputerOpen(false)}
      isElectron={isElectron}
    />
  );
}

function FilesTab({ cwd }: { cwd: string | null }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1">
        <FilesystemPanel cwd={cwd} />
      </div>
    </section>
  );
}

function ComputerLauncherPanel({
  activeTab,
  onOpenSideChat,
  onOpenTerminal,
  tools,
}: ComputerTabPanelProps & { activeTab: ComputerTab }) {
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
      onClick: onOpenSideChat,
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
      description: "View code changes",
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
    <section className="min-h-0 flex-1 overflow-y-auto bg-(--agent-bg) px-5 py-7">
      <div className="mx-auto flex max-w-[30rem] flex-col gap-3">
        {cards.map((card) => {
          const Icon = card.icon;
          const selected = card.key !== "side-chat" && activeTab === card.key;
          return (
            <button
              key={card.key}
              type="button"
              onClick={card.onClick}
              className={`group flex min-h-24 flex-col items-center justify-center rounded-xl border px-5 py-5 text-center transition-colors ${
                selected
                  ? "border-(--border) bg-(--surface) text-(--fg)/80"
                  : "border-transparent bg-black/20 text-(--fg)/75 hover:border-(--border) hover:bg-(--surface)/70"
              }`}
            >
              <Icon className="mb-3 h-5 w-5 text-(--dim)/70 transition-colors group-hover:text-(--fg)/75" />
              <span className="text-[length:var(--fs-lg)] font-semibold tracking-tight">
                {card.title}
              </span>
              <span className="mt-1.5 text-[length:var(--fs-base)] text-(--dim)">
                {card.description}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
