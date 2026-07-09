"use client";

import dynamic from "next/dynamic";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronUp,
  CloseIcon,
  Columns2,
  PanelRightClose,
  PanelRightOpen,
  Rows2,
  Search,
} from "@/ui/icon-registry";
import { Input } from "@/ui";
import type {
  TerminalControl,
  TerminalPanelActions,
  TerminalSearchDirection,
} from "@/features/agent/ui/terminal-panel";
import type { PaneId, TerminalPaneState } from "@/features/agent/workspace/types";

const TerminalPanel = dynamic(
  () => import("@/features/agent/ui/terminal-panel").then((mod) => mod.TerminalPanel),
  { ssr: false },
);

export function preloadTerminalPanel(): void {
  void import("@/features/agent/ui/terminal-panel");
  void import("@xterm/xterm");
  void import("@xterm/addon-fit");
  void import("@xterm/addon-search");
  void import("@xterm/addon-web-links").catch(() => null);
}

function HeaderButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="relative z-10 -my-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
      aria-label={title}
      title={title}
    >
      {children}
    </button>
  );
}

export function TerminalPane({
  paneId,
  pane,
  canClose,
  rightPanelOpen,
  onFocus,
  onClose,
  onSplit,
  onNewTerminal,
  onToggleRightPanel,
}: {
  paneId: PaneId;
  pane: TerminalPaneState;
  canClose: boolean;
  rightPanelOpen: boolean;
  onFocus: () => void;
  onClose: () => void;
  onSplit: (direction: "vertical" | "horizontal") => void;
  onNewTerminal: () => void;
  onToggleRightPanel: () => void;
}) {
  const controlRef = useRef<TerminalControl | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const RightPanelIcon = rightPanelOpen ? PanelRightClose : PanelRightOpen;

  const runSearch = (value: string, direction: TerminalSearchDirection) => {
    const trimmed = value.trim();
    if (!trimmed) controlRef.current?.clearSearch();
    else controlRef.current?.search(trimmed, direction);
  };

  const closeSearch = () => {
    setSearchOpen(false);
    controlRef.current?.clearSearch();
    controlRef.current?.focus();
  };

  const toggleSearch = () =>
    setSearchOpen((open) => {
      const next = !open;
      if (next) requestAnimationFrame(() => searchInputRef.current?.select());
      else {
        controlRef.current?.clearSearch();
        controlRef.current?.focus();
      }
      return next;
    });

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runSearch(searchTerm, event.shiftKey ? "previous" : "next");
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
    }
  };

  const actions: TerminalPanelActions = {
    onNewTerminal,
    onSplit,
    onRequestClose: canClose ? onClose : undefined,
    onToggleSearch: toggleSearch,
  };

  return (
    <section
      data-pane-id={paneId}
      onMouseDownCapture={onFocus}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-(--color-terminal-bg)"
    >
      <div className="grid h-10 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-(--border)/85 bg-(--color-header) py-0 pl-3 pr-2 text-xs">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[length:var(--fs-lg)] font-medium leading-none text-(--fg)">
            {pane.title}
          </span>
          {pane.cwd ? (
            <span className="truncate font-mono text-[length:var(--fs-xs)] text-(--dim)">
              {pane.cwd}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <HeaderButton onClick={toggleSearch} title="Search terminal">
            <Search className="pointer-events-none h-3.5 w-3.5" />
          </HeaderButton>
          <HeaderButton onClick={() => onSplit("vertical")} title="Split right">
            <Columns2 className="pointer-events-none h-3.5 w-3.5" />
          </HeaderButton>
          <HeaderButton onClick={() => onSplit("horizontal")} title="Split down">
            <Rows2 className="pointer-events-none h-3.5 w-3.5" />
          </HeaderButton>
          {canClose ? (
            <HeaderButton onClick={onClose} title="Close terminal">
              <CloseIcon className="pointer-events-none h-3 w-3" />
            </HeaderButton>
          ) : null}
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onToggleRightPanel();
            }}
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
      {searchOpen ? (
        <div className="flex shrink-0 items-center gap-1 border-b border-(--border)/85 bg-(--color-header) px-2 py-1.5">
          <div className="min-w-0 flex-1">
            <Input
              ref={searchInputRef}
              value={searchTerm}
              onChange={(event) => {
                setSearchTerm(event.target.value);
                runSearch(event.target.value, "next");
              }}
              onKeyDown={onSearchKeyDown}
              placeholder="Find in terminal"
              aria-label="Find in terminal"
              className="h-7"
            />
          </div>
          <HeaderButton onClick={() => runSearch(searchTerm, "previous")} title="Previous match">
            <ChevronUp className="pointer-events-none h-3.5 w-3.5" />
          </HeaderButton>
          <HeaderButton onClick={() => runSearch(searchTerm, "next")} title="Next match">
            <ChevronDown className="pointer-events-none h-3.5 w-3.5" />
          </HeaderButton>
          <HeaderButton onClick={closeSearch} title="Close search">
            <CloseIcon className="pointer-events-none h-3 w-3" />
          </HeaderButton>
        </div>
      ) : null}
      <TerminalPanel
        cwd={pane.cwd}
        ownerKey={pane.mountKey}
        actions={actions}
        controlRef={controlRef}
      />
    </section>
  );
}
