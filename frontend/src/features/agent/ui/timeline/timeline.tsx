"use client";

import {
  forwardRef,
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
} from "react";
import { Virtuoso, type ListRange, type VirtuosoHandle } from "react-virtuoso";
import type { AssistantBlock, ChatMessage } from "@/features/agent/messages";
import { SessionPaneBlockRouter } from "@/features/agent/ui/timeline/session-pane-block-router";
import { ChevronDownIcon } from "@/ui/icons";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { effectTimeout, type EffectTimer } from "@/lib/effect-timers";
import { patchSessionView, readSessionView } from "@/features/agent/workspace/session-view-state";

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
  viewKey: string | null;
  viewAlias: string | null;
  hasEarlier?: boolean;
  onLoadEarlier?: () => Promise<void> | void;
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
  (previous, next) =>
    previous.message === next.message &&
    previous.live === next.live &&
    previous.running === next.running &&
    previous.onForkSession === next.onForkSession,
);

const TimelineList = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      {...props}
      ref={ref}
      data-timeline-list
      className={`agent-thread-shell mx-auto flex flex-col ${className ?? ""}`}
    />
  ),
);
TimelineList.displayName = "TimelineList";

function initialView(viewKey: string | null, viewAlias: string | null) {
  if (!viewKey || typeof window === "undefined") return null;
  return readSessionView(window.localStorage, {
    key: viewKey,
    aliases: viewAlias ? [viewAlias] : [],
  });
}

function useFirstItemIndex(messages: ChatMessage[]): number {
  const id = messages[0]?.id ?? null;
  const [state, setState] = useState({ first: 1_000_000, id });
  if (state.id === id) return state.first;
  const prepended = state.id ? messages.findIndex((message) => message.id === state.id) : 0;
  const next = { first: state.first - Math.max(0, prepended), id };
  setState(next);
  return next.first;
}

