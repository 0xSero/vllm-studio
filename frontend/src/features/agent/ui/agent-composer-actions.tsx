"use client";

import type { ReactNode, RefObject } from "react";
import { Spinner } from "@/ui";
import { ArrowUp, Plus } from "lucide-react";
import { useTools } from "@/features/agent/tools/context";
import { GlobeIcon, PanelIcon, SitegeistIcon, StopIcon } from "@/ui/icons";
import { ComposerDictationButton } from "./composer-dictation-button";

export function AgentComposerActions({
  fileInputRef,
  onAttachFiles,
  readingAttachments,
  running,
  status,
  input,
  attachmentsCount,
  onToggleBrowserTool,
  onAbortTurn,
  onTranscript,
  modelSelector,
}: {
  fileInputRef: RefObject<HTMLInputElement | null>;
  onAttachFiles: (files: FileList | null) => void;
  readingAttachments: boolean;
  running: boolean;
  status?: string;
  input: string;
  attachmentsCount: number;
  onToggleBrowserTool: () => void;
  onAbortTurn: () => void;
  onTranscript: (text: string) => void;
  modelSelector?: ReactNode;
}) {
  const tools = useTools();
  const browserToolEnabled = tools.browser.enabled;
  const browserBackend = tools.browser.backend;
  const inputHasText = Boolean(input.trim());
  const starting = status === "starting";
  const stopping = status === "stopping";
  const usingSitegeist = browserBackend === "sitegeist";
  const browserBackendLabel = usingSitegeist ? "Sitegeist relay" : "embedded panel";
  const browserBackendTarget = usingSitegeist ? "embedded panel" : "Sitegeist relay";
  const inactiveIconClass = "text-(--hl2) hover:bg-(--hover) hover:text-(--fg)";
  const activeIconClass = "bg-(--active) text-(--fg)";

  return (
    <div className="agent-composer-actions-row flex min-h-9 items-center gap-0.5 bg-transparent px-2 pb-2 pt-0 text-xs">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => onAttachFiles(event.currentTarget.files)}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={readingAttachments || running}
        className="inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-full text-(--hl2) hover:bg-(--hover) hover:text-(--fg) disabled:opacity-30"
        aria-label="Attach files"
        title="Attach files (or paste/drop into composer)"
      >
        <Plus className="h-4 w-4" strokeWidth={1.75} />
      </button>
      <button
        type="button"
        onClick={onToggleBrowserTool}
        aria-pressed={browserToolEnabled}
        aria-label="Browser tools"
        title={
          browserToolEnabled
            ? "Browser tool: ON — agent can drive the browser"
            : "Browser tool: OFF — click to let the agent navigate, click, fill, and read pages"
        }
        className={`composer-action-optional inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-full ${browserToolEnabled ? activeIconClass : inactiveIconClass}`}
      >
        <span className="relative inline-flex">
          <GlobeIcon className="h-4 w-4" />
        </span>
      </button>
      {browserToolEnabled ? (
        <button
          type="button"
          onClick={tools.toggleBrowserBackend}
          aria-label={`Browser backend: ${browserBackendLabel}. Switch to ${browserBackendTarget}.`}
          className={`composer-action-optional inline-flex !h-7 !min-h-7 !w-7 !min-w-7 shrink-0 items-center justify-center rounded-full ${usingSitegeist ? activeIconClass : inactiveIconClass}`}
          title={`Browser: ${browserBackendLabel}. Click to use ${browserBackendTarget}.`}
        >
          {usingSitegeist ? (
            <SitegeistIcon className="h-4 w-4" />
          ) : (
            <PanelIcon className="h-4 w-4" />
          )}
        </button>
      ) : null}
      <div className="ml-auto flex min-w-0 shrink items-center gap-0.5">
        {modelSelector}
        <ComposerDictationButton
          disabled={running}
          inactiveClassName={inactiveIconClass}
          idleClassName="composer-action-optional"
          onTranscript={onTranscript}
        />
        {running ? (
          <>
            {starting || stopping ? (
              <span
                className="inline-flex !h-7 !min-h-7 shrink-0 items-center gap-1.5 px-2 text-[length:var(--fs-sm)] text-(--dim)"
                title={stopping ? "Waiting for Pi to stop" : "Waiting for the model to start"}
              >
                <Spinner size="xs" />
                {stopping ? "Stopping…" : "Starting…"}
              </span>
            ) : inputHasText ? (
              <button
                type="submit"
                className="inline-flex !h-[30px] !min-h-[30px] !w-[30px] !min-w-[30px] shrink-0 items-center justify-center rounded-full bg-(--fg) text-(--bg) transition-opacity hover:opacity-85"
                aria-label="Steer current task now"
                title="Steer current task now (Alt+Enter) · Enter queues it instead"
              >
                <ArrowUp className="h-4 w-4 stroke-[2.25]" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onAbortTurn}
              disabled={starting || stopping}
              className="inline-flex !h-[30px] !min-h-[30px] !w-[30px] !min-w-[30px] shrink-0 items-center justify-center rounded-full bg-(--fg) text-(--bg) transition-opacity hover:opacity-85 disabled:opacity-30"
              aria-label="Stop"
              title="Stop (Esc)"
            >
              <StopIcon className="h-2.5 w-2.5" />
            </button>
          </>
        ) : (
          <button
            type="submit"
            disabled={(!inputHasText && attachmentsCount === 0) || readingAttachments}
            className="inline-flex !h-[30px] !min-h-[30px] !w-[30px] !min-w-[30px] shrink-0 items-center justify-center rounded-full bg-(--fg) text-(--bg) transition-opacity hover:opacity-85 disabled:bg-(--hl3) disabled:opacity-100"
            aria-label="Send"
            title="Send (Enter)"
          >
            {starting ? <Spinner size="sm" /> : <ArrowUp className="h-4 w-4 stroke-[2.25]" />}
          </button>
        )}
      </div>
    </div>
  );
}
