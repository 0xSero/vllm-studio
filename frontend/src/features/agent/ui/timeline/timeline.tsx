"use client";

import { LegendList, type LegendListRef } from "@legendapp/list/react";
import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import type { AssistantBlock, ChatMessage } from "@/features/agent/messages";
import { SessionPaneBlockRouter } from "@/features/agent/ui/timeline/session-pane-block-router";
import { ChevronDownIcon } from "@/ui/icons";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { effectTimeout, type EffectTimer } from "@/lib/effect-timers";
import { patchSessionView, readSessionView } from "@/features/agent/workspace/session-view-state";
import {
  mergeConsecutiveAssistantMessages,
  messageRenders,
  type MergedRun,
} from "@/features/agent/ui/timeline/visible-messages";
import { SubagentActivityRows, type SubagentRun } from "@/features/agent/ui/subagent-activity";

type TimelineProps = {
  messages: ChatMessage[];
  running: boolean;
  cwd: string | null;
  emptyPrompt?: boolean;
  stickToBottom?: boolean;
  onStickToBottomChange?: (value: boolean) => void;
  viewKey: string | null;
  viewAlias: string | null;
  /** Older history remains unread beyond the loaded tail (shows "Load earlier"). */
  hasEarlier?: boolean;
  onLoadEarlier?: () => Promise<void> | void;
  subagents?: readonly SubagentRun[];
};

const MemoMessage = memo(
  function MemoMessage({
    message,
    live,
    running,
    cwd,
  }: {
    message: ChatMessage;
    live: boolean;
    running: boolean;
    cwd: string | null;
  }) {
    return <MessageView message={message} live={live} running={running} cwd={cwd} />;
  },
  (prev, next) =>
    prev.message === next.message &&
    prev.live === next.live &&
    prev.running === next.running &&
    prev.cwd === next.cwd,
);

const TIMELINE_MAINTAIN_SCROLL_AT_END = {
  animated: false,
  on: {
    dataChange: true,
    itemLayout: true,
    layout: true,
  },
} as const;

const TIMELINE_MAINTAIN_VISIBLE_CONTENT_POSITION = {
  data: true,
  size: true,
} as const;

function timelineMessageKey(message: ChatMessage) {
  return message.id;
}

function timelineMessageType(message: ChatMessage) {
  return message.role;
}

