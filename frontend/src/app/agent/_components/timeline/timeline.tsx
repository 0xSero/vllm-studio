"use client";

import { memo, useMemo, useRef } from "react";
import { useTimelineScrollEffects } from "@/hooks/agent/use-timeline-scroll-effects";
import type { ChatMessage } from "@/lib/agent/session";
import { MessageView } from "./message-view";

type TimelineProps = {
  messages: ChatMessage[];
  running: boolean;
  statusLabel?: string;
  emptyPrompt?: boolean;
  stickToBottom?: boolean;
  onStickToBottomChange?: (value: boolean) => void;
};

const MemoMessage = memo(
  function MemoMessage({ message }: { message: ChatMessage }) {
    return <MessageView message={message} />;
  },
  (prev, next) => prev.message === next.message,
);

export function Timeline({
  messages,
  running,
  statusLabel,
  emptyPrompt = false,
  stickToBottom = true,
  onStickToBottomChange,
}: TimelineProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const visibleMessages = useMemo(
    () => messages.filter((message) => message.role !== "system"),
    [messages],
  );

  useTimelineScrollEffects({
    scrollerRef,
    bottomRef,
    stickToBottom,
    itemCount: visibleMessages.length,
    running,
    statusLabel,
    onStickToBottomChange,
  });

  if (emptyPrompt) {
    return (
      <div className="flex min-h-0 flex-1 overflow-y-auto px-6 pb-10 pt-2">
        <div className="mx-auto flex w-full max-w-[var(--thread-w)] flex-1">
          <div className="flex flex-1 items-center justify-center text-center text-[26px] font-medium leading-[1.35] text-(--fg)">
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
      ref={scrollerRef}
      data-timeline-scroller
      className="agent-chat-scroller min-h-0 flex-1 overflow-y-auto px-6 pb-1 pt-2 [overflow-anchor:none] [overscroll-behavior:contain] [scroll-behavior:auto] [scrollbar-gutter:stable_both-edges]"
    >
      <div data-timeline-list className="mx-auto flex w-full max-w-[var(--thread-w)] flex-col">
        {visibleMessages.map((message, index) => {
          const isLast = index === visibleMessages.length - 1;
          return (
            <div
              key={message.id}
              className={`pb-4 [overflow-anchor:none] ${isLast ? "" : "[content-visibility:auto] [contain-intrinsic-size:auto_220px]"}`}
            >
              <MemoMessage message={message} />
            </div>
          );
        })}
        {running ? (
          <div className="border-t border-(--border) py-4 [overflow-anchor:none]">
            <div className="flex items-center gap-2 text-[13px] leading-5 text-(--dim)">
              <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-(--dim)" />
              <span className="animate-pulse">Pi is {statusLabel ?? "running"}…</span>
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} aria-hidden="true" className="[overflow-anchor:none]" />
      </div>
    </div>
  );
}
