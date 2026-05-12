import { useEffect, type RefObject } from "react";

/**
 * Closes a popover / dropdown when the user clicks anywhere outside the
 * referenced element. Idempotent — when `open` is false the listener is not
 * registered. The callback identity is captured per render via a ref pattern
 * so re-renders don't tear down the subscription.
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onOutside: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(event.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [ref, open, onOutside]);
}