export function Timeline({
  messages,
  running,
  onForkSession,
  emptyPrompt = false,
  stickToBottom = true,
  onStickToBottomChange,
  viewKey,
  viewAlias,
  hasEarlier = false,
  onLoadEarlier,
}: TimelineProps) {
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [range, setRange] = useState<ListRange>({ startIndex: 0, endIndex: 0 });
  const [restored] = useState(() => initialView(viewKey, viewAlias));
  const [mergeCache] = useState(() => new Map<string, MergedRun>());
  const virtuoso = useRef<VirtuosoHandle>(null);
  const stickRef = useRef(restored?.stickToBottom ?? stickToBottom);
  const visibleMessages = useMemo(
    () => mergeConsecutiveAssistantMessages(messages.filter(messageRenders), mergeCache),
    [messages, mergeCache],
  );
  const firstItemIndex = useFirstItemIndex(visibleMessages);
  const lastItemIndex = firstItemIndex + visibleMessages.length - 1;
  const persist = useCallback(() => {
    if (!viewKey || !scroller) return;
    patchSessionView(
      window.localStorage,
      { key: viewKey, aliases: viewAlias ? [viewAlias] : [] },
      { scrollTop: scroller.scrollTop, stickToBottom: stickRef.current },
    );
  }, [scroller, viewAlias, viewKey]);

  useMountSubscription(() => {
    if (restored) onStickToBottomChange?.(restored.stickToBottom);
  }, []);

  useMountSubscription(() => {
    stickRef.current = stickToBottom;
    if (stickToBottom && visibleMessages.length > 0) {
      virtuoso.current?.scrollToIndex({ index: lastItemIndex, align: "end" });
    }
  }, [lastItemIndex, stickToBottom, visibleMessages.length]);

  useMountSubscription(() => {
    if (!scroller) return;
    let timer: EffectTimer | null = null;
    const schedulePersist = () => {
      timer?.cancel();
      timer = effectTimeout(persist, 120);
    };
    scroller.addEventListener("scroll", schedulePersist, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", schedulePersist);
      timer?.cancel();
      persist();
    };
  }, [persist, scroller]);

  const setAtBottom = useCallback(
    (atBottom: boolean) => {
      if (stickRef.current === atBottom) return;
      stickRef.current = atBottom;
      onStickToBottomChange?.(atBottom);
      persist();
    },
    [onStickToBottomChange, persist],
  );

  if (emptyPrompt) {
    return (
      <div className="flex min-h-0 flex-1 overflow-y-auto bg-(--agent-bg) px-6 pb-10 pt-2">
        <div className="agent-thread-shell mx-auto flex flex-1">
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <p className="max-w-[24ch] text-[clamp(1.45rem,2.6vw,2.1rem)] font-semibold leading-[1.22] tracking-[-0.02em] text-(--fg)/90">
              A dream is something you build for yourself.
            </p>
            <p className="text-[length:var(--fs-xl)] text-(--dim)">Just talk to it.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-timeline-frame relative flex min-h-0 min-w-0 flex-1">
      <PromptMarkers
        scroller={scroller}
        messages={visibleMessages}
        activeIndex={Math.max(0, range.startIndex - firstItemIndex)}
        onSelect={(index) =>
          virtuoso.current?.scrollToIndex({ index: firstItemIndex + index, align: "center" })
        }
      />
      <div className="relative flex min-h-0 min-w-0 flex-1">
        <Virtuoso
          ref={virtuoso}
          data-timeline-scroller
          className="agent-chat-scroller min-h-0 min-w-0 flex-1 bg-(--agent-bg) px-4 pb-0 pt-2 [overscroll-behavior:contain] [scrollbar-gutter:stable] sm:px-5"
          data={visibleMessages}
          firstItemIndex={firstItemIndex}
          initialScrollTop={restored && !restored.stickToBottom ? restored.scrollTop : undefined}
          initialTopMostItemIndex={
            (!restored || restored.stickToBottom) && visibleMessages.length > 0
              ? { index: lastItemIndex, align: "end" }
              : undefined
          }
          followOutput={() => (stickRef.current ? "auto" : false)}
          atBottomThreshold={80}
          atBottomStateChange={setAtBottom}
          rangeChanged={setRange}
          scrollerRef={(element) => setScroller(element instanceof HTMLElement ? element : null)}
          computeItemKey={(_index, message) => message.id}
          components={{
            List: TimelineList,
            Header:
              hasEarlier && onLoadEarlier
                ? () => <LoadEarlierButton onLoadEarlier={onLoadEarlier} />
                : undefined,
            Footer:
              running && visibleMessages[visibleMessages.length - 1]?.role !== "assistant"
                ? ThinkingRow
                : undefined,
          }}
          itemContent={(index, message) => {
            const relative = index - firstItemIndex;
            const previous = visibleMessages[relative - 1];
            return (
              <div
                data-timeline-message-id={message.id}
                className={`${message.role === previous?.role ? "pt-2" : "pt-4 sm:pt-6"} ${relative === visibleMessages.length - 1 ? "pb-4" : ""}`}
              >
                <MemoMessage
                  message={message}
                  live={relative === visibleMessages.length - 1 && running}
                  running={running}
                  onForkSession={onForkSession}
                />
              </div>
            );
          }}
        />
        {!stickToBottom && visibleMessages.length > 0 ? (
          <ScrollToBottomButton
            running={running}
            onClick={() => {
              virtuoso.current?.scrollToIndex({
                index: lastItemIndex,
                align: "end",
                behavior: "smooth",
              });
              stickRef.current = true;
              onStickToBottomChange?.(true);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function ThinkingRow() {
  return (
    <div className="agent-thread-shell mx-auto pb-4 pt-4 sm:pt-6">
      <span className="codex-shimmer-text text-[length:var(--fs-base)] font-normal leading-5">
        Thinking
      </span>
    </div>
  );
}

function LoadEarlierButton({ onLoadEarlier }: { onLoadEarlier: () => Promise<void> | void }) {
  const [pending, setPending] = useState(false);
  return (
    <div className="agent-thread-shell mx-auto flex justify-center pt-4">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setPending(true);
          void Promise.resolve(onLoadEarlier()).finally(() => setPending(false));
        }}
        className="inline-flex items-center gap-1.5 rounded-full border border-(--border) bg-(--surface) px-3 py-1 text-[length:var(--fs-xs)] text-(--fg)/70 transition-colors hover:text-(--fg) disabled:opacity-60"
        aria-label="Load earlier messages"
      >
        {pending ? "Loading earlier…" : "Load earlier messages"}
      </button>
    </div>
  );
}

function ScrollToBottomButton({ running, onClick }: { running: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-(--color-popover-border) bg-(--color-popover) px-3 py-1 text-[length:var(--fs-xs)] text-(--fg)/85 shadow-[0_6px_20px_rgba(0,0,0,0.35)] transition-colors hover:text-(--fg)"
      aria-label="Scroll to latest"
    >
      {running ? "New messages" : "Latest"}
      <ChevronDownIcon className="h-3 w-3" />
    </button>
  );
}

const PROMPT_MARKER_HEIGHT_PX = 16;
const PROMPT_MARKER_GAP_PX = 10;

function PromptMarkers({
  scroller,
  messages,
  activeIndex,
  onSelect,
}: {
  scroller: HTMLElement | null;
  messages: ChatMessage[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const prompts = useMemo(
    () =>
      messages.flatMap((message, index) => {
        const label = message.role === "user" ? userPromptLabel(message) : "";
        return label
          ? [{ id: message.id, label, time: formatPromptTime(message.timestamp), index }]
          : [];
      }),
    [messages],
  );
  useMountSubscription(() => {
    if (!scroller) return;
    const update = () => setViewportHeight(scroller.clientHeight);
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    update();
    return () => observer.disconnect();
  }, [scroller]);
  if (!scroller || prompts.length === 0) return null;
  const active = [...prompts].reverse().find((prompt) => prompt.index <= activeIndex) ?? prompts[0];
  const maxCount = Math.max(1, Math.floor((viewportHeight * 0.6 + PROMPT_MARKER_GAP_PX) / 26));
  const activePromptIndex = prompts.indexOf(active);
  const defaultStart = Math.max(0, prompts.length - maxCount);
  const start =
    activePromptIndex < defaultStart
      ? Math.max(0, activePromptIndex - Math.floor(maxCount / 2))
      : defaultStart;
  return (
    <nav className="prompt-minimap" aria-label="Session prompts">
      {prompts.slice(start, start + maxCount).map((prompt) => (
        <button
          key={prompt.id}
          type="button"
          className="prompt-minimap-marker"
          data-current={prompt.id === active.id ? "true" : undefined}
          aria-label={`Scroll to prompt: ${prompt.label}`}
          onMouseEnter={() => setHoveredId(prompt.id)}
          onMouseLeave={() => setHoveredId((value) => (value === prompt.id ? null : value))}
          onFocus={() => setHoveredId(prompt.id)}
          onBlur={() => setHoveredId((value) => (value === prompt.id ? null : value))}
          onClick={(event) => {
            onSelect(prompt.index);
            setHoveredId(null);
            event.currentTarget.blur();
          }}
        >
          <span className="prompt-minimap-line" />
          {hoveredId === prompt.id ? (
            <span className="prompt-minimap-card" role="tooltip">
              <span className="prompt-minimap-card-text">{prompt.label}</span>
              <span className="prompt-minimap-card-time">{prompt.time || "Prompt"}</span>
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}

function userPromptLabel(message: ChatMessage): string {
  const text = message.text.trim();
  if (text) return text.replace(/\s+/g, " ");
  return message.attachments?.map((attachment) => attachment.name).join(", ") ?? "";
}

function formatPromptTime(timestamp?: string): string {
  const value = timestamp?.trim() ?? "";
  if (!value || /^\d{1,2}:\d{2}(?:\s?[AP]M)?$/i.test(value)) return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(
        new Date(parsed),
      )
    : value;
}

type MergedRun = { segments: ChatMessage[]; merged: ChatMessage };

function mergeConsecutiveAssistantMessages(
  messages: ChatMessage[],
  cache: Map<string, MergedRun>,
): ChatMessage[] {
  const merged: ChatMessage[] = [];
  let run: ChatMessage[] = [];
  const flush = () => {
    if (run.length === 1) merged.push(run[0]);
    else if (run.length > 1) merged.push(mergeRun(run, cache));
    run = [];
  };
  for (const message of messages) {
    if (message.role === "assistant") run.push(message);
    else {
      flush();
      merged.push(message);
    }
  }
  flush();
  return merged;
}

function mergeRun(run: ChatMessage[], cache: Map<string, MergedRun>): ChatMessage {
  const first = run[0];
  const cached = cache.get(first.id);
  if (
    cached?.segments.length === run.length &&
    cached.segments.every((segment, index) => segment === run[index])
  ) {
    return cached.merged;
  }
  const merged: ChatMessage = {
    ...first,
    id: first.id,
    text: run
      .map((segment) => segment.text)
      .filter(Boolean)
      .join("\n"),
    blocks: run.flatMap((segment) => segment.blocks ?? []),
    streamCalls: run.flatMap((segment) => segment.streamCalls ?? []),
    timestamp: run.reduce<string | undefined>(
      (timestamp, segment) => segment.timestamp ?? timestamp,
      undefined,
    ),
  };
  if (cache.size >= 512) cache.clear();
  cache.set(first.id, { segments: run, merged });
  return merged;
}

function MessageView({
  message,
  live = false,
  running = false,
  onForkSession,
}: {
  message: ChatMessage;
  live?: boolean;
  running?: boolean;
  onForkSession?: () => void;
}) {
  return (
    <SessionPaneBlockRouter
      message={message}
      live={live}
      running={running}
      onForkSession={onForkSession}
    />
  );
}
