import { useCallback, useRef, useSyncExternalStore, type RefObject } from "react";

const AT_BOTTOM_THRESHOLD_PX = 64;

const getTimelineScrollSnapshot = (): number => 0;

/**
 * Keeps the chat pinned to the latest message while streaming, yields to the
 * user the moment they intentionally scroll up to read history, and re-pins when
 * they return to the bottom.
 *
 * Detach is driven by genuine *user intent* (wheel-up, upward touch drag, or the
 * scroll-up keys) rather than by a raw decrease in `scrollTop`. That distinction
 * matters here because the timeline renders with `content-visibility:auto` +
 * `contain-intrinsic-size`: off-screen items resolve their real heights mid-
 * stream and can momentarily shift `scrollTop` downward. A pure direction
 * heuristic mistakes that layout shift for a user scroll-up and unpins — the
 * "auto-scroll sometimes stops" bug. Re-attach is driven by an
 * IntersectionObserver on the bottom sentinel, so reaching the bottom by any
 * means re-pins. Our own follow-writes never set intent, so they can't detach.
 */
export function useTimelineScrollEffects({
  scrollerRef,
  bottomRef,
  stickToBottom,
  onStickToBottomChange,
}: {
  scrollerRef: RefObject<HTMLDivElement | null>;
  bottomRef: RefObject<HTMLDivElement | null>;
  stickToBottom: boolean;
  onStickToBottomChange?: (value: boolean) => void;
}) {
  // Synchronous source of truth the handlers read. The parent's `stickToBottom`
  // prop is the eventually-consistent mirror (drives chrome and lets submit /
  // tab-change force a re-stick); `onChangeRef` reports our changes back to it.
  const stickRef = useRef(stickToBottom);
  const onChangeRef = useRef(onStickToBottomChange);

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
    const el = scrollerRef.current;
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

    // User intent: an upward gesture detaches immediately. A downward gesture
    // that lands at the bottom re-attaches (the sentinel observer also covers
    // re-attach, but handling it here makes the wheel case feel instant).
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) setStick(false);
      else if (atBottom()) setStick(true);
    };
    let touchY: number | null = null;
    const onTouchStart = (event: TouchEvent) => {
      touchY = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? null;
      if (touchY !== null && y !== null && y - touchY > 2) setStick(false);
      touchY = y;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) setStick(false);
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("keydown", onKeyDown);

    // Re-attach whenever the bottom sentinel scrolls back into view by any means.
    const sentinel = bottomRef.current;
    const intersectionObserver =
      typeof IntersectionObserver === "undefined" || !sentinel
        ? null
        : new IntersectionObserver(
            (entries) => {
              if (entries.some((entry) => entry.isIntersecting)) setStick(true);
            },
            { root: el, rootMargin: `0px 0px ${AT_BOTTOM_THRESHOLD_PX}px 0px` },
          );
    if (sentinel) intersectionObserver?.observe(sentinel);

    // Follow content + viewport growth while pinned. Running synchronously in the
    // observer callback means a growth never momentarily reads as "not at bottom".
    const listEl = sentinel?.parentElement ?? el;
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

    // Initial alignment.
    if (stickRef.current) pinToBottom();

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("keydown", onKeyDown);
      intersectionObserver?.disconnect();
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [bottomRef, scrollerRef]);

  // When the parent forces stick=true (submit, tab change, jump-to-latest) and we
  // aren't already near the bottom, snap down. Guarded so re-sticking from a
  // graze of the bottom doesn't cause a visible jump.
  const subscribeForceStick = useCallback(() => {
    const el = scrollerRef.current;
    if (
      stickToBottom &&
      el &&
      el.scrollHeight - el.scrollTop - el.clientHeight > AT_BOTTOM_THRESHOLD_PX
    ) {
      el.scrollTop = el.scrollHeight;
    }
    return () => undefined;
  }, [stickToBottom, scrollerRef]);

  useSyncExternalStore(subscribeStickRef, getTimelineScrollSnapshot, getTimelineScrollSnapshot);
  useSyncExternalStore(subscribeOnChangeRef, getTimelineScrollSnapshot, getTimelineScrollSnapshot);
  useSyncExternalStore(subscribeScroll, getTimelineScrollSnapshot, getTimelineScrollSnapshot);
  useSyncExternalStore(subscribeForceStick, getTimelineScrollSnapshot, getTimelineScrollSnapshot);
}
