"use client";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { AgentChatPaneHeader } from "@/features/agent/ui/agent-chat-pane-header";
import { AgentComposerFrame } from "@/features/agent/ui/agent-composer-frame";
import { type FileMentionRow, type MentionRow } from "@/features/agent/ui/agent-composer-context";
import { builtinCommandProvider } from "@/features/agent/composer/builtin-commands";
import { ComposerProjectDrawer } from "@/features/agent/ui/composer-project-drawer";
import { SubagentChips } from "@/features/agent/ui/subagent-chips";
import { GitDiffDrawer } from "@/features/agent/ui/git-diff-drawer";
import {
  promptTemplateCommandProvider,
  skillCommandProvider,
} from "@/features/agent/composer/catalogue-commands";
import {
  createComposerCommandRegistry,
  parseSlashInvocation,
  type SlashInvocation,
} from "@/features/agent/composer/command-registry";
import { deriveComposerVisual } from "@/features/agent/composer/composer-visual-state";

function diffDrawerFor(
  open: boolean,
  props: {
    cwd: string | null;
    gitBranch?: string | null;
    gitSummary?: GitSummary | null;
    onClose: () => void;
  },
) {
  if (!open) return null;
  return <GitDiffDrawer {...props} />;
}

function piSessionIdOf(tab: { piSessionId?: string | null } | null | undefined): string | null {
  return tab?.piSessionId ?? null;
}

function subagentChipsFor(piSessionId: string | null | undefined) {
  if (!piSessionId) return null;
  return <SubagentChips piSessionId={piSessionId} />;
}

import {
  useComposerLoadedContext,
  useComposerMentionRows,
  useComposerTextareaBehavior,
  useComposerTextareaHeightSync,
  type UpdateTab,
} from "@/features/agent/ui/chat-pane-composer";
import { useComposerAttachments } from "@/features/agent/ui/chat-pane-composer-attachments";
import {
  applyContextRow,
  useComposerMentionSelection,
} from "@/features/agent/ui/chat-pane-composer-mention-selection";
import {
  consumeComposerMention,
  type ComposerMention,
  type ComposerPromptTemplateRef,
  type ComposerSkillRef,
} from "@/features/agent/composer-context";
import {
  useChatPaneContextAttachEffect,
  useChatPaneDerivedState,
  useChatPaneMentionEffects,
  useChatPaneRuntimeHandle,
} from "@/features/agent/ui/chat-pane-hooks";
import { useChatPaneSessionTitle } from "@/features/agent/ui/chat-pane-session-title";
import { canRunGoalCommand, useGoalCommand } from "@/features/agent/ui/use-goal-command";
import { useGoalMode } from "@/features/agent/ui/use-goal-mode";
import { useChatPaneComposerActions } from "@/features/agent/ui/use-chat-pane-composer-actions";
import { useComposerCommandHandlers } from "@/features/agent/ui/use-composer-command-handlers";
import { useChatPaneSendFlow } from "@/features/agent/ui/chat-pane-send-flow";
import { ChatPaneHandle, SessionTab } from "@/features/agent/messages";
import { useSessionEngine } from "@/features/agent/runtime/engine";
import type { UpdateSession } from "@/features/agent/runtime/types";
import { useTools } from "@/features/agent/tools/context";
import { useProjects } from "@/features/agent/projects/context";
import type { GitSummary, Project } from "@/features/agent/projects/types";
import type { AgentThinkingLevel } from "@/features/agent/contracts";
import {
  loadThinkingLevelDefault,
  pickThinkingLevel,
  setThinkingLevelDefault,
} from "@/features/agent/messages/thinking-level-pref";
import {
  exportFilenameFromTitle,
  sessionToMarkdown,
} from "@/features/agent/messages/export-markdown";
import {
  OPEN_TERMINAL_EVENT,
  type OpenTerminalEventDetail,
  type TerminalOwner,
} from "@/features/agent/terminal-owners";
import {
  rememberPersistentTerminalOwner,
  selectPersistentTerminalOwner,
  usePersistentTerminalOwners,
  type TerminalOwnersSnapshot,
} from "@/features/agent/ui/use-persistent-terminal-owners";
import { PersistentTerminals } from "@/features/agent/ui/persistent-terminals";
import { cx } from "@/ui/utils";
import { ExtensionUiDialog } from "@/features/agent/ui/extension-ui-dialog";
import {
  clearSessionGoal,
  respondExtensionUi,
  updateSessionGoal,
} from "@/features/agent/runtime/api";
export type { ChatPaneHandle, SessionTab };

