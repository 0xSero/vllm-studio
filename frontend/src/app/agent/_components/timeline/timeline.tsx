import type { RefObject, UIEventHandler } from "react";
import type { ChatMessage } from "@/lib/agent/session";
import { MessageView } from "./message-view";

type TimelineProps = {
  messages: ChatMessage[];
  running: boolean;
  statusLabel?: string;
  emptyPrompt?: boolean;
  scrollRef?: RefObject<HTMLDivElement | null>;
  onScroll?: UIEventHandler<HTMLDivElement>;
};

export function Timeline({
  messages,
  running,
  statusLabel,
  emptyPrompt = false,
  scrollRef,
  onScroll,
}: TimelineProps) {
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className={`min-h-0 flex-1 overflow-y-auto px-6 pb-10 pt-2 ${emptyPrompt ? "flex" : ""}`}
    >
      <div className={`mx-auto w-full max-w-[var(--thread-w)] ${emptyPrompt ? "flex flex-1" : ""}`}>
        {emptyPrompt ? (
          <div className="flex flex-1 items-center justify-center text-center text-[26px] font-medium leading-[1.35] text-(--fg)">
            <p className="max-w-[680px]">
              A dream is something you build for yourself.
              <br />
              Just talk to it.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {messages
              .filter((m) => m.role !== "system")
              .map((message) => (
                <MessageView key={message.id} message={message} />
              ))}
            {running ? (
              <div className="flex items-center gap-2 py-4 text-xs text-(--dim)">
                <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-(--accent)" />
                <span className="animate-pulse">Pi is {statusLabel ?? "running"}…</span>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