export function Timeline({
  messages,
  running,
  cwd,
  emptyPrompt = false,
  stickToBottom = true,
  onStickToBottomChange,
  viewKey,
  viewAlias,
  hasEarlier = false,
  onLoadEarlier,
  subagents = [],
}: TimelineProps) {
  const listRef = useRef<LegendListRef | null>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);

  const [mergeCache] = useState(() => new Map<string, MergedRun>());
  const visibleMessages = useMemo(
    () => mergeConsecutiveAssistantMessages(messages.filter(messageRenders), mergeCache),
    [messages, mergeCache],
  );

  const setListRef = useCallback((list: LegendListRef | null) => {
    listRef.current = list;
    const node = (list?.getScrollableNode() as HTMLDivElement | null) ?? null;
    setScroller((current) => (current === node ? current : node));
  }, []);

  const renderItem = useCallback(
    ({ item: message, index }: { item: ChatMessage; index: number }) => {
      const isLast = index === visibleMessages.length - 1;
      const previousRole = index > 0 ? visibleMessages[index - 1]?.role : null;
      const isGrouped = message.role === previousRole;
      return (
        <div
          data-timeline-message-id={message.id}
          className={`agent-thread-shell mx-auto ${isGrouped ? "pt-1.5" : "pt-3 sm:pt-4"} ${isLast ? "pb-3" : ""}`}
        >
          <MemoMessage message={message} live={isLast && running} running={running} cwd={cwd} />
        </div>
      );
    },
    [cwd, running, visibleMessages],
  );

  const listHeader = useMemo(
    () =>
      hasEarlier && onLoadEarlier ? (
        <div className="agent-thread-shell mx-auto">
          <LoadEarlierButton onLoadEarlier={onLoadEarlier} />
        </div>
      ) : (
        <div className="h-1.5" />
      ),
    [hasEarlier, onLoadEarlier],
  );

  const listFooter = useMemo(
    () => (
      <div className="agent-thread-shell mx-auto pb-3">
        <SubagentActivityRows runs={subagents} />
        {running && visibleMessages[visibleMessages.length - 1]?.role !== "assistant" ? (
          <div className="pt-3 sm:pt-4">
            <span className="codex-shimmer-text text-[length:var(--fs-base)] font-normal leading-5">
              Thinking
            </span>
          </div>
        ) : null}
      </div>
    ),
    [running, subagents, visibleMessages],
  );

  useTimelineScrollEffects({
    scroller,
    listRef,
    stickToBottom,
    onStickToBottomChange,
    viewKey,
    viewAlias,
  });

  if (emptyPrompt) {
    return (
      <div className="agent-chat-empty flex min-h-0 flex-1 bg-(--agent-bg)" aria-hidden="true" />
    );
  }

  return (
    <div className="agent-timeline-frame relative flex min-h-0 min-w-0 flex-1">
      <PromptMarkers scroller={scroller} listRef={listRef} messages={visibleMessages} />
      <div className="relative flex min-h-0 min-w-0 flex-1">
        <LegendList<ChatMessage>
          ref={setListRef}
          data={visibleMessages}
          keyExtractor={timelineMessageKey}
          getItemType={timelineMessageType}
          renderItem={renderItem}
          estimatedItemSize={144}
          initialScrollAtEnd
          maintainScrollAtEnd={stickToBottom ? TIMELINE_MAINTAIN_SCROLL_AT_END : false}
          maintainVisibleContentPosition={TIMELINE_MAINTAIN_VISIBLE_CONTENT_POSITION}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
          data-timeline-scroller
          className="agent-chat-scroller min-h-0 min-w-0 flex-1 overflow-y-auto bg-(--agent-bg) px-3 pb-0 pt-1.5 [overflow-anchor:auto] [overscroll-behavior:contain] [scroll-behavior:auto] [scrollbar-gutter:stable] sm:px-4"
        />
        {!stickToBottom && visibleMessages.length > 0 ? (
          <ScrollToBottomButton
            running={running}
            onClick={() => {
              void listRef.current?.scrollToEnd({ animated: true });
              onStickToBottomChange?.(true);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Top-of-thread affordance for tail-loaded sessions: fetches the previous page
 * of older history and prepends it. Rendered only while a history cursor
 * remains (older events exist beyond what is loaded). */
function LoadEarlierButton({ onLoadEarlier }: { onLoadEarlier: () => Promise<void> | void }) {
  const [pending, setPending] = useState(false);
  return (
    <div className="flex justify-center pt-4">
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

/** Floating "jump to latest" affordance, shown only when the user has scrolled
 * up off the bottom. Nudges to "New messages" while a turn is streaming. */
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
const PROMPT_MARKER_MAX_RATIO = 0.6;

type PromptMarkerEntry = {
  id: string;
  label: string;
  time: string;
  rowIndex: number;
};

function PromptMarkers({
  scroller,
  listRef,
  messages,
}: {
  scroller: HTMLElement | null;
  listRef: RefObject<LegendListRef | null>;
  messages: ChatMessage[];
}) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const prompts = useMemo(
    () =>
      messages
        .map((message, rowIndex) => ({ message, rowIndex }))
        .filter(({ message }) => message.role === "user" && userPromptLabel(message).length > 0)
        .map(({ message, rowIndex }) => ({
          id: message.id,
          label: userPromptLabel(message),
          time: formatPromptTime(message.timestamp),
          rowIndex,
        })),
    [messages],
  );
  const viewportHeight = useScrollerViewportHeight(scroller);
  const activeId = useActivePromptId(scroller, listRef, prompts);
  if (!scroller || prompts.length === 0) return null;
  const maxCount = Math.max(
    1,
    Math.floor(
      (viewportHeight * PROMPT_MARKER_MAX_RATIO + PROMPT_MARKER_GAP_PX) /
        (PROMPT_MARKER_HEIGHT_PX + PROMPT_MARKER_GAP_PX),
    ),
  );
  // The rail shows a window of prompts. It normally sits at the newest end, but
  // slides back so the prompt you have scrolled to stays represented.
  const activeIndex = activeId ? prompts.findIndex((prompt) => prompt.id === activeId) : -1;
  let windowStart = Math.max(0, prompts.length - maxCount);
  if (activeIndex >= 0 && activeIndex < windowStart) {
    windowStart = Math.max(0, activeIndex - Math.floor(maxCount / 2));
  }
  const visible =
    prompts.length > maxCount ? prompts.slice(windowStart, windowStart + maxCount) : prompts;
  const scrollToPrompt = (rowIndex: number) => {
    void listRef.current?.scrollToIndex({
      index: rowIndex,
      animated: true,
      viewPosition: 0.5,
    });
  };
  return (
    <nav className="prompt-minimap" aria-label="Session prompts">
      {visible.map((marker) => {
        const active = hoveredId === marker.id;
        return (
          <button
            key={marker.id}
            type="button"
            className="prompt-minimap-marker"
            data-current={marker.id === activeId ? "true" : undefined}
            aria-label={`Scroll to prompt: ${marker.label}`}
            onMouseEnter={() => setHoveredId(marker.id)}
            onMouseLeave={() => setHoveredId((value) => (value === marker.id ? null : value))}
            onFocus={() => setHoveredId(marker.id)}
            onBlur={() => setHoveredId((value) => (value === marker.id ? null : value))}
            onClick={(event) => {
              scrollToPrompt(marker.rowIndex);
              setHoveredId(null);
              event.currentTarget.blur();
            }}
          >
            <span className="prompt-minimap-line" />
            {active ? (
              <span className="prompt-minimap-card" role="tooltip">
                <span className="prompt-minimap-card-text">{marker.label}</span>
                <span className="prompt-minimap-card-time">{marker.time || "Prompt"}</span>
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

/** How far below the top of the viewport a prompt has to be before it counts as
 *  the one you are reading. Roughly one header's worth of slack. */
const ACTIVE_PROMPT_OFFSET_PX = 96;

/** Scroll-spy for the prompt rail: which prompt is currently in view. The rail
 *  used to hardcode the highlight to the newest marker, so scrolling back
 *  through a long thread left the indicator stuck at the end. */
function useActivePromptId(
  scroller: HTMLElement | null,
  listRef: RefObject<LegendListRef | null>,
  prompts: PromptMarkerEntry[],
): string | null {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!scroller) return () => undefined;
      // Scroll fires far faster than we can usefully re-render; coalesce to one
      // read per frame.
      let frame = 0;
      const notify = () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          onStoreChange();
        });
      };
      scroller.addEventListener("scroll", notify, { passive: true });
      const resizeObserver = new ResizeObserver(notify);
      resizeObserver.observe(scroller);
      return () => {
        scroller.removeEventListener("scroll", notify);
        resizeObserver.disconnect();
        if (frame) cancelAnimationFrame(frame);
      };
    },
    [scroller],
  );
  const getSnapshot = useCallback(() => {
    if (!scroller || prompts.length === 0) return null;
    const state = listRef.current?.getState();
    const threshold = (state?.scroll ?? scroller.scrollTop) + ACTIVE_PROMPT_OFFSET_PX;
    let active: string | null = null;
    for (const prompt of prompts) {
      const top = state?.positionAtIndex?.(prompt.rowIndex);
      if (typeof top === "number" && top > threshold) break;
      active = prompt.id;
    }
    return active ?? prompts[0]?.id ?? null;
  }, [listRef, prompts, scroller]);
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

function useScrollerViewportHeight(scroller: HTMLElement | null): number {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!scroller) return () => undefined;
      const resizeObserver = new ResizeObserver(onStoreChange);
      resizeObserver.observe(scroller);
      return () => resizeObserver.disconnect();
    },
    [scroller],
  );
  return useSyncExternalStore(
    subscribe,
    () => scroller?.clientHeight ?? 0,
    () => 0,
  );
}

function userPromptLabel(message: ChatMessage): string {
  const text = message.text.trim();
  if (text) return text.replace(/\s+/g, " ");
  if (message.attachments?.length) {
    return message.attachments.map((attachment) => attachment.name).join(", ");
  }
  return "";
}

function formatPromptTime(timestamp?: string): string {
  const value = timestamp?.trim() ?? "";
  if (!value) return "";
  if (/^\d{1,2}:\d{2}(?:\s?[AP]M)?$/i.test(value)) return value;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(parsed),
  );
}

const AT_BOTTOM_THRESHOLD_PX = 40;
const USER_HOLD_MS = 700;

function useTimelineScrollEffects({
  scroller,
  listRef,
  stickToBottom,
  onStickToBottomChange,
  viewKey,
  viewAlias,
}: {
  scroller: HTMLElement | null;
  listRef: RefObject<LegendListRef | null>;
  stickToBottom: boolean;
  onStickToBottomChange?: (value: boolean) => void;
  viewKey: string | null;
  viewAlias: string | null;
}) {
  const stickRef = useRef(stickToBottom);
  const onChangeRef = useRef(onStickToBottomChange);
  const userHoldUntilRef = useRef(0);

  useMountSubscription(() => {
    stickRef.current = stickToBottom;
  }, [stickToBottom]);
  useMountSubscription(() => {
    onChangeRef.current = onStickToBottomChange;
  }, [onStickToBottomChange]);

  useMountSubscription(() => {
    const el = scroller;
    if (!el) return;
    const viewIdentity = viewKey ? { key: viewKey, aliases: viewAlias ? [viewAlias] : [] } : null;
    const restored = viewIdentity ? readSessionView(window.localStorage, viewIdentity) : null;
    let pendingRestoreTop = restored && !restored.stickToBottom ? restored.scrollTop : null;
    let persistTimer: EffectTimer | null = null;

    const distanceFromBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = () => distanceFromBottom() <= AT_BOTTOM_THRESHOLD_PX;

    const restoreScrollTop = () => {
      if (pendingRestoreTop === null) return;
      const maximum = Math.max(0, el.scrollHeight - el.clientHeight);
      el.scrollTop = Math.min(pendingRestoreTop, maximum);
      if (maximum >= pendingRestoreTop) pendingRestoreTop = null;
    };
    const persist = () => {
      if (!viewIdentity) return;
      persistTimer?.cancel();
      persistTimer = effectTimeout(() => {
        patchSessionView(window.localStorage, viewIdentity, {
          scrollTop: el.scrollTop,
          stickToBottom: stickRef.current,
        });
      }, 120);
    };
    const setStick = (next: boolean) => {
      if (stickRef.current === next) return;
      stickRef.current = next;
      onChangeRef.current?.(next);
      persist();
    };

    const onScroll = () => {
      if (pendingRestoreTop !== null) {
        restoreScrollTop();
        if (pendingRestoreTop !== null) return;
      }
      if (atBottom()) {
        if (Date.now() < userHoldUntilRef.current) return;
        setStick(true);
        persist();
        return;
      }
      setStick(false);
      persist();
    };

    const holdAndDetach = () => {
      pendingRestoreTop = null;
      userHoldUntilRef.current = Date.now() + USER_HOLD_MS;
      setStick(false);
    };
    const releaseHold = () => {
      pendingRestoreTop = null;
      userHoldUntilRef.current = 0;
    };

    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) holdAndDetach();
      else if (event.deltaY > 0) releaseHold();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) holdAndDetach();
      else if (["ArrowDown", "PageDown", "End"].includes(event.key)) releaseHold();
      if (["Enter", " "].includes(event.key)) preserveDisclosureAnchor(event.target);
    };
    let anchorFrame: number | null = null;
    const preserveDisclosureAnchor = (target: EventTarget | null) => {
      if (!(target instanceof Element) || !target.closest("summary, [aria-expanded]")) return;
      if (anchorFrame !== null) cancelAnimationFrame(anchorFrame);
      if (stickRef.current) {
        anchorFrame = requestAnimationFrame(() => {
          anchorFrame = requestAnimationFrame(() => {
            anchorFrame = null;
            void listRef.current?.scrollToEnd({ animated: false });
          });
        });
        return;
      }
      const scrollerTop = el.getBoundingClientRect().top;
      const rows = [...el.querySelectorAll<HTMLElement>("[data-timeline-message-id]")];
      const anchor = rows.find((row) => row.getBoundingClientRect().bottom > scrollerTop);
      if (!anchor) return;
      const before = anchor.getBoundingClientRect().top;
      anchorFrame = requestAnimationFrame(() => {
        anchorFrame = requestAnimationFrame(() => {
          anchorFrame = null;
          el.scrollTop += anchor.getBoundingClientRect().top - before;
        });
      });
    };
    const onPointerDown = (event: PointerEvent) => preserveDisclosureAnchor(event.target);
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("pointerdown", onPointerDown, true);

    let restoreFrame: number | null = null;
    let restoreAttempts = 0;
    const scheduleRestore = () => {
      restoreFrame = window.requestAnimationFrame(() => {
        restoreFrame = null;
        restoreScrollTop();
        restoreAttempts += 1;
        if (pendingRestoreTop !== null && restoreAttempts < 3) scheduleRestore();
      });
    };

    if (restored) {
      stickRef.current = restored.stickToBottom;
      onChangeRef.current?.(restored.stickToBottom);
    }
    if (stickRef.current) void listRef.current?.scrollToEnd({ animated: false });
    else scheduleRestore();

    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("pointerdown", onPointerDown, true);
      if (anchorFrame !== null) cancelAnimationFrame(anchorFrame);
      if (restoreFrame !== null) window.cancelAnimationFrame(restoreFrame);
      persistTimer?.cancel();
      if (viewIdentity) {
        patchSessionView(window.localStorage, viewIdentity, {
          scrollTop: el.scrollTop,
          stickToBottom: stickRef.current,
        });
      }
    };
  }, [scroller, viewKey, viewAlias]);

  useMountSubscription(() => {
    if (stickToBottom && scroller) {
      stickRef.current = true;
      userHoldUntilRef.current = 0;
      void listRef.current?.scrollToEnd({ animated: false });
    }
  }, [listRef, stickToBottom, scroller]);
}

function MessageView({
  message,
  live = false,
  running = false,
  cwd = null,
}: {
  message: ChatMessage;
  live?: boolean;
  running?: boolean;
  cwd?: string | null;
}) {
  return <SessionPaneBlockRouter message={message} live={live} running={running} cwd={cwd} />;
}