const Timeline = dynamic(
  () => import("@/features/agent/ui/timeline/timeline").then((mod) => mod.Timeline),
  { ssr: false, loading: () => <TimelineFallback /> },
);

function downloadTextFile(filename: string, content: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function EmptyPromptTimeline() {
  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto bg-(--agent-bg) px-6 pb-10 pt-2">
      <div className="agent-thread-shell mx-auto flex flex-1">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <p className="max-w-[24ch] text-[clamp(1.45rem,2.6vw,2.1rem)] font-semibold leading-[1.22] tracking-[-0.02em] text-(--fg)/90">
            A dream is something you build for yourself.
          </p>
          <p className="text-[length:var(--fs-xl)] text-(--dim)">Just talk to it.</p>
        </div>
      </div>
    </div>
  );
}

function TimelineFallback() {
  return <div className="flex min-h-0 flex-1 bg-(--agent-bg)" />;
}

function chatPaneClassName(composerOnly: boolean): string {
  return cx(
    "relative flex min-h-0 min-w-0 flex-1 flex-col",
    composerOnly
      ? "bg-transparent"
      : "bg-(--agent-bg) shadow-[inset_1px_0_rgba(255,255,255,0.015)]",
  );
}

function ChatTranscript({
  composerOnly,
  terminalView,
  showEmptyPrompt,
  activeTab,
  stickToBottom,
  setStickToBottom,
  running,
  onForkSession,
  loadEarlierHistory,
}: {
  composerOnly: boolean;
  terminalView: boolean;
  showEmptyPrompt: boolean;
  activeTab: SessionTab | undefined;
  stickToBottom: boolean;
  setStickToBottom: (value: boolean) => void;
  running: boolean;
  onForkSession?: () => void;
  loadEarlierHistory: () => Promise<void>;
}) {
  const viewKey = activeTab?.piSessionId ?? activeTab?.id ?? null;
  const viewAlias = activeTab?.piSessionId ? activeTab.id : null;
  if (composerOnly) return null;
  return (
    <div className={terminalView ? "hidden" : "flex min-h-0 min-w-0 flex-1"}>
      {showEmptyPrompt ? (
        <EmptyPromptTimeline />
      ) : (
        <Timeline
          key={activeTab?.id ?? "empty"}
          stickToBottom={stickToBottom}
          onStickToBottomChange={setStickToBottom}
          messages={activeTab?.messages ?? []}
          running={running}
          viewKey={viewKey}
          viewAlias={viewAlias}
          onForkSession={onForkSession}
          hasEarlier={activeTab?.historyCursor != null}
          onLoadEarlier={loadEarlierHistory}
        />
      )}
    </div>
  );
}

type Props = {
  paneId: string;
  modelId: string;
  modelName: string | null;
  modelSupportsVision: boolean;
  modelThinkingLevels: readonly AgentThinkingLevel[];
  modelsLoading: boolean;
  contextWindow: number;
  cwd: string;
  modelSelector?: (props: ComposerModelSelectorProps) => ReactNode;
  onInitGit?: () => void;
  isFocused: boolean;
  onFocus: () => void;
  onPiSessionIdChange?: (sessionId: string) => void;
  tabs: SessionTab[];
  activeTabId: string;
  onUpdateSession: UpdateSession;
  onRenameSession: (tabId: string, title: string) => void;
  onClose?: () => void;
  onForkSession?: () => void;
  terminalOwner?: TerminalOwner | null;
  insideComputerPanel?: boolean;
  onRegisterHandle?: (handle: ChatPaneHandle | null) => void;
  showHeader?: boolean;
  composerOnly?: boolean;
};

export type ComposerModelSelectorProps = {
  reasoningLevel: AgentThinkingLevel;
  reasoningLevels: readonly AgentThinkingLevel[];
  reasoningDisabled: boolean;
  onSelectReasoning: (level: AgentThinkingLevel) => void;
};

