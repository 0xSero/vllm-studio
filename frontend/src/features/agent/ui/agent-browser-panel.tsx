"use client";

import { useCallback, useMemo, type ComponentType, type KeyboardEvent } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { Plus, TerminalSquare, type LucideIcon } from "lucide-react";
import { PanelRightFilled } from "@/ui/panel-toggle-icons";
import { CloseIcon } from "@/ui/icons";
import { MobileSheetGrip } from "@/ui/mobile-sheet-grip";
import { MAX_COMPUTER_WIDTH, MIN_COMPUTER_WIDTH } from "@/features/agent/tools/persistence";
import type { ComputerTab } from "@/features/agent/tools/types";
import { computerResource } from "@/features/agent/tools/resources";
import { useProjectsStore } from "@/features/agent/projects/store";
import { focusedSession as selectFocusedSession } from "@/features/agent/runtime/selectors";
import { terminalOwnerLabel, type TerminalOwnersState } from "@/features/agent/terminal-owners";
import { ComputerTabPanel } from "@/features/agent/ui/computer-tab-panel";
import { TerminalPanel } from "@/features/agent/ui/terminal-panel";
import type { WorkbenchState } from "@/features/agent/workbench/store";

export function AgentBrowserPanel({ workbench }: { workbench: WorkbenchState }) {
  const projects = useProjectsStore();
  const focusedSession = selectFocusedSession(workbench);
  const activeProject = projects.resolveProject(focusedSession);
  const { registerComputerAside, startComputerResize } = workbench;
  const resourceContext = useMemo(
    () => ({
      project: activeProject,
      session: focusedSession,
      modelId: focusedSession?.modelId ?? workbench.selectedModel,
    }),
    [activeProject, focusedSession, workbench.selectedModel],
  );
  const terminalState = workbench.terminals;
  const activeTerminal = terminalState.owners.find(
    (owner) => owner.mountKey === terminalState.activeOwnerKey,
  );
  useMountSubscription(() => {
    if (workbench.computer.open && workbench.computer.tab === "terminal" && !activeTerminal) {
      queueMicrotask(() => workbench.openResource("terminal", resourceContext));
    }
  }, [activeTerminal, resourceContext, workbench]);
  const handleComputerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (!(event.metaKey || event.ctrlKey) || !event.altKey) return;
      const index = Number(event.key) - 1;
      if (!Number.isInteger(index) || index < 0) return;
      const owner = terminalState.owners[index];
      if (!owner) return;
      event.preventDefault();
      workbench.openResource("terminal", resourceContext, owner.mountKey);
    },
    [resourceContext, terminalState.owners, workbench],
  );
  return (
    <aside
      className={`agent-computer-panel ${workbench.computer.open ? "relative flex" : "hidden"} min-h-0 shrink-0 flex-col border-l border-(--border) bg-(--color-panel)`}
      ref={registerComputerAside}
      tabIndex={-1}
      onKeyDown={handleComputerKeyDown}
      style={{
        width: `${workbench.computer.width}px`,
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
      <MobileSheetGrip label="Close panel" onDismiss={() => workbench.setComputerOpen(false)} />
      <ComputerHeader
        tab={workbench.computer.tab}
        openTabs={workbench.computer.tabs}
        terminalState={terminalState}
        onSelectTab={workbench.setComputerTab}
        onOpenCurrentTerminal={() => workbench.openResource("terminal", resourceContext)}
        onSelectTerminalOwner={(ownerKey) =>
          workbench.openResource("terminal", resourceContext, ownerKey)
        }
        onCloseTerminalOwner={(ownerKey) => workbench.closeResource("terminal", ownerKey)}
        onCloseTab={workbench.closeResource}
        onShowLauncher={() => workbench.setComputerTab("tools")}
        onClosePanel={() => workbench.setComputerOpen(false)}
      />

      <ComputerTabPanel workbench={workbench} />

      {workbench.computer.tab === "terminal" && activeTerminal ? (
        <TerminalPanel cwd={activeTerminal.cwd} ownerKey={activeTerminal.mountKey} />
      ) : null}
    </aside>
  );
}

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
