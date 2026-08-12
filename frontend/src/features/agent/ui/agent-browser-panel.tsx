"use client";

import { useCallback, useMemo, useState, type ComponentType, type KeyboardEvent } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { Plus, TerminalSquare, type LucideIcon } from "lucide-react";
import { PanelRightFilled } from "@/ui/panel-toggle-icons";
import { CloseIcon } from "@/ui/icons";
import { MobileSheetGrip } from "@/ui/mobile-sheet-grip";
import { normalizeBrowserInput } from "@/features/agent/tools/browser-url";
import { MAX_COMPUTER_WIDTH, MIN_COMPUTER_WIDTH } from "@/features/agent/tools/persistence";
import {
  sanitizeBrowserPaneUrl,
  sanitizeLocalFileUrl,
} from "@shared/agent/sanitize-embedded-browser-url";
import { useToolsStore } from "@/features/agent/tools/store";
import type { ComputerTab } from "@/features/agent/tools/types";
import { computerResource } from "@/features/agent/tools/resources";
import { useProjects } from "@/features/agent/projects/context";
import type { Project } from "@/features/agent/projects/types";
import type { Session } from "@/features/agent/runtime/types";
import { focusedSession as selectFocusedSession } from "@/features/agent/runtime/selectors";
import { makeFreshTab } from "@/features/agent/messages/helpers";
import {
  terminalOwnerFor,
  terminalOwnerLabel,
  type TerminalOwner,
  type TerminalOwnersState,
} from "@/features/agent/terminal-owners";
import { ComputerTabPanel, type SideChatTabsUpdater } from "@/features/agent/ui/computer-tab-panel";
import { PersistentTerminals } from "@/features/agent/ui/persistent-terminals";
import { webPtyBridge } from "@/features/agent/ui/web-pty-bridge";
import { useWorkspaceContext } from "@/features/agent/ui/use-workspace";

function createSideChatSession(
  activeProject: Project | null,
  focusedSession: Session | null,
  activeModelId: string,
): Session {
  const tab = makeFreshTab();
  return {
    ...tab,
    title: "Side chat",
    cwd: focusedSession?.cwd ?? activeProject?.path,
    projectId: focusedSession?.projectId ?? activeProject?.id,
    modelId: focusedSession?.modelId ?? activeModelId,
  };
}

function acceptedBrowserUrl(url: string): string | null {
  return /^file:\/\//i.test(url) ? sanitizeLocalFileUrl(url) : sanitizeBrowserPaneUrl(url);
}

