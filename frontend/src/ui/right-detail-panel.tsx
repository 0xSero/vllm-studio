"use client";

import type { ReactNode } from "react";
import { X } from "@/ui/icon-registry";
import { Button } from "./button";
import { cx } from "./utils";

export type RightDetailPanelProps = {
  open: boolean;
  title: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  widthClassName?: string;
  className?: string;
};

export function RightDetailPanel({
  open,
  title,
  icon,
  actions,
  children,
  onClose,
  widthClassName = "w-full sm:w-[min(560px,calc(100vw-64px))]",
  className,
}: RightDetailPanelProps) {
  if (!open) return null;

  return (
    <aside
      className={cx(
        "fixed inset-y-0 right-0 z-50 flex flex-col border-l border-(--ui-border) bg-(--ui-surface) shadow-2xl",
        widthClassName,
        className,
      )}
      aria-label="Details"
    >
      <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-(--ui-border) px-4">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <h2 className="truncate text-[length:var(--fs-lg)] font-semibold text-(--ui-fg)">
            {title}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {actions}
          <Button variant="icon" size="sm" onClick={onClose} title="Close details">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}
