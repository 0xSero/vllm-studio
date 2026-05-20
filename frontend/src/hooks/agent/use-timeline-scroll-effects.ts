import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const AT_BOTTOM_THRESHOLD_PX = 64;
const RETURN_TO_BOTTOM_IDLE_MS = 250;

export function useTimelineScrollEffects({
  scrollerRef,
  bottomRef,
  stickToBottom,
  itemCount,
  running,
  statusLabel,
  onStickToBottomChange,
}: {
  scrollerRef: RefObject<HTMLDivElement | null>;
  bottomRef: RefObject<HTMLDivElement | null>;
  stickToBottom: boolean;
  itemCount: number;
  running: boolean;
  statusLabel?: string;
  onStickToBottomChange?: (value: boolean) => void;
}) {
  // `stickRef` is the SYNCHRONOUS source of truth that the layout effect
  // consults. The parent's `stickToBottom` prop is the eventually-consistent
  // mirror used for UI like a "jump to latest" button. We flip the ref
  // immediately on user input so streaming `scrollIntoView` writes never
  // fight a user scroll-up gesture mid-frame (which is the visible "shake").
  const stickRef = useRef(stickToBottom);
  useEffect(() => {
    stickRef.current = stickToBottom;
  }, [stickToBottom]);

  // Cache the callback in a ref so listener registration never re-binds
  // when the parent hands us a new function identity per render.
  const onChangeRef = useRef(onStickToBottomChange);
  useEffect(() => {
    onChangeRef.current = onStickToBottomChange;
  }, [onStickToBottomChange]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let rafId: number | null = null;
    let returnTimer: number | null = null;
    // `programmaticScroll` lets us ignore scroll events emitted by our own
    // `scrollIntoView` writes; otherwise a sticky scroll would immediately
    // re-evaluate atBottom against a transient layout and toggle state.
    let programmaticScrollUntil = 0;

    const evaluate = () => {
      rafId = null;
      if (performance.now() < programmaticScrollUntil) return;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_THRESHOLD_PX;

      if (!atBottom && stickRef.current) {
        // User started scrolling up. Detach IMMEDIATELY so streaming content
        // can no longer yank the viewport via scrollIntoView. Tell the
        // parent on the same tick so any chrome (jump-to-latest button)
        // updates promptly.
        stickRef.current = false;
        onChangeRef.current?.(false);
        if (returnTimer != null) {
          window.clearTimeout(returnTimer);
          returnTimer = null;
        }
        return;
      }

      if (atBottom && !stickRef.current) {
        // Don't re-stick the moment the user grazes the bottom — wait until
        // they've been idle there. This prevents inertial rubber-banding
        // from causing rapid stick/unstick oscillation.
        if (returnTimer != null) return;
        returnTimer = window.setTimeout(() => {
          returnTimer = null;
          const stillAtBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_THRESHOLD_PX;
          if (stillAtBottom) {
            stickRef.current = true;
            onChangeRef.current?.(true);
          }
        }, RETURN_TO_BOTTOM_IDLE_MS);
      }
    };

    const onScroll = () => {
      if (rafId != null) return;
      rafId = window.requestAnimationFrame(evaluate);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    // Expose a marker the layout effect can set when it programmatically
    // scrolls, so we don't misread our own writes as user input.
    (el as HTMLElement & { __markProgrammaticScroll?: () => void }).__markProgrammaticScroll =
      () => {
        programmaticScrollUntil = performance.now() + 80;
      };

    return () => {
      el.removeEventListener("scroll", onScroll);
      if (rafId != null) window.cancelAnimationFrame(rafId);
      if (returnTimer != null) window.clearTimeout(returnTimer);
      delete (el as HTMLElement & { __markProgrammaticScroll?: () => void })
        .__markProgrammaticScroll;
    };
  }, [scrollerRef]);

  useLayoutEffect(() => {
    if (!stickRef.current) return;
    const sentinel = bottomRef.current;
    const scroller = scrollerRef.current as
      | (HTMLElement & { __markProgrammaticScroll?: () => void })
      | null;
    if (!sentinel) return;
    scroller?.__markProgrammaticScroll?.();
    sentinel.scrollIntoView({ block: "end" });
  }, [bottomRef, scrollerRef, itemCount, running, statusLabel]);
}
