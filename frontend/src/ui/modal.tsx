"use client";

import { createContext, useContext, useId, useRef, useState, type ReactNode } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { cx } from "./utils";

interface UiModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  maxWidth?: string;
}

const UiModalTitleIdContext = createContext<string | null>(null);

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableElements(dialog: HTMLDivElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) =>
      element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true",
  );
}

function UiModal({ isOpen, onClose, children, className, maxWidth = "max-w-lg" }: UiModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [callbacks] = useState(() => ({ onClose }));
  callbacks.onClose = onClose;

  useMountSubscription(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    const focusables = focusableElements(dialog);
    (focusables[0] ?? dialog).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        callbacks.onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const current = focusableElements(dialog);
      if (!current.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = current[0];
      const last = current[current.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0 z-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(
          "relative z-10 w-full rounded-xl border border-(--ui-border) bg-(--ui-surface) shadow-xl",
          maxWidth,
          className,
        )}
      >
        <UiModalTitleIdContext.Provider value={titleId}>{children}</UiModalTitleIdContext.Provider>
      </div>
    </div>
  );
}

interface UiModalHeaderProps {
  title: string;
  icon?: ReactNode;
  onClose?: () => void;
  actions?: ReactNode;
  closeLabel?: string;
  className?: string;
  showCloseButton?: boolean;
  closeIcon?: ReactNode;
}

function UiModalHeader({
  title,
  icon,
  onClose,
  actions,
  closeLabel = "Close",
  className,
  showCloseButton = true,
  closeIcon,
}: UiModalHeaderProps) {
  const titleId = useContext(UiModalTitleIdContext);

  return (
    <div
      className={cx(
        "flex items-center justify-between border-b border-(--ui-border) px-6 py-4",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {icon}
        <h2 id={titleId ?? undefined} className="text-lg font-semibold">
          {title}
        </h2>
      </div>
      <div className="flex items-center gap-2">
        {actions}
        {showCloseButton && onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 hover:bg-(--ui-hover)"
            aria-label={closeLabel}
          >
            {closeIcon ?? "x"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export { UiModal, UiModalHeader };
export type { UiModalProps, UiModalHeaderProps };
