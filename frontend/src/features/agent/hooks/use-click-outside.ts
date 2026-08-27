import { type RefObject } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onOutside: () => void,
): void {
  useMountSubscription(() => {
    if (!open || typeof document === "undefined") return;
    const frame = requestAnimationFrame(() => {
      ref.current?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')?.focus();
    });
    const onDocClick = (event: PointerEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(event.target as Node)) {
        onOutside();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onOutside();
      ref.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus();
    };
    document.addEventListener("pointerdown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [ref, open, onOutside]);
}
