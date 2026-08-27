import {
  useMemo,
  useState,
  type ComponentType,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  ChatIcon,
  CloseIcon,
  FolderTree,
  GitBranch,
  Globe2,
  TerminalSquare,
} from "@/ui/icon-registry";
import { isWorkingStatus } from "@/features/agent/runtime/session-status";
import type { ComputerTab } from "@/features/agent/tools/types";
import { COMPUTER_TAB_TITLES, type RenderedWorkbenchTab } from "@/features/workbench/model";
import { handleLauncherKeyDown, projectInitial } from "@/features/workbench/workbench-tab-helpers";
import { POPOVER_SURFACE_CLASS } from "@/ui/popover";
import { cx } from "@/ui/utils";

type WorkbenchIcon = ComponentType<{ className?: string; strokeWidth?: number }>;

const TOOL_ICONS: Record<ComputerTab, WorkbenchIcon> = {
  "side-chat": ChatIcon,
  browser: Globe2,
  files: FolderTree,
  diff: GitBranch,
  terminal: TerminalSquare,
};

function tabIcon(tab: RenderedWorkbenchTab): WorkbenchIcon {
  return tab.kind === "task" ? ChatIcon : TOOL_ICONS[tab.tool ?? "side-chat"];
}

export function WorkbenchProjectTabList({
  projectName,
  threadTitle,
  sidebarCollapsed,
  orderedTabs,
  activeId,
  onActivate,
  onClose,
  onFocusTab,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  draggedId,
  dropTarget,
  register,
}: {
  projectName: string;
  threadTitle: string;
  sidebarCollapsed?: boolean;
  orderedTabs: readonly RenderedWorkbenchTab[];
  activeId: string | null;
  onActivate: (tab: RenderedWorkbenchTab) => void;
  onClose: (tabId: string) => void;
  onFocusTab: (index: number) => void;
  onDragStart: (tabId: string) => void;
  onDragEnd: () => void;
  onDragOver: (targetId: string, position: "before" | "after") => void;
  onDrop: (
    event: DragEvent<HTMLDivElement>,
    targetId: string,
    position: "before" | "after",
  ) => void;
  draggedId: string | null;
  dropTarget: { id: string; position: "before" | "after" } | null;
  register: (tabId: string, element: HTMLButtonElement | null) => void;
}) {
  return (
    <div
      className={`flex min-w-0 flex-1 items-stretch overflow-hidden ${sidebarCollapsed ? "md:pl-[calc(3rem+var(--desktop-titlebar-left-inset))]" : ""}`}
    >
      <div
        role="tablist"
        aria-orientation="horizontal"
        aria-label={`${projectName}, ${threadTitle} tabs`}
        className="flex min-w-0 flex-1 items-end gap-0 overflow-x-auto overflow-y-hidden px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {orderedTabs.map((tab, index) => (
          <WorkbenchTabButton
            key={tab.id}
            tab={tab}
            active={tab.id === activeId}
            ariaLabel={`${projectName}, ${threadTitle}, ${tab.title}`}
            projectName={projectName}
            threadTitle={threadTitle}
            shortcut={index < 9 ? `⌘${index + 1}` : undefined}
            onActivate={() => onActivate(tab)}
            onClose={() => onClose(tab.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                onFocusTab(index - 1);
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                onFocusTab(index + 1);
              } else if (event.key === "Home") {
                event.preventDefault();
                onFocusTab(0);
              } else if (event.key === "End") {
                event.preventDefault();
                onFocusTab(orderedTabs.length - 1);
              } else if (event.key === "Delete" || event.key === "Backspace") {
                event.preventDefault();
                onClose(tab.id);
              }
            }}
            onDragStart={() => onDragStart(tab.id)}
            onDragEnd={onDragEnd}
            onDragOver={(position) => onDragOver(tab.id, position)}
            onDrop={(event, position) => onDrop(event, tab.id, position)}
            dragging={draggedId === tab.id}
            dropPosition={dropTarget?.id === tab.id ? dropTarget.position : null}
            register={(element) => register(tab.id, element)}
          />
        ))}
      </div>
    </div>
  );
}

