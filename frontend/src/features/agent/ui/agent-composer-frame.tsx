"use client";

import type {
  ChangeEventHandler,
  ClipboardEventHandler,
  DragEventHandler,
  FormEventHandler,
  KeyboardEventHandler,
  ReactNode,
  RefObject,
} from "react";
import type {
  ComposerMention,
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/features/agent/composer-context";
import type { BrowserBackend } from "@/features/agent/tools/types";
import type { ComposerBanner } from "@/features/agent/composer/composer-visual-state";
import { Spinner } from "@/ui";
import { POPOVER_MENU_CLASS } from "@/ui/popover";
import type { GitSummary } from "@/features/agent/projects/types";
import { AgentAttachmentTray, type AgentComposerAttachment } from "./agent-attachment-tray";
import { AgentComposerActions } from "./agent-composer-actions";
import {
  AgentLoadedContextTabs,
  AgentMentionPicker,
  type MentionRow,
  type LoadedContextKind,
} from "./agent-composer-context";
import { AgentComposerStatusBar } from "./agent-composer-status-bar";
import { AgentComposerTextArea } from "./agent-composer-textarea";
import { cx } from "@/ui/utils";
import { Target } from "@/ui/icon-registry";
import { CloseIcon } from "@/ui/icons";

export type AgentComposerFrameProps = {
  attachments: AgentComposerAttachment[];
  banner: ComposerBanner | null;
  browserToolEnabled: boolean;
  browserBackend: BrowserBackend;
  composerDragActive: boolean;
  contextWindow: number;
  currentContextTokens: number;
  cwd: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  gitBranch?: string | null;
  gitSummary?: GitSummary | null;
  input: string;
  mention: ComposerMention | null;
  mentionIndex: number;
  mentionRows: MentionRow[];
  modelSupportsVision: boolean;
  modelSelector?: ReactNode;
  onAbortTurn: () => void;
  onAttachFiles: (files: FileList | null) => void;
  onComposerChange: ChangeEventHandler<HTMLTextAreaElement>;
  onComposerDragLeave: DragEventHandler<HTMLDivElement>;
  onComposerDragOver: DragEventHandler<HTMLDivElement>;
  onComposerDrop: DragEventHandler<HTMLDivElement>;
  onComposerKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
  onComposerPaste: ClipboardEventHandler<HTMLTextAreaElement>;
  onInitGit?: () => void;
  onOpenStatus: () => void;
  onOpenDiff: () => void;
  onRemoveAttachment: (id: string) => void;
  onRemoveLoadedContext: (kind: LoadedContextKind, id: string) => void;
  onSelectMention: (entry: MentionRow) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onToggleBrowserBackend: () => void;
  onToggleBrowserTool: () => void;
  placeholder: string;
  goalMode?: boolean;
  onExitGoalMode?: () => void;
  drawer?: ReactNode;
  showStatusBar: boolean;
  promptTemplates: ComposerPromptTemplateRef[];
  readingAttachments: boolean;
  running: boolean;
  selectedSkills: ComposerSkillRef[];
  status?: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  dense?: boolean;
};

export function AgentComposerFrame(props: AgentComposerFrameProps) {
  const { dense = false, goalMode = false } = props;
  return (
    <form
      onSubmit={props.onSubmit}
      className={cx(
        "relative z-[100] shrink-0",
        dense ? "bg-(--agent-bg) px-3 pb-1 pt-1.5" : "bg-transparent px-3 pb-2 pt-0 sm:px-5",
      )}
    >
      {props.banner ? (
        <div className="mx-auto flex w-full max-w-[calc(var(--composer-w)*0.9)] items-center gap-2 pb-2 pl-1 text-[length:var(--fs-sm)] text-(--fg)/35 sm:w-[90%]">
          <Spinner size="xs" />
          {props.banner.label}
        </div>
      ) : null}
      {props.drawer}
      <div
        onDragOver={props.onComposerDragOver}
        onDragLeave={props.onComposerDragLeave}
        onDrop={props.onComposerDrop}
        className={cx(
          "agent-composer-box relative z-10 mx-auto w-full max-w-[calc(var(--composer-w)*0.9)] overflow-visible rounded-[var(--composer-radius)] border border-(--border) bg-(--composer) shadow-[var(--composer-elevation)] backdrop-blur-lg transition-colors [corner-shape:superellipse(1.5)] sm:w-[90%]",
          props.composerDragActive && "outline outline-1 outline-(--link)/50",
        )}
      >
        {props.composerDragActive ? (
          <div className="px-4 pt-2 text-[length:var(--fs-sm)] text-(--link)">
            Drop files to attach to the next message.
          </div>
        ) : null}
        <AgentLoadedContextTabs
          skills={props.selectedSkills}
          promptTemplates={props.promptTemplates}
          onRemove={props.onRemoveLoadedContext}
        />
        {goalMode ? (
          <div className="flex items-center gap-1.5 px-3 pt-2.5">
            {/* Themed, not amber-500. A literal Tailwind colour was the one
                hardcoded hue in the composer chrome and read as foreign on the
                other ~15 themes; --accent has a bare-:root baseline. */}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-(--accent)/30 bg-(--accent)/10 py-0.5 pl-2 pr-1 text-[length:var(--fs-sm)] font-medium text-(--accent)">
              <Target className="size-3.5" aria-hidden />
              Goal
              <button
                type="button"
                onClick={props.onExitGoalMode}
                aria-label="Exit goal mode"
                className="rounded-full p-0.5 text-(--accent)/70 transition-colors hover:bg-(--accent)/15 hover:text-(--accent)"
              >
                <CloseIcon className="size-3" />
              </button>
            </span>
            <span className="text-[length:var(--fs-sm)] text-(--fg)/40">
              Enter sends this as the session objective
            </span>
          </div>
        ) : null}
        {props.mention ? (
          <div className={`absolute inset-x-0 bottom-full z-20 mb-2 ${POPOVER_MENU_CLASS}`}>
            <AgentMentionPicker
              mention={props.mention}
              rows={props.mentionRows}
              activeIndex={props.mentionIndex}
              onSelect={props.onSelectMention}
            />
          </div>
        ) : null}
        <AgentAttachmentTray
          attachments={props.attachments}
          modelSupportsVision={props.modelSupportsVision}
          onRemove={props.onRemoveAttachment}
        />
        <AgentComposerTextArea
          inputRef={props.textareaRef}
          value={props.input}
          onPaste={props.onComposerPaste}
          onChange={props.onComposerChange}
          onKeyDown={props.onComposerKeyDown}
          placeholder={props.placeholder}
        />
        <AgentComposerActions
          fileInputRef={props.fileInputRef}
          onAttachFiles={props.onAttachFiles}
          readingAttachments={props.readingAttachments}
          running={props.running}
          status={props.status}
          input={props.input}
          attachmentsCount={props.attachments.length}
          browserToolEnabled={props.browserToolEnabled}
          browserBackend={props.browserBackend}
          onToggleBrowserBackend={props.onToggleBrowserBackend}
          onToggleBrowserTool={props.onToggleBrowserTool}
          onAbortTurn={props.onAbortTurn}
          modelSelector={props.modelSelector}
        />
      </div>
      {props.showStatusBar ? (
        <AgentComposerStatusBar
          cwd={props.cwd}
          gitBranch={props.gitBranch}
          gitSummary={props.gitSummary}
          onInitGit={props.onInitGit}
          currentContextTokens={props.currentContextTokens}
          contextWindow={props.contextWindow}
          onOpenStatus={props.onOpenStatus}
          onOpenDiff={props.onOpenDiff}
        />
      ) : (
        <div
          aria-hidden="true"
          className="mx-auto mt-1.5 h-2 w-full max-w-[calc(var(--composer-w)*0.9)] sm:h-2.5 sm:w-[90%]"
        />
      )}
    </form>
  );
}