export function AgentBrowserPanel() {
  const { state, handles } = useWorkspaceContext();
  const projects = useProjects();
  const focusedSession = selectFocusedSession(state);
  const activeProject = projects.resolveProject(focusedSession) ?? projects.selectedProject;
  const sessions = [...state.sessions.values()];
  const activeModelId = focusedSession?.modelId ?? state.selectedModel;
  const tools = useToolsStore();
  const [sideChatSeed, setSideChatSeed] = useState<Session>(() =>
    createSideChatSession(null, null, ""),
  );
  const sideChatSession =
    sessions.find((session) => session.id === sideChatSeed.id) ?? sideChatSeed;
  const { registerComputerAside, startComputerResize } = handles;
  const terminalOwner = useMemo(
    () => terminalOwnerFor(activeProject, focusedSession),
    [activeProject, focusedSession],
  );
  const terminalState = tools.terminals;
  useMountSubscription(() => {
    if (tools.computer.open && tools.computer.tab === "terminal" && terminalOwner) {
      queueMicrotask(() => tools.rememberTerminalOwner(terminalOwner, { select: true }));
    }
  }, [terminalOwner, tools]);
  const openTerminalForFocusedSession = useCallback(() => {
    if (terminalOwner) tools.rememberTerminalOwner(terminalOwner, { select: true });
    tools.setComputerTab("terminal");
  }, [terminalOwner, tools]);
  const selectTerminalOwner = useCallback(
    (ownerKey: string) => {
      tools.selectTerminalOwner(ownerKey);
      tools.setComputerTab("terminal");
    },
    [tools],
  );
  const closeTerminalOwner = useCallback(
    (ownerKey: string) => {
      const owner = tools.removeTerminalOwner(ownerKey);
      if (owner) void webPtyBridge.closeOwner(owner.mountKey);
      if (terminalState.owners.length <= 1) tools.closeComputerTab("terminal");
    },
    [terminalState.owners.length, tools],
  );
  const handleComputerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!(event.metaKey || event.ctrlKey) || !event.altKey) return;
      const index = Number(event.key) - 1;
      if (!Number.isInteger(index) || index < 0) return;
      const owner = terminalState.owners[index];
      if (!owner) return;
      event.preventDefault();
      selectTerminalOwner(owner.mountKey);
    },
    [selectTerminalOwner, terminalState.owners],
  );
  const navigateBrowser = (value: string) => {
    const next = normalizeBrowserInput(value, focusedSession?.cwd ?? activeProject?.path ?? "");
    if (!next) return;
    const accepted = acceptedBrowserUrl(next);
    if (!accepted) return;
    tools.setBrowserUrl(accepted, accepted);
    if (/^file:\/\//i.test(accepted)) return;
    void fetch("/api/agent/browser/navigate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: accepted }),
    }).catch(() => undefined);
  };
  const openSideChat = useCallback(() => {
    handles.updateDetachedSession(sideChatSeed, (current) =>
      current.messages.length
        ? current
        : {
            ...current,
            status: current.status === "loading" ? "idle" : current.status,
            cwd: focusedSession?.cwd ?? activeProject?.path,
            projectId: focusedSession?.projectId ?? activeProject?.id,
            modelId: current.modelId || focusedSession?.modelId || activeModelId,
          },
    );
    tools.setComputerTab("side-chat");
  }, [activeModelId, activeProject, focusedSession, handles, sideChatSeed, tools]);
  const updateSideChatTabs = useCallback(
    (nextTabsOrUpdater: SideChatTabsUpdater) => {
      handles.updateDetachedSession(sideChatSeed, (current) => {
        const nextTabs =
          typeof nextTabsOrUpdater === "function"
            ? nextTabsOrUpdater([current])
            : nextTabsOrUpdater;
        return nextTabs.at(-1) ?? current;
      });
    },
    [handles, sideChatSeed],
  );
  const renameSideChat = useCallback(
    (tabId: string, title: string) => {
      handles.updateDetachedSession(sideChatSeed, (current) =>
        current.id === tabId ? { ...current, title } : current,
      );
    },
    [handles, sideChatSeed],
  );
  const closeSideChat = useCallback(() => {
    handles.removeDetachedSession(sideChatSeed.id);
    setSideChatSeed(createSideChatSession(activeProject ?? null, focusedSession, activeModelId));
    tools.closeComputerTab("side-chat");
  }, [activeModelId, activeProject, focusedSession, handles, sideChatSeed.id, tools]);
  const closeComputerTab = useCallback(
    (closing: ComputerTab) => {
      if (closing === "side-chat") {
        closeSideChat();
        return;
      }
      if (closing === "terminal") {
        const owners = tools.removeTerminalOwners(
          terminalState.owners.map((owner) => owner.mountKey),
        );
        for (const owner of owners) void webPtyBridge.closeOwner(owner.mountKey);
      }
      tools.closeComputerTab(closing);
    },
    [closeSideChat, terminalState.owners, tools],
  );
  return (
    <aside
      className={`agent-computer-panel ${tools.computer.open ? "relative flex" : "hidden"} min-h-0 shrink-0 flex-col border-l border-(--border) bg-(--color-panel)`}
      ref={registerComputerAside}
      tabIndex={-1}
      onKeyDown={handleComputerKeyDown}
      style={{
        width: `${tools.computer.width}px`,
        minWidth: MIN_COMPUTER_WIDTH,
        maxWidth: MAX_COMPUTER_WIDTH,
      }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        title="Resize computer"
        onMouseDown={startComputerResize}
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-(--fg)/8"
      />
      <MobileSheetGrip label="Close panel" onDismiss={() => tools.setComputerOpen(false)} />
      <ComputerHeader
        tab={tools.computer.tab}
        openTabs={tools.computer.tabs}
        terminalState={terminalState}
        onSelectTab={tools.setComputerTab}
        onOpenCurrentTerminal={openTerminalForFocusedSession}
        onSelectTerminalOwner={selectTerminalOwner}
        onCloseTerminalOwner={closeTerminalOwner}
        onCloseTab={closeComputerTab}
        onShowLauncher={() => tools.setComputerTab("tools")}
        onClosePanel={() => tools.setComputerOpen(false)}
      />

      <ComputerTabPanel
        onCloseSideChat={closeSideChat}
        onNavigateBrowser={navigateBrowser}
        onOpenSideChat={openSideChat}
        onOpenTerminal={openTerminalForFocusedSession}
        onRenameSideChat={renameSideChat}
        onUpdateSideChatTabs={updateSideChatTabs}
        sideChatSession={sideChatSession}
      />

      <PersistentTerminals
        active={tools.computer.open && tools.computer.tab === "terminal"}
        activeOwnerKey={terminalState.activeOwnerKey}
        terminals={terminalState.owners}
      />
    </aside>
  );
}

