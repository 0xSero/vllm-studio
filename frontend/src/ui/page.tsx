"use client";

import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { cx } from "./utils";

export type SectionNavItem<Id extends string = string> = {
  id: Id;
  label: string;
  description: string;
  icon: ReactNode;
};

export function AppPage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main
      className={cx(
        "min-h-full overflow-y-auto overflow-x-hidden bg-(--ui-bg) text-(--ui-fg)",
        className,
      )}
    >
      {children}
    </main>
  );
}

export function PageHeader({
  eyebrow,
  title,
  status,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex min-h-8 items-center justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="text-[10px] uppercase tracking-[0.14em] text-(--ui-muted)">{eyebrow}</div>
        ) : null}
        <h2 className="mt-1 truncate text-[20px] font-medium tracking-[-0.02em] text-(--ui-fg)">
          {title}
        </h2>
      </div>
      {(actions ?? status) ? (
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-(--ui-muted)">
          {status}
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export function SectionNav<Id extends string = string>({
  label,
  items,
  activeItem,
  onSelectItem,
}: {
  label: string;
  items: SectionNavItem<Id>[];
  activeItem: Id;
  onSelectItem: (item: Id) => void;
}) {
  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto pb-1 lg:mx-0 lg:overflow-visible">
      <div className="flex min-w-max gap-1 lg:min-w-0 lg:flex-col">
        {items.map((item) => {
          const active = activeItem === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectItem(item.id)}
              className={cx(
                "group grid h-8 grid-cols-[18px_1fr] items-center gap-2.5 rounded-md px-2.5 text-left text-[12px] transition-colors lg:w-full",
                active
                  ? "bg-(--ui-hover) text-(--ui-fg)"
                  : "text-(--ui-muted) hover:bg-(--ui-hover) hover:text-(--ui-fg)",
              )}
              title={item.description}
            >
              <span className="flex h-4 w-4 items-center justify-center opacity-80">
                {item.icon}
              </span>
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function RefreshIconButton({
  onClick,
  loading,
  label,
}: {
  onClick: () => void;
  loading?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-(--ui-muted) transition-colors hover:bg-(--ui-hover) hover:text-(--ui-fg) disabled:opacity-50"
      aria-label={label}
      title={label}
    >
      <RefreshCw className={cx("h-3.5 w-3.5", loading ? "animate-spin" : "")} />
    </button>
  );
}