function renderComposerModelSelector(
  renderer: Props["modelSelector"],
  props: ComposerModelSelectorProps,
): ReactNode {
  return renderer ? renderer(props) : null;
}
export function ChatPane({
  paneId,
  modelId,
  modelName,
  modelSupportsVision,
  modelThinkingLevels,
  modelsLoading,
  contextWindow,
  cwd,
  modelSelector,
  onInitGit,
  isFocused,
  onFocus,
  onPiSessionIdChange,
  tabs,
  activeTabId,
  onUpdateSession,
  onRenameSession,
  onClose,
  onForkSession,
  terminalOwner = null,
  insideComputerPanel = false,
  onRegisterHandle,
  showHeader = true,
  composerOnly = false,
}: Props) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastAppliedComposerHeightRef = useRef(0);
  const lastComposerValueLengthRef = useRef(0);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [mention, setMention] = useState<ComposerMention | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [fileMentionRows, setFileMentionRows] = useState<FileMentionRow[]>([]);
  const tools = useTools();
  const projects = useProjects();
  const browserToolEnabled = tools.browser.enabled;
  const browserBackend = tools.browser.backend;
  const onToggleBrowserTool = useCallback(() => {
    if (insideComputerPanel) return tools.toggleBrowser();
    if (tools.browser.enabled) {
      tools.setBrowserEnabled(false);
      tools.closeComputerTab("browser");
      return;
    }
    tools.setBrowserEnabled(true);
    tools.setComputerTab("browser");
  }, [insideComputerPanel, tools]);
  const rightPanelOpen = insideComputerPanel || tools.computer.open;
  const onToggleRightPanel = insideComputerPanel
    ? () => tools.setComputerOpen(false)
    : tools.toggleComputerOpen;
  const {
    activeTab,
    currentContextTokens,
    effectiveContextWindow,
    running,
    showEmptyPrompt,
    visibleQueueItems,
  } = useChatPaneDerivedState({ activeTabId, contextWindow, tabs });
  const project = projects.resolveProject(activeTab);
  const projectName = project?.name ?? null;
  const gitSummary = projects.gitSummary(project?.path);
  const gitBranch = gitSummary?.isRepo === false ? null : (gitSummary?.branch ?? project?.branch);
  const [terminalView, setTerminalView] = useState(false);
  const terminalSnapshot = usePersistentTerminalOwners(
    terminalView,
    terminalView ? terminalOwner : null,
  );
  const toggleTerminalView = useCallback(() => {
    setTerminalView((open) => {
      const next = !open;
      if (next && terminalOwner) rememberPersistentTerminalOwner(terminalOwner, { select: true });
      return next;
    });
  }, [terminalOwner]);
  useMountSubscription(() => {
    if (!isFocused) return;
    const onOpenTerminalEvent = (event: Event) => {
      const detail = (event as CustomEvent<OpenTerminalEventDetail>).detail;
      if (!detail?.mountKey) return;
      selectPersistentTerminalOwner(detail.mountKey);
      setTerminalView(true);
    };
    window.addEventListener(OPEN_TERMINAL_EVENT, onOpenTerminalEvent);
    return () => window.removeEventListener(OPEN_TERMINAL_EVENT, onOpenTerminalEvent);
  }, [isFocused]);
  const updateTab = onUpdateSession;
  const {
    attachments,
    setAttachments,
    readingAttachments,
    composerDragActive,
    attachFiles,
    removeAttachment,
    clearAttachments,
    handleComposerDragOver,
    handleComposerDragLeave,
    handleComposerDrop,
  } = useComposerAttachments({
    activeTab,
    running: Boolean(running),
    updateTab,
    fileInputRef,
  });
  useChatPaneContextAttachEffect({
    contextAttachRequest: tools.contextAttachRequest,
    isFocused,
    setAttachments,
  });
  useChatPaneMentionEffects({
    cwd,
    mention,
    setFileMentionRows,
    setMentionIndex,
  });
  const {
    displayedSessionTitle,
    sessionPinned,
    togglePinnedSession,
    handlePiSessionIdChange,
    renameActiveSession,
  } = useChatPaneSessionTitle({
    activeTab,
    activeTabId,
    paneId,
    running: Boolean(running),
    onPiSessionIdChange,
    onRenameSession,
  });
  const selectMentionRow = useComposerMentionSelection({
    activeTab,
    mention,
    cwd,
    tools,
    updateTab,
    setAttachments,
    setMention,
    textareaRef,
  });
  const composerInput = activeTab?.input ?? "";
  const resetComposerHeight = useCallback(() => {
    if (textareaRef.current) textareaRef.current.style.height = "";
    lastAppliedComposerHeightRef.current = 0;
    lastComposerValueLengthRef.current = 0;
  }, []);
  useComposerTextareaHeightSync({
    value: composerInput,
    textareaRef,
    lastAppliedComposerHeightRef,
    lastComposerValueLengthRef,
  });
  const { selectedSkills, selectedPromptTemplates, removeLoadedContext } = useComposerLoadedContext(
    { activeTab, tools },
  );
  const thinkingLevel = pickThinkingLevel(
    modelThinkingLevels,
    activeTab?.thinkingLevel,
    loadThinkingLevelDefault(),
  );
  const selectThinkingLevel = useCallback(
    (level: AgentThinkingLevel) => {
      if (!activeTab || running) return;
      updateTab(activeTab.id, (session) => ({ ...session, thinkingLevel: level }));
      setThinkingLevelDefault(level);
    },
    [activeTab, running, updateTab],
  );
  const composerModelSelector = renderComposerModelSelector(modelSelector, {
    reasoningLevel: thinkingLevel,
    reasoningLevels: modelThinkingLevels,
    reasoningDisabled: Boolean(running),
    onSelectReasoning: selectThinkingLevel,
  });

  const engine = useSessionEngine({
    tabs,
    activeTabId,
    modelId,
    thinkingLevel,
    toolAccess: "full",
    cwd,
    browserToolEnabled,
    browserBackend,
    onPiSessionIdChange: handlePiSessionIdChange,
    updateSession: updateTab,
    selectionFor: tools.selectionFor,
  });
  const { compacting, compactSession } = useChatPaneRuntimeHandle({
    activeTab,
    activeTabId,
    engine,
    modelId,
    isFocused,
    onRegisterHandle,
    running: Boolean(running),
  });
  const openComputerStatus = useCallback(() => {
    tools.setComputerTab("status");
    tools.setComputerOpen(true);
  }, [tools]);
  const [diffDrawerOpen, setDiffDrawerOpen] = useState(false);
  const openDiffDrawer = useCallback(() => setDiffDrawerOpen(true), []);
  const closeDiffDrawer = useCallback(() => setDiffDrawerOpen(false), []);
  const exportSession = useCallback(() => {
    if (!activeTab) return;
    const markdown = sessionToMarkdown(activeTab.messages, displayedSessionTitle);
    downloadTextFile(exportFilenameFromTitle(displayedSessionTitle), markdown);
  }, [activeTab, displayedSessionTitle]);
  const canExport = Boolean(
    activeTab?.messages.some((message) => message.role !== "system" && message.text.trim()),
  );
  const openTerminalAction = terminalOwner
    ? toggleTerminalView
    : insideComputerPanel
      ? undefined
      : () => tools.setComputerTab("terminal");
  const applyTemplate = useCallback(
    (row: ComposerPromptTemplateRef) =>
      activeTab ? applyContextRow(activeTab.id, "promptTemplate", row, tools) : Promise.resolve(),
    [activeTab, tools],
  );
  const applySkill = useCallback(
    (row: ComposerSkillRef) =>
      activeTab ? applyContextRow(activeTab.id, "skill", row, tools) : Promise.resolve(),
    [activeTab, tools],
  );
  const activePiSessionId = piSessionIdOf(activeTab);
  const { goalRevision, goalAction } = useGoalCommand(activePiSessionId);
  const [goalModeOn, setGoalModeOn] = useState(false);
  const handleProjectPicked = useCallback(
    (project: Project) => {
      if (!activeTab || activeTab.messages.length > 0) return;
      updateTab(activeTab.id, (session) => ({
        ...session,
        projectId: project.id,
        cwd: project.path,
      }));
    },
    [activeTab, updateTab],
  );
  const commandRegistry = useMemo(
    () =>
      createComposerCommandRegistry([
        builtinCommandProvider({
          compact: () => void compactSession(),
          openStatus: openComputerStatus,
          toggleBrowserTool: onToggleBrowserTool,
          openPlugins: () => router.push("/integrations"),
          ...(openTerminalAction ? { openTerminal: openTerminalAction } : {}),
          ...(onForkSession ? { forkSession: onForkSession } : {}),
          ...(canExport ? { exportSession } : {}),
          goal: goalAction,
          enterGoalMode: () => setGoalModeOn(true),
        }),
        promptTemplateCommandProvider({
          templates: tools.promptTemplateCatalogue,
          applyTemplate,
        }),
        skillCommandProvider({ skills: tools.skillCatalogue, applySkill }),
      ]),
    [
      applySkill,
      applyTemplate,
      canExport,
      compactSession,
      goalAction,
      exportSession,
      onForkSession,
      onToggleBrowserTool,
      openComputerStatus,
      openTerminalAction,
      router,
      tools.promptTemplateCatalogue,
      tools.skillCatalogue,
    ],
  );
  const commandContext = useMemo(
    () => ({ running: Boolean(running), compacting }),
    [running, compacting],
  );
  const commandMatches = useMemo(
    () => (mention?.kind === "command" ? commandRegistry.match(mention.query, commandContext) : []),
    [commandContext, commandRegistry, mention],
  );
  const mentionRows = useComposerMentionRows({
    commandRows: commandMatches,
    fileMentionRows,
    mention,
    skillRows: tools.skillCatalogue,
  });
  const { runCommandInvocation, handleSelectMention } = useComposerCommandHandlers({
    activeTab,
    commandRegistry,
    commandContext,
    mention,
    setMention,
    resetComposerHeight,
    textareaRef,
    updateTab,
    selectMentionRow,
  });
  const { sendMessage, queueMessage, removeQueued, editQueued, steerQueued, abortTurn } =
    useChatPaneSendFlow({
      activeTab,
      attachments,
      browserToolEnabled,
      clearAttachments,
      cwd,
      engine,
      modelId,
      modelSupportsVision,
      readingAttachments,
      resetComposerHeight,
      running: Boolean(running),
      setMention,
      setStickToBottom,
      tools,
      updateTab,
    });
  const { handleComposerPaste, handleComposerChange, handleComposerKeyDown } =
    useComposerTextareaBehavior({
      activeTab,
      mention,
      mentionRows,
      mentionIndex,
      running: Boolean(running),
      textareaRef,
      lastAppliedComposerHeightRef,
      lastComposerValueLengthRef,
      resetComposerHeight,
      updateTab,
      setMention,
      setMentionIndex,
      selectMentionRow: handleSelectMention,
      queueMessage,
      abortTurn,
      attachFiles,
    });
  const goalModeApi = useGoalMode({
    goalAction,
    sendMessage,
    goalMode: goalModeOn,
    setGoalMode: setGoalModeOn,
  });
  const handleComposerSubmit = useCallback(
    (event: FormEvent) => {
      if (goalModeApi.submitAsGoal(event, activeTab?.input ?? "")) return;
      const invocation = parseSlashInvocation(activeTab?.input ?? "");
      const commandCanRun = invocation?.name !== "goal" || canRunGoalCommand(activePiSessionId);
      if (invocation && commandCanRun && commandRegistry.find(invocation.name, commandContext)) {
        event.preventDefault();
        void runCommandInvocation(invocation);
        return;
      }
      void sendMessage(event);
    },
    [
      activeTab,
      activePiSessionId,
      commandContext,
      commandRegistry,
      goalModeApi,
      runCommandInvocation,
      sendMessage,
    ],
  );
  const loadEarlierHistory = useCallback(
    () => (activeTabId ? engine.loadEarlier(activeTabId) : Promise.resolve()),
    [activeTabId, engine],
  );
  const { handleTranscript, handleExtensionUiResponse } = useChatPaneComposerActions({
    activeTab,
    updateTab,
    textareaRef,
  });
  const composerVisual = deriveComposerVisual({
    compacting,
    hasMessages: (activeTab?.messages.length ?? 0) > 0,
  });
  return (
    <section
      onMouseDownCapture={onFocus}
      data-pane-id={paneId}
      className={chatPaneClassName(composerOnly)}
    >
      <ChatPaneChrome
        extensionUiRequest={activeTab?.extensionUiRequest}
        onExtensionUiRespond={handleExtensionUiResponse}
        showHeader={showHeader}
        terminalView={terminalView}
        terminalSnapshot={terminalSnapshot}
        header={{
          title: displayedSessionTitle,
          pinned: sessionPinned,
          rightPanelOpen,
          canFork: Boolean(onForkSession),
          canClose: Boolean(onClose),
          canExport,
          onTogglePinned: togglePinnedSession,
          onRename: renameActiveSession,
          onFork: onForkSession,
          onOpenTerminal: openTerminalAction,
          terminalOpen: terminalView,
          onExport: exportSession,
          onClose,
          onToggleRightPanel,
        }}
      />
      <ChatTranscript
        composerOnly={composerOnly}
        terminalView={terminalView}
        showEmptyPrompt={showEmptyPrompt}
        activeTab={activeTab}
        stickToBottom={stickToBottom}
        setStickToBottom={setStickToBottom}
        running={Boolean(running)}
        onForkSession={onForkSession}
        loadEarlierHistory={loadEarlierHistory}
      />
      <div className={terminalView ? "hidden" : "contents"}>
        {diffDrawerFor(diffDrawerOpen, {
          cwd: cwd || null,
          gitBranch,
          gitSummary,
          onClose: closeDiffDrawer,
        })}
        {subagentChipsFor(activePiSessionId)}
        <AgentComposerFrame
          actions={{
            fileInputRef,
            onAttachFiles: (files) => void attachFiles(files),
            readingAttachments,
            running: Boolean(running),
            status: activeTab?.status,
            input: composerInput,
            attachmentsCount: attachments.length,
            onToggleBrowserTool,
            onAbortTurn: () => void abortTurn(),
            onTranscript: handleTranscript,
            modelSelector: composerModelSelector,
          }}
          attachments={{
            attachments,
            modelSupportsVision,
            onRemove: removeAttachment,
          }}
          banner={composerVisual.banner}
          context={{
            skills: selectedSkills,
            promptTemplates: selectedPromptTemplates,
            onRemove: removeLoadedContext,
          }}
          drag={{
            active: composerDragActive,
            onLeave: handleComposerDragLeave,
            onOver: handleComposerDragOver,
            onDrop: handleComposerDrop,
          }}
          goal={goalModeApi.goalMode ? { onExit: goalModeApi.exitGoalMode } : undefined}
          mention={{
            mention,
            rows: mentionRows,
            activeIndex: mentionIndex,
            onSelect: (entry) => void handleSelectMention(entry),
          }}
          onSubmit={handleComposerSubmit}
          drawer={
            <SessionProjectDrawer
              tabId={activeTabId}
              piSessionId={activePiSessionId}
              revision={goalRevision}
              projectName={projectName}
              cwd={cwd}
              gitBranch={gitBranch}
              gitSummary={gitSummary}
              onInitGit={onInitGit}
              onOpenDiff={openDiffDrawer}
              showProjectRow={composerVisual.showProjectRow}
              running={Boolean(running)}
              onProjectPicked={handleProjectPicked}
              queueItems={visibleQueueItems}
              onEditQueued={editQueued}
              onRemoveQueued={removeQueued}
              onSteerQueued={(queueId) => void steerQueued(queueId)}
            />
          }
          statusBar={
            composerVisual.showProjectRow
              ? undefined
              : {
                  cwd,
                  gitBranch,
                  gitSummary,
                  onInitGit,
                  currentContextTokens,
                  contextWindow: effectiveContextWindow,
                  onOpenStatus: openComputerStatus,
                  onOpenDiff: openDiffDrawer,
                }
          }
          textarea={{
            inputRef: textareaRef,
            value: composerInput,
            onPaste: handleComposerPaste,
            onChange: handleComposerChange,
            onKeyDown: (event) => {
              if (!goalModeApi.interceptKeyDown(event)) handleComposerKeyDown(event);
            },
            placeholder: goalModeApi.goalPlaceholder ?? composerVisual.placeholder,
          }}
          floating={composerOnly}
          dense={!showHeader && !composerOnly}
        />
      </div>
    </section>
  );
}

