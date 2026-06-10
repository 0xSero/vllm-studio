"use client";

import { createContext, useContext, useId, type ReactNode } from "react";
import { cx } from "./utils";

interface UiModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  maxWidth?: string;
}

const UiModalTitleIdContext = createContext<string | null>(null);

function UiModal({ isOpen, onClose, children, className, maxWidth = "max-w-lg" }: UiModalProps) {
  const titleId = useId();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        className="absolute inset-0 z-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close"
      />
      <div
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
