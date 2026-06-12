"use client";

import { useRef, useState, type ReactNode } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useClickOutside } from "@/features/agent/hooks/use-click-outside";
import { useAppStore } from "@/store";
import { CloseIcon, MoreIcon } from "@/ui/icons";

/* Codex elevated popover: translucent surface over backdrop blur, hairline
   border, soft shadow — themed, so it works in both light and dark. */
const CHAT_HEADER_MENU_CLASS =
  "absolute left-0 top-7 isolate z-[999] min-w-[160px] rounded-lg border border-(--border) bg-(--surface-2)/95 p-1 text-xs text-(--fg) opacity-100 shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur-md";

export function AgentChatPaneHeader({
  title,
  pinned,
  rightPanelOpen,
  canFork,
  canClose,
  onTogglePinned,
  onRename,
  onFork,
  onClose,
  onToggleRightPanel,
}: {
  title: string;
  pinned: boolean;
  rightPanelOpen: boolean;
  canFork: boolean;
  canClose: boolean;
  onTogglePinned: () => void;
  onRename: (title: string) => void;
  onFork?: () => void;
  onClose?: () => void;
  onToggleRightPanel: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open, () => setOpen(false));
  // When the left sidebar is collapsed, the fixed "expand sidebar" button sits
  // over the top-left corner. Pad the header so the title never renders under it.
  const sidebarCollapsed = useAppStore((s) => !s.desktopSidebarPinnedOpen);
  const RightPanelIcon = rightPanelOpen ? PanelRightClose : PanelRightOpen;
  const startRename = () => {
    setDraftTitle(title);
    setRenaming(true);
    setOpen(false);
  };
  const finishRename = () => {
    const trimmed = draftTitle.trim();
    if (trimmed) onRename(trimmed);
    setRenaming(false);
  };
  return (
    <div
      className={`grid h-9 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 overflow-hidden border-b border-(--border) py-0 pr-2 text-xs ${
        sidebarCollapsed ? "pl-12" : "pl-2"
      }`}
    >
      <div ref={ref} className="relative flex min-w-0 items-center gap-1.5 overflow-hidden">
        {renaming ? (
          <input
            autoFocus
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={finishRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") finishRename();
              if (event.key === "Escape") {
                setDraftTitle(title);
                setRenaming(false);
              }
            }}
            className="h-7 min-w-0 flex-1 rounded-sm bg-(--surface) px-1.5 py-0.5 text-[length:var(--fs-md)] font-medium text-(--fg) outline-none"
            aria-label="Rename session"
          />
        ) : (
          <span
            className="block min-w-0 truncate whitespace-nowrap text-[length:var(--fs-md)] font-medium leading-none text-(--fg)"
            title={title}
          >
            {title}
          </span>
        )}
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => setOpen((value) => !value)}
          className={`relative z-10 -my-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
            open
              ? "text-(--fg) hover:bg-(--surface)"
              : "text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
          }`}
          aria-label="Session settings"
          title="Session settings"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <MoreIcon className="pointer-events-none h-3.5 w-3.5" />
        </button>
        {open ? (
          <div className={CHAT_HEADER_MENU_CLASS} role="menu">
            <HeaderMenuItem onClick={startRename}>Rename</HeaderMenuItem>
            <HeaderMenuItem
              onClick={() => {
                onTogglePinned();
                setOpen(false);
              }}
            >
              {pinned ? "Unpin" : "Pin"}
            </HeaderMenuItem>
            <HeaderMenuItem
              disabled={!canFork}
              onClick={() => {
                onFork?.();
                setOpen(false);
              }}
            >
              Fork
            </HeaderMenuItem>
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {canClose ? (
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onClose?.();
            }}
            className="relative z-10 -my-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
            aria-label="Close pane"
            title="Close pane"
          >
            <CloseIcon className="h-3 w-3 pointer-events-none" />
          </button>
        ) : null}
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={onToggleRightPanel}
          aria-pressed={rightPanelOpen}
          className={`relative z-10 -my-1 inline-flex h-8 w-8 items-center justify-center rounded-md ${
            rightPanelOpen
              ? "text-(--fg) hover:bg-(--surface)"
              : "text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
          }`}
          title={rightPanelOpen ? "Hide right sidebar" : "Show right sidebar"}
          aria-label={rightPanelOpen ? "Hide right sidebar" : "Show right sidebar"}
        >
          <RightPanelIcon className="pointer-events-none h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function HeaderMenuItem({
  onClick,
  children,
  disabled = false,
}: {
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="block w-full rounded-sm px-2.5 py-1.5 text-left text-xs text-(--fg) hover:bg-(--active) disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
      role="menuitem"
    >
      {children}
    </button>
  );
}