export function WorkbenchTabButton({
  tab,
  active,
  ariaLabel,
  projectName,
  threadTitle,
  shortcut,
  onActivate,
  onClose,
  onKeyDown,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  dragging,
  dropPosition,
  register,
}: {
  tab: RenderedWorkbenchTab;
  active: boolean;
  ariaLabel: string;
  projectName: string;
  threadTitle: string;
  shortcut?: string;
  onActivate: () => void;
  onClose: () => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (position: "before" | "after") => void;
  onDrop: (event: DragEvent<HTMLDivElement>, position: "before" | "after") => void;
  dragging: boolean;
  dropPosition: "before" | "after" | null;
  register: (element: HTMLButtonElement | null) => void;
}) {
  const Icon = tabIcon(tab);
  const label = tab.kind === "task" ? `${projectName} / ${threadTitle}` : tab.title;
  const working = tab.kind === "task" && Boolean(tab.status && isWorkingStatus(tab.status));
  return (
    <div
      role="none"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        onDragOver(event.clientX < bounds.left + bounds.width / 2 ? "before" : "after");
      }}
      onDrop={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        onDrop(event, event.clientX < bounds.left + bounds.width / 2 ? "before" : "after");
      }}
      style={{
        flex: "0 1 clamp(var(--workbench-tab-min-width), 12vw, var(--workbench-tab-max-width))",
      }}
      className={`workbench-tab group/tab relative flex h-[30px] min-w-[var(--workbench-tab-min-width)] max-w-[var(--workbench-tab-max-width)] shrink-0 items-center self-end border-x border-t px-2 text-left text-[length:var(--fs-xs)] transition-[background-color,border-color,color,box-shadow,opacity] duration-[var(--motion-fast)] ${
        active
          ? "z-10 -mb-px rounded-t-[8px] border-(--border)/70 border-b-0 bg-(--agent-bg) text-(--fg) shadow-[0_-1px_0_color-mix(in_srgb,var(--border)_55%,transparent)]"
          : "rounded-t-[7px] border-transparent bg-transparent text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
      } ${
        active
          ? ""
          : "after:absolute after:right-0 after:top-1/2 after:h-4 after:w-px after:-translate-y-1/2 after:bg-(--border)/45"
      } ${dragging ? "opacity-40" : ""}`}
    >
      {dropPosition ? (
        <span
          className={`pointer-events-none absolute bottom-0 top-0 z-20 w-0.5 bg-(--accent) ${dropPosition === "before" ? "-left-px" : "-right-px"}`}
        />
      ) : null}
      <button
        ref={register}
        type="button"
        role="tab"
        aria-selected={active}
        aria-label={ariaLabel}
        aria-controls="workbench-active-surface"
        id={active ? "workbench-active-tab" : undefined}
        tabIndex={active ? 0 : -1}
        onClick={onActivate}
        onKeyDown={onKeyDown}
        onAuxClick={(event) => {
          if (event.button === 1 && tab.kind === "tool") onClose();
        }}
        title={shortcut ? `${label} (${shortcut})` : label}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-visible:rounded-[4px] focus-visible:ring-1 focus-visible:ring-(--focus-ring) focus-visible:ring-offset-[-1px]"
      >
        <span
          className={`relative flex h-4 w-4 shrink-0 items-center justify-center transition-colors duration-[var(--motion-fast)] ${
            active ? "text-(--fg)" : "text-(--hl2)"
          }`}
        >
          {tab.kind === "task" ? (
            <span className="flex h-4 w-4 items-center justify-center rounded-[4px] bg-(--accent)/15 text-[9px] font-semibold leading-none text-(--accent)">
              {projectInitial(projectName)}
            </span>
          ) : (
            <Icon className="h-3 w-3 opacity-90" strokeWidth={1.65} />
          )}
          {working ? (
            <span className="absolute -bottom-px -right-px h-1.5 w-1.5 rounded-full bg-(--accent) ring-2 ring-(--color-header)" />
          ) : null}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
      {tab.kind === "tool" ? (
        <button
          type="button"
          tabIndex={active ? 0 : -1}
          aria-label={`Close ${tab.title}`}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className={cx(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-(--dim) transition-[background-color,color,opacity] duration-[var(--motion-fast)] focus-visible:opacity-100 focus-visible:bg-(--fg)/8 hover:bg-(--fg)/8 hover:text-(--fg)",
            active ? "opacity-70" : "opacity-0 group-hover/tab:opacity-80",
          )}
        >
          <CloseIcon className="h-2.5 w-2.5" />
        </button>
      ) : null}
    </div>
  );
}

export function WorkbenchLauncher({
  onOpenTool,
  onDismiss,
}: {
  onOpenTool: (tool: ComputerTab) => void;
  onDismiss: () => void;
}) {
  const [query, setQuery] = useState("");
  const entries = useMemo(
    () =>
      [
        ["side-chat", ChatIcon],
        ["terminal", TerminalSquare],
        ["browser", Globe2],
        ["files", FolderTree],
        ["diff", GitBranch],
      ] as const,
    [],
  );
  const normalized = query.trim().toLowerCase();
  const visible = entries.filter(([tool]) =>
    COMPUTER_TAB_TITLES[tool].toLowerCase().includes(normalized),
  );
  return (
    <div
      className={`absolute right-1 top-[calc(100%+4px)] z-[180] w-52 p-1 ${POPOVER_SURFACE_CLASS}`}
      role="menu"
      aria-label="Open tool tab"
      onKeyDown={(event) => handleLauncherKeyDown(event, onDismiss)}
    >
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search tools"
        aria-label="Search tools"
        className="mb-1 h-7 w-full rounded-[4px] bg-(--color-input) px-2 text-[length:var(--fs-xs)] text-(--fg) outline-none placeholder:text-(--dim) focus:ring-1 focus:ring-(--accent)/35"
      />
      {visible.length ? (
        visible.map(([tool, Icon]) => (
          <LauncherItem
            key={tool}
            icon={Icon}
            label={COMPUTER_TAB_TITLES[tool]}
            onClick={() => onOpenTool(tool)}
          />
        ))
      ) : (
        <div className="px-2 py-2 text-center text-[length:var(--fs-xs)] text-(--dim)">
          No matching tools
        </div>
      )}
    </div>
  );
}

function LauncherItem({
  icon: Icon,
  label,
  shortcut,
  onClick,
}: {
  icon: WorkbenchIcon;
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      data-ui-control="compact"
      onClick={onClick}
      className="flex h-6 w-full items-center gap-1.5 rounded-[var(--ui-radius-control)] px-1.5 text-left text-[length:var(--fs-xs)] text-(--fg)/90 transition-colors duration-[var(--motion-fast)] hover:bg-(--hover)"
    >
      <Icon className="h-3 w-3 shrink-0 text-(--dim)" strokeWidth={1.65} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut ? <kbd className="text-[10px] text-(--dim)">{shortcut}</kbd> : null}
    </button>
  );
}
