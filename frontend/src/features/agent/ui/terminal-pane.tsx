"use client";

import dynamic from "next/dynamic";
import { CloseIcon } from "@/ui/icons";
import { PanelRightClose, PanelRightOpen } from "@/ui/icon-registry";
import type { PaneId, TerminalPaneState } from "@/features/agent/workspace/types";

const TerminalPanel = dynamic(
  () => import("@/features/agent/ui/terminal-panel").then((mod) => mod.TerminalPanel),
  { ssr: false },
);

export function TerminalPane({
  paneId,
  pane,
  canClose,
  rightPanelOpen,
  onFocus,
  onClose,
  onToggleRightPanel,
}: {
  paneId: PaneId;
  pane: TerminalPaneState;
  canClose: boolean;
  rightPanelOpen: boolean;
  onFocus: () => void;
  onClose: () => void;
  onToggleRightPanel: () => void;
}) {
  const RightPanelIcon = rightPanelOpen ? PanelRightClose : PanelRightOpen;
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
          {canClose ? (
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onClose();
              }}
              className="relative z-10 -my-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
              aria-label="Close terminal"
              title="Close terminal"
            >
              <CloseIcon className="pointer-events-none h-3 w-3" />
            </button>
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
      <TerminalPanel cwd={pane.cwd} ownerKey={pane.mountKey} />
    </section>
  );
}
