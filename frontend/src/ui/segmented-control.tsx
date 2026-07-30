"use client";

import type { ReactNode } from "react";
import { cx } from "./utils";

export interface SegmentedItem<T extends string = string> {
  id: T;
  label: string;
  icon?: ReactNode;
}

export function nextSegmentedIndex(current: number, length: number, key: string): number | null {
  if (length <= 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (key === "ArrowRight" || key === "ArrowDown") return (current + 1) % length;
  if (key === "ArrowLeft" || key === "ArrowUp") return (current - 1 + length) % length;
  return null;
}

export function SegmentedControl<T extends string = string>({
  items,
  value,
  onChange,
  size = "md",
  disabled = false,
  className,
  ariaLabel,
}: {
  items: SegmentedItem<T>[];
  value: T;
  onChange: (id: T) => void;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
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
            tabIndex={active ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => {
              const tabs = Array.from(
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]:not(:disabled)',
                ) ?? [],
              );
              const current = tabs.indexOf(event.currentTarget);
              const next = nextSegmentedIndex(current, tabs.length, event.key);
              if (next === null) return;
              event.preventDefault();
              const nextItem = items[next];
              if (nextItem) onChange(nextItem.id);
              tabs[next]?.focus();
            }}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-[calc(var(--ui-radius)-2px)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) disabled:cursor-not-allowed disabled:opacity-50",
              size === "sm"
                ? "px-2 py-0.5 text-[length:var(--fs-sm)]"
                : "px-2.5 py-1 text-[length:var(--fs-md)]",
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
