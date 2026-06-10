import { useCallback, useRef, useSyncExternalStore } from "react";

const AT_BOTTOM_THRESHOLD_PX = 80;
const USER_HOLD_MS = 700;

const getTimelineScrollSnapshot = (): number => 0;

/**
 * Keeps the chat locked to the latest message while streaming and re-pins after
 * any layout growth (new tokens, expanded reasoning, async-loaded history), so
 * the view never drifts off the bottom or shifts under the user.
 *
 * Proximity to the bottom is the single source of truth: if the viewport is at
 * the bottom we follow new content, otherwise we leave the user where they are.
 * Content growth neither moves `scrollTop` nor fires a scroll event, so it can
 * never be misread as "the user scrolled up"; only genuine user scrolls and our
 * own pin writes change `scrollTop`, and both classify correctly via `atBottom`.
 *
 * Upward gestures (wheel/touch/keys) detach synchronously with a short hold
 * window, so the user can still escape mid-stream even when a synchronous DOM
 * mutation would otherwise re-pin before the async scroll event is delivered.
 *
 * The scroller and bottom-sentinel are passed as DOM nodes (not refs) so the
 * observers re-attach whenever the elements mount — critical when a session
 * mounts empty (history loads async) and the scroller appears after first paint.
 */
export function useTimelineScrollEffects({
  scroller,
  bottom,
  stickToBottom,
  onStickToBottomChange,
}: {
  scroller: HTMLDivElement | null;
  bottom: HTMLDivElement | null;
  stickToBottom: boolean;
  onStickToBottomChange?: (value: boolean) => void;
}) {
  // Synchronous source of truth the handlers read. The parent's `stickToBottom`
  // prop is the eventually-consistent mirror (drives chrome and lets submit /
  // tab-change force a re-stick); `onChangeRef` reports our changes back to it.
  const stickRef = useRef(stickToBottom);
  const onChangeRef = useRef(onStickToBottomChange);
  // While set, honor a deliberate upward scroll instead of snapping back to the
  // bottom (e.g. the user grazes the threshold while reading recent history).
  const userHoldUntilRef = useRef(0);

  // Mirror prop + callback into refs in the commit phase (never during render).
  const subscribeStickRef = useCallback(() => {
    stickRef.current = stickToBottom;
    return () => undefined;
  }, [stickToBottom]);
  const subscribeOnChangeRef = useCallback(() => {
    onChangeRef.current = onStickToBottomChange;
    return () => undefined;
  }, [onStickToBottomChange]);

  const subscribeScroll = useCallback(() => {
    const el = scroller;
    if (!el) return () => undefined;

    const distanceFromBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = () => distanceFromBottom() <= AT_BOTTOM_THRESHOLD_PX;

    const pinToBottom = () => {
      el.scrollTop = el.scrollHeight;
    };
    const setStick = (next: boolean) => {
      if (stickRef.current === next) return;
      stickRef.current = next;
      onChangeRef.current?.(next);
    };

    const onScroll = () => {
      if (atBottom()) {
        // Briefly respect a deliberate scroll-up near the bottom instead of
        // immediately re-locking and fighting the user.
        if (Date.now() < userHoldUntilRef.current) return;
        setStick(true);
        return;
      }
      setStick(false);
    };

    const holdAndDetach = () => {
      userHoldUntilRef.current = Date.now() + USER_HOLD_MS;
      setStick(false);
    };
    const releaseHold = () => {
      userHoldUntilRef.current = 0;
    };

    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) holdAndDetach();
      else if (event.deltaY > 0) releaseHold();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) holdAndDetach();
      else if (["ArrowDown", "PageDown", "End"].includes(event.key)) releaseHold();
    };
    let touchY: number | null = null;
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? null;
      if (touchY !== null && y !== null) {
        if (y - touchY > 2) holdAndDetach();
        else if (touchY - y > 2) releaseHold();
      }
      touchY = y;
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("keydown", onKeyDown);
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });

    // Follow content + viewport growth while pinned. Running synchronously in the
    // observer callback (before paint) means streaming text and expanding a
    // reasoning block re-pin without a visible shift.
    const listEl = bottom?.parentElement ?? el;
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            if (stickRef.current) pinToBottom();
          });
    resizeObserver?.observe(el);
    if (listEl !== el) resizeObserver?.observe(listEl);

    // Streamed text mutates existing nodes without resizing the observed boxes;
    // keep following those too while pinned.
    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            if (stickRef.current) pinToBottom();
          });
    mutationObserver?.observe(listEl, { childList: true, subtree: true, characterData: true });

    // Initial alignment (also covers async-loaded history once it renders, via
    // the ResizeObserver above).
    if (stickRef.current) pinToBottom();

    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("keydown", onKeyDown);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [bottom, scroller]);

  // When the parent forces stick=true (submit, tab change, session load), snap
  // back to the bottom and clear any lingering hold.
  const subscribeForceStick = useCallback(() => {
    if (stickToBottom && scroller) {
      stickRef.current = true;
      userHoldUntilRef.current = 0;
      scroller.scrollTop = scroller.scrollHeight;
    }
    return () => undefined;
  }, [stickToBottom, scroller]);

  useSyncExternalStore(subscribeStickRef, getTimelineScrollSnapshot, getTimelineScrollSnapshot);
  useSyncExternalStore(subscribeOnChangeRef, getTimelineScrollSnapshot, getTimelineScrollSnapshot);
  useSyncExternalStore(subscribeScroll, getTimelineScrollSnapshot, getTimelineScrollSnapshot);
  useSyncExternalStore(subscribeForceStick, getTimelineScrollSnapshot, getTimelineScrollSnapshot);
}