// Compact Codex-style pill: active gets a subtle fill; inactive is text-only
// and lifts to full contrast on hover. The close × fades in on hover (and stays
// on for the active pill). Shared by the tab list and the terminal-owner rows.
function TabPill({
  icon: Icon,
  label,
  selected,
  shortcut,
  title,
  onSelect,
  onClose,
}: {
  icon?: LucideIcon;
  label: string;
  selected: boolean;
  shortcut?: string;
  title: string;
  onSelect: () => void;
  onClose?: () => void;
}) {
  return (
    <div
      className={`group inline-flex h-7 min-w-0 shrink-0 items-center rounded-md transition-[background-color,color] duration-150 ${
        selected ? "bg-(--color-surface-hover) text-(--fg)" : "text-(--dim) hover:text-(--fg)"
      }`}
      title={title}
    >
      <button
        type="button"
        onClick={onSelect}
        className="inline-flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md px-2.5 text-left"
      >
        {Icon ? <Icon className="pointer-events-none h-3.5 w-3.5 shrink-0" /> : null}
        <span className="max-w-[8rem] truncate text-[length:var(--fs-sm)]">{label}</span>
        {shortcut ? (
          <span className="text-[length:var(--fs-2xs)] text-(--dim)/70">{shortcut}</span>
        ) : null}
      </button>
      {onClose ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className={`-ml-1 mr-1 inline-flex h-5 w-5 items-center justify-center rounded text-(--dim)/65 opacity-0 transition-[color,opacity] duration-150 hover:text-(--fg) group-hover:opacity-100 focus-visible:opacity-100 ${
            selected ? "opacity-100" : ""
          }`}
          aria-label={`Close ${label}`}
          title={`Close ${label}`}
        >
          <CloseIcon className="pointer-events-none h-2 w-2" />
        </button>
      ) : null}
    </div>
  );
}

// A round icon-only control that matches the pill height. Used for the tools
// launcher (+) and the panel-close button on the right edge of the strip.
function HeaderIconButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative z-10 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-[background-color,color] duration-150 ${
        active ? "bg-(--color-surface-hover) text-(--fg)" : "text-(--dim) hover:text-(--fg)"
      }`}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      <Icon className="pointer-events-none h-3.5 w-3.5" />
    </button>
  );
}

function ComputerHeader({
  tab,
  openTabs,
  terminalState,
  onSelectTab,
  onOpenCurrentTerminal,
  onSelectTerminalOwner,
  onCloseTerminalOwner,
  onCloseTab,
  onShowLauncher,
  onClosePanel,
}: {
  tab: ComputerTab;
  openTabs: ComputerTab[];
  terminalState: TerminalOwnersState;
  onSelectTab: (tab: ComputerTab) => void;
  onOpenCurrentTerminal: () => void;
  onSelectTerminalOwner: (ownerKey: string) => void;
  onCloseTerminalOwner: (ownerKey: string) => void;
  onCloseTab: (tab: ComputerTab) => void;
  onShowLauncher: () => void;
  onClosePanel: () => void;
}) {
  const visibleTabs = openTabs.filter(
    (openTab) =>
      openTab !== "tools" && (openTab !== "terminal" || terminalState.owners.length === 0),
  );
  return (
    <div className="relative flex h-[var(--h-toolbar-pane)] shrink-0 items-center gap-1 border-b border-(--border) bg-(--color-header) px-1.5 text-[length:var(--fs-sm)]">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overflow-y-hidden px-0.5 [scrollbar-width:thin]">
        {visibleTabs.map((openTab) => {
          const meta = computerResource(openTab);
          return (
            <TabPill
              key={openTab}
              icon={meta.icon}
              label={meta.label}
              title={meta.label}
              selected={tab === openTab}
              onSelect={() =>
                openTab === "terminal" ? onOpenCurrentTerminal() : onSelectTab(openTab)
              }
              onClose={openTab === "status" ? undefined : () => onCloseTab(openTab)}
            />
          );
        })}
        {terminalState.owners.map((owner, index) => {
          const label = terminalOwnerLabel(owner, index);
          const selected = tab === "terminal" && terminalState.activeOwnerKey === owner.mountKey;
          const shortcut = index < 9 ? `⌘⌥${index + 1}` : undefined;
          return (
            <TabPill
              key={owner.mountKey}
              icon={TerminalSquare}
              label={label}
              title={shortcut ? `${label} (${shortcut})` : label}
              shortcut={shortcut}
              selected={selected}
              onSelect={() => onSelectTerminalOwner(owner.mountKey)}
              onClose={() => onCloseTerminalOwner(owner.mountKey)}
            />
          );
        })}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <HeaderIconButton
          icon={Plus}
          label="Show tools"
          active={tab === "tools"}
          onClick={onShowLauncher}
        />
        <HeaderIconButton
          icon={PanelRightFilled}
          label="Close controller panel"
          onClick={onClosePanel}
        />
      </div>
    </div>
  );
}
