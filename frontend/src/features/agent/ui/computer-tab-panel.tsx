"use client";

import { Suspense, lazy, useCallback, type ReactNode } from "react";
import type { ToolsContextValue } from "@/features/agent/tools/context";
import type { ComputerTab } from "@/features/agent/tools/types";
import type { Project } from "@/features/agent/projects/types";
import type { AgentHarness, Session, UpdateSession } from "@/features/agent/runtime/types";
import type { AgentModel } from "@/features/agent/workspace/types";
import { AgentModelPicker } from "@/features/agent/ui/agent-model-picker";
import { ChatPane } from "@/features/agent/ui/chat-pane";

const LazyAgentBrowser = lazy(() =>
  import("@/features/agent/ui/agent-browser").then(({ AgentBrowser }) => ({
    default: AgentBrowser,
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

const NON_TERMINAL_TABS: Exclude<ComputerTab, "terminal">[] = [
  "side-chat",
  "browser",
  "files",
  "diff",
];
const visitedComputerTabs = new Set<Exclude<ComputerTab, "terminal">>();

type ComputerTabPanelProps = {
  activeModel: AgentModel | null;
  activeModelId: string;
  activeProject: Project | null;
  focusedSession: Session | null;
  models: AgentModel[];
  modelsLoading: boolean;
  onCloseSideChat: () => void;
  onNavigateBrowser: (value: string) => void;
  onRenameSideChat: (tabId: string, title: string) => void;
  onUpdateSideChatTabs: (nextTabsOrUpdater: SideChatTabsUpdater) => void;
  sessions: Session[];
  sideChatSession: Session;
  tools: ToolsContextValue;
  workspaceToolsEnabled: boolean;
};

export function ComputerTabPanel(props: ComputerTabPanelProps) {
  const focusedCwd = props.focusedSession?.cwd ?? props.activeProject?.path ?? null;
  const activeTab =
    !props.workspaceToolsEnabled && ["files", "diff", "terminal"].includes(props.tools.computer.tab)
      ? "side-chat"
      : props.tools.computer.tab;
  if (activeTab !== "terminal") visitedComputerTabs.add(activeTab);
  const panels: Record<ComputerTab, ReactNode> = {
    "side-chat": <SideChatTab {...props} />,
    browser: <BrowserTab {...props} />,
    files: <FilesTab cwd={focusedCwd} />,
    diff: <LazyGitDiffPanel cwd={focusedCwd} />,
    terminal: null,
  };
  return (
    <Suspense fallback={<ComputerTabFallback />}>
      <div
        aria-hidden={activeTab === "terminal"}
        className={activeTab === "terminal" ? "hidden" : "relative flex min-h-0 flex-1 flex-col"}
      >
        {NON_TERMINAL_TABS.map((tab) =>
          visitedComputerTabs.has(tab) ? (
            <div
              key={tab}
              aria-hidden={activeTab !== tab}
              className={activeTab === tab ? "flex min-h-0 flex-1 flex-col" : "hidden"}
            >
              {panels[tab]}
            </div>
          ) : null,
        )}
      </div>
    </Suspense>
  );
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
  tools,
}: ComputerTabPanelProps) {
  const modelId = sideChatSession.modelId ?? focusedSession?.modelId ?? activeModelId;
  const selectedModel = models.find((model) => model.id === modelId) ?? activeModel;
  const modelRouteId =
    sideChatSession.modelRouteId ??
    focusedSession?.modelRouteId ??
    selectedModel?.defaultRouteId ??
    selectedModel?.routes[0]?.id ??
    "";
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
        modelRouteId={modelRouteId}
        modelName={selectedModel?.name ?? modelId}
        modelSupportsVision={selectedModel?.vision ?? false}
        modelThinkingLevels={selectedModel?.thinkingLevels ?? ["off"]}
        modelsLoading={modelsLoading}
        contextWindow={selectedModel?.contextWindow ?? 0}
        cwd={cwd}
        projectId={activeProject?.id ?? null}
        projectName={activeProject?.name ?? null}
        modelSelector={(reasoning) => (
          <AgentModelPicker
            models={models}
            selectedModel={modelId}
            selectedRoute={modelRouteId}
            onSelect={(nextModelId, nextRouteId) =>
              onUpdateSideChatTabs((tabs) =>
                tabs.map((tab) => ({
                  ...tab,
                  modelId: nextModelId,
                  modelRouteId: nextRouteId,
                })),
              )
            }
            selectedHarness={sideChatSession.harness ?? focusedSession?.harness ?? "pi"}
            harnessDisabled={Boolean(
              sideChatSession.piSessionId || sideChatSession.messages.length,
            )}
            onSelectHarness={(harness) =>
              updateSession(sideChatSession.id, (session) => ({
                ...session,
                harness: harness as AgentHarness,
              }))
            }
            loading={modelsLoading}
            {...reasoning}
          />
        )}
        browserToolEnabled={tools.browser.enabled}
        browserBackend={tools.browser.backend}
        onToggleBrowserBackend={tools.toggleBrowserBackend}
        onToggleBrowserTool={tools.toggleBrowser}
        isFocused
        onFocus={() => undefined}
        tabs={[sideChatSession]}
        activeTabId={sideChatSession.id}
        onUpdateSession={updateSession}
        onRenameSession={onRenameSideChat}
        onClose={onCloseSideChat}
        rightPanelOpen
        onToggleRightPanel={() => tools.setComputerOpen(false)}
        showHeader={false}
      />
    </section>
  );
}

function BrowserTab({ onNavigateBrowser, tools }: ComputerTabPanelProps) {
  return (
    <LazyAgentBrowser
      url={tools.browser.url}
      inputValue={tools.browser.input}
      onInputChange={tools.setBrowserInput}
      onNavigate={onNavigateBrowser}
      onLocationChange={(next) => tools.setBrowserUrl(next, next)}
      onClose={() => tools.setComputerOpen(false)}
      visible={tools.computer.open && tools.computer.tab === "browser"}
    />
  );
}

function FilesTab({ cwd }: { cwd: string | null }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1">
        <LazyFilesystemPanel cwd={cwd} />
      </div>
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