function ChatPaneChrome({
  extensionUiRequest,
  onExtensionUiRespond,
  showHeader,
  terminalView,
  terminalSnapshot,
  header,
}: {
  extensionUiRequest: SessionTab["extensionUiRequest"];
  onExtensionUiRespond: (response: {
    value?: string;
    confirmed?: boolean;
    cancelled?: boolean;
  }) => void;
  showHeader: boolean;
  terminalView: boolean;
  terminalSnapshot: TerminalOwnersSnapshot;
  header: ComponentProps<typeof AgentChatPaneHeader>;
}) {
  return (
    <>
      {extensionUiRequest ? (
        <ExtensionUiDialog request={extensionUiRequest} onRespond={onExtensionUiRespond} />
      ) : null}
      {showHeader ? <AgentChatPaneHeader {...header} /> : null}
      <div className={terminalView ? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"}>
        <PersistentTerminals
          active={terminalView}
          activeOwnerKey={terminalSnapshot.activeOwnerKey}
          terminals={terminalSnapshot.owners}
        />
      </div>
    </>
  );
}

function SessionProjectDrawer({
  tabId,
  piSessionId,
  showProjectRow,
  running,
  ...rest
}: Omit<ComponentProps<typeof ComposerProjectDrawer>, "canPickProject" | "piSessionId"> & {
  tabId: string | null;
  piSessionId: string | null;
  showProjectRow: boolean;
  running: boolean;
}) {
  return (
    <ComposerProjectDrawer
      key={`${tabId}:${piSessionId ?? "new"}`}
      piSessionId={piSessionId}
      canPickProject={showProjectRow && !running}
      running={running}
      {...rest}
    />
  );
}
