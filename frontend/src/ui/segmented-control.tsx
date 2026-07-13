"use client";

import type { ReactNode } from "react";
import { cx } from "./utils";

export interface SegmentedItem<T extends string = string> {
  id: T;
  label: string;
  icon?: ReactNode;
}

/** A standardized segmented control (pill-in-a-track) for small mode choices. */
export function SegmentedControl<T extends string = string>({
  items,
  value,
  onChange,
  size = "md",
  disabled = false,
  className,
}: {
  items: SegmentedItem<T>[];
  value: T;
  onChange: (id: T) => void;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cx(
        "inline-flex items-center gap-0.5 rounded-full border border-(--ui-border) bg-(--surface-3) p-0.5",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(item.id)}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              size === "sm"
                ? "px-2 py-0.5 text-[length:var(--fs-sm)]"
                : "px-2.5 py-1 text-[length:var(--fs-md)]",
              active
                ? "bg-(--ui-surface) text-(--ui-fg) shadow-sm"
                : "text-(--ui-muted) hover:text-(--ui-fg)",
            )}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
