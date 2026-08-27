"use client";

import type { ReactNode } from "react";
import { cx } from "./utils";

export interface SegmentedItem<T extends string = string> {
  id: T;
  label: string;
  icon?: ReactNode;
}

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
      aria-orientation="horizontal"
      className={cx(
        "inline-flex items-center gap-0.5 rounded-[var(--ui-radius)] border border-(--ui-separator) bg-(--ui-surface) p-0.5",
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
              "inline-flex items-center gap-1.5 rounded-[5px] transition-[color,background-color,box-shadow] duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--focus-ring) focus-visible:ring-offset-[-1px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
              size === "sm"
                ? "h-6 px-2 text-[length:var(--fs-sm)]"
                : "h-7 px-2.5 text-[length:var(--fs-md)]",
              active
                ? "bg-(--ui-active) text-(--ui-fg)"
                : "text-(--ui-muted) hover:bg-(--ui-hover)/50 hover:text-(--ui-fg)",
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
