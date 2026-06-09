"use client";

import { memo, useMemo, useState } from "react";
import { useTimelineScrollEffects } from "@/hooks/agent/use-timeline-scroll-effects";
import type { AssistantBlock, ChatMessage } from "@/lib/agent/session";
import { MessageView } from "./message-view";

// Mirrors `groupAssistantBlocks`: a message renders something only if it has a
// non-empty text block or any tool/thinking/event block. Assistant messages
// that produce nothing (e.g. only whitespace text from a stream) would still
// emit an empty article plus the wrapper's top padding, leaving a blank gap.
function messageRenders(message: ChatMessage): boolean {
  if (message.role === "system") return false;
  if (message.role === "user") {
    return message.text.trim().length > 0 || Boolean(message.attachments?.length);
  }
  return (message.blocks ?? []).some((block: AssistantBlock) =>
    block.kind === "text" ? block.text.trim() !== "" : true,
  );
}

type TimelineProps = {
  messages: ChatMessage[];
  running: boolean;
  onForkSession?: () => void;
  emptyPrompt?: boolean;
  stickToBottom?: boolean;
  onStickToBottomChange?: (value: boolean) => void;
};

const MemoMessage = memo(
  function MemoMessage({
    message,
    live,
    running,
    onForkSession,
  }: {
    message: ChatMessage;
    live: boolean;
    running: boolean;
    onForkSession?: () => void;
  }) {
    return (
      <MessageView message={message} live={live} running={running} onForkSession={onForkSession} />
    );
  },
  (prev, next) =>
    prev.message === next.message &&
    prev.live === next.live &&
    prev.running === next.running &&
    prev.onForkSession === next.onForkSession,
);

export function Timeline({
  messages,
  running,
  onForkSession,
  emptyPrompt = false,
  stickToBottom = true,
  onStickToBottomChange,
}: TimelineProps) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [bottom, setBottom] = useState<HTMLDivElement | null>(null);

  const visibleMessages = useMemo(() => messages.filter(messageRenders), [messages]);

  useTimelineScrollEffects({
    scroller,
    bottom,
    stickToBottom,
    onStickToBottomChange,
  });

  if (emptyPrompt) {
    return (
      <div className="flex min-h-0 flex-1 overflow-y-auto bg-(--agent-bg) px-6 pb-10 pt-2">
        <div className="agent-thread-shell mx-auto flex flex-1">
          <div className="flex flex-1 items-center justify-center text-center text-[length:var(--fs-4xl)] font-medium leading-[1.35] text-(--fg)">
            <p className="max-w-[680px]">
              A dream is something you build for yourself.
              <br />
              Just talk to it.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setScroller}
      data-timeline-scroller
      className="agent-chat-scroller min-h-0 flex-1 overflow-y-auto bg-(--agent-bg) px-6 pb-1 pt-2 [overflow-anchor:none] [overscroll-behavior:contain] [scroll-behavior:auto] [scrollbar-gutter:stable_both-edges]"
    >
      <div data-timeline-list className="agent-thread-shell mx-auto flex flex-col">
        {visibleMessages.map((message, index) => {
          const isLast = index === visibleMessages.length - 1;
          const prevRole = index > 0 ? visibleMessages[index - 1].role : null;
          const isGrouped = message.role === prevRole;
          return (
            <div
              key={message.id}
              className={`[overflow-anchor:none] ${isGrouped ? "pt-2" : "pt-6"} ${isLast ? "pb-4" : ""}`}
            >
              <MemoMessage
                message={message}
                live={isLast && running}
                running={running}
                onForkSession={onForkSession}
              />
            </div>
          );
        })}
        {running ? (
          <div className="pt-6 pb-4 [overflow-anchor:none]">
            <div className="flex items-center gap-2.5 text-[length:var(--fs-xs)] leading-4 text-(--dim)">
              <span className="relative inline-flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-(--accent)/40 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-(--accent)/60" />
              </span>
              <span className="animate-pulse">Thinking…</span>
            </div>
          </div>
        ) : null}
        <div ref={setBottom} aria-hidden="true" className="[overflow-anchor:none]" />
      </div>
    </div>
  );
}
