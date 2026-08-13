import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import type { ChatMessage } from "@/features/agent/messages";

const OVERSCAN_SCREENS = 1.5;
const SEEK_SCREENS = 2;
const RESERVED_MESSAGE_HEIGHT_PX = 320;
const TAIL_RENDER_COUNT = 8;
const EMPTY_WINDOW: ReadonlySet<string> = new Set<string>();

type WindowedMessage = Pick<ChatMessage, "id" | "role">;

type TimelineWindow = {
  renders: (index: number) => boolean;
  reservedHeight: (id: string) => number;
};

function focusedMessageId(scroller: HTMLElement): string | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !scroller.contains(active)) return null;
  return (
    active.closest<HTMLElement>("[data-timeline-message-id]")?.dataset.timelineMessageId ?? null
  );
}

function scanViewport(scroller: HTMLElement, heights: Map<string, number>): ReadonlySet<string> {
  const view = scroller.getBoundingClientRect();
  const overscan = view.height * OVERSCAN_SCREENS;
  const focused = focusedMessageId(scroller);
  const visible = new Set<string>(focused ? [focused] : []);
  for (const node of scroller.querySelectorAll<HTMLElement>("[data-timeline-message-id]")) {
    const id = node.dataset.timelineMessageId;
    if (!id) continue;
    const rect = node.getBoundingClientRect();
    if (!node.hasAttribute("data-timeline-reserved")) heights.set(id, rect.height);
    if (rect.bottom >= view.top - overscan && rect.top <= view.bottom + overscan) visible.add(id);
  }
  return visible;
}

function sameWindow(next: ReadonlySet<string>, previous: ReadonlySet<string>): boolean {
  if (next.size !== previous.size) return false;
  for (const id of next) if (!previous.has(id)) return false;
  return true;
}

export function useTimelineWindow(
  scroller: HTMLElement | null,
  messages: readonly WindowedMessage[],
): TimelineWindow {
  const [heights] = useState(() => new Map<string, number>());
  const windowRef = useRef(EMPTY_WINDOW);
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const list = scroller?.querySelector<HTMLElement>("[data-timeline-list]");
      if (!scroller || !list) return () => undefined;
      let frame = 0;
      let seekTop = scroller.scrollTop;
      const scan = () => {
        frame = 0;
        if (scroller.clientHeight === 0) return;
        const travelled = Math.abs(scroller.scrollTop - seekTop);
        seekTop = scroller.scrollTop;
        if (travelled > scroller.clientHeight * SEEK_SCREENS) {
          schedule();
          return;
        }
        const next = scanViewport(scroller, heights);
        if (sameWindow(next, windowRef.current)) return;
        windowRef.current = next;
        onStoreChange();
      };
      const schedule = () => {
        if (frame) return;
        frame = requestAnimationFrame(scan);
      };
      scroller.addEventListener("scroll", schedule, { passive: true });
      const resizeObserver = new ResizeObserver(schedule);
      resizeObserver.observe(scroller);
      resizeObserver.observe(list);
      return () => {
        scroller.removeEventListener("scroll", schedule);
        resizeObserver.disconnect();
        if (frame) cancelAnimationFrame(frame);
      };
    },
    [heights, scroller],
  );
  const visible = useSyncExternalStore(
    subscribe,
    () => windowRef.current,
    () => EMPTY_WINDOW,
  );
  return {
    renders: (index) =>
      index >= messages.length - TAIL_RENDER_COUNT ||
      messages[index].role === "user" ||
      visible.has(messages[index].id),
    reservedHeight: (id) => heights.get(id) ?? RESERVED_MESSAGE_HEIGHT_PX,
  };
}
