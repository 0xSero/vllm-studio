"use client";

import type { ComponentProps, DragEventHandler, FormEventHandler, ReactNode } from "react";
import type { ComposerBanner } from "@/features/agent/composer/composer-visual-state";
import { Spinner } from "@/ui";
import { POPOVER_MENU_CLASS } from "@/ui/popover";
import { AgentAttachmentTray } from "./agent-attachment-tray";
import { AgentComposerActions } from "./agent-composer-actions";
import { AgentLoadedContextTabs, AgentMentionPicker } from "./agent-composer-context";
import { AgentComposerStatusBar } from "./agent-composer-status-bar";
import { AgentComposerTextArea } from "./agent-composer-textarea";
import { cx } from "@/ui/utils";
import { Target } from "@/ui/icon-registry";
import { CloseIcon } from "@/ui/icons";

export type AgentComposerFrameProps = {
  actions: ComponentProps<typeof AgentComposerActions>;
  attachments: ComponentProps<typeof AgentAttachmentTray>;
  banner: ComposerBanner | null;
  context: ComponentProps<typeof AgentLoadedContextTabs>;
  drag: {
    active: boolean;
    onLeave: DragEventHandler<HTMLDivElement>;
    onOver: DragEventHandler<HTMLDivElement>;
    onDrop: DragEventHandler<HTMLDivElement>;
  };
  drawer?: ReactNode;
  goal?: { onExit: () => void };
  mention: ComponentProps<typeof AgentMentionPicker>;
  onSubmit: FormEventHandler<HTMLFormElement>;
  statusBar?: ComponentProps<typeof AgentComposerStatusBar>;
  textarea: ComponentProps<typeof AgentComposerTextArea>;
  floating?: boolean;
  dense?: boolean;
};

export function AgentComposerFrame({
  actions,
  attachments,
  banner,
  context,
  drag,
  drawer,
  goal,
  mention,
  onSubmit,
  statusBar,
  textarea,
  floating = false,
  dense = false,
}: AgentComposerFrameProps) {
  return (
    <form
      onSubmit={onSubmit}
      className={cx(
        "relative z-[100] shrink-0",
        floating
          ? "bg-transparent p-[calc(var(--space-base)*2)]"
          : dense
            ? "bg-(--agent-bg) px-3 pb-1 pt-1.5"
            : "bg-transparent px-3 pb-2 pt-0 sm:px-5",
      )}
    >
      {banner ? (
        <div className="mx-auto flex w-full max-w-[calc(var(--composer-w)*0.9)] items-center gap-2 pb-3 pl-1 text-[length:var(--codex-chat-font-size)] text-(--fg)/35 sm:w-[90%]">
          <Spinner size="xs" />
          {banner.label}
        </div>
      ) : null}
      {drawer}
      <div
        onDragOver={drag.onOver}
        onDragLeave={drag.onLeave}
        onDrop={drag.onDrop}
        className={cx(
          "agent-composer-box relative z-10 mx-auto w-full max-w-[calc(var(--composer-w)*0.9)] overflow-visible rounded-[var(--composer-radius)] border border-(--border) bg-(--composer) shadow-[var(--composer-elevation)] backdrop-blur-lg transition-colors [corner-shape:superellipse(1.5)] sm:w-[90%]",
          drag.active && "outline outline-1 outline-(--link)/50",
        )}
      >
        {drag.active ? (
          <div className="px-4 pt-2 text-[length:var(--fs-sm)] text-(--link)">
            Drop files to attach to the next message.
          </div>
        ) : null}
        <AgentLoadedContextTabs {...context} />
        {goal ? (
          <div className="flex items-center gap-1.5 px-3 pt-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 py-0.5 pl-2 pr-1 text-[length:var(--fs-sm)] font-medium text-amber-500">
              <Target className="size-3.5" aria-hidden />
              Goal
              <button
                type="button"
                onClick={goal.onExit}
                aria-label="Exit goal mode"
                className="rounded-full p-0.5 text-amber-500/70 transition-colors hover:bg-amber-500/15 hover:text-amber-400"
              >
                <CloseIcon className="size-3" />
              </button>
            </span>
            <span className="text-[length:var(--fs-sm)] text-(--fg)/40">
              Enter sends this as the session objective
            </span>
          </div>
        ) : null}
        {mention.mention ? (
          <div className={`absolute inset-x-0 bottom-full z-20 mb-2 ${POPOVER_MENU_CLASS}`}>
            <AgentMentionPicker {...mention} />
          </div>
        ) : null}
        <AgentAttachmentTray {...attachments} />
        <AgentComposerTextArea {...textarea} />
        <AgentComposerActions {...actions} />
      </div>
      {statusBar ? (
        <AgentComposerStatusBar {...statusBar} />
      ) : (
        <div
          aria-hidden="true"
          className="mx-auto mt-2 h-3 w-full max-w-[calc(var(--composer-w)*0.9)] sm:mt-2.5 sm:h-4 sm:w-[90%]"
        />
      )}
    </form>
  );
}
