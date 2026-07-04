"use client";

import type { ReactNode } from "react";
import { RefreshCw } from "@/ui/icon-registry";
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

export type PageWidth = "sm" | "md" | "lg" | "xl";

const pageWidthClasses: Record<PageWidth, string> = {
  sm: "max-w-[64rem]",
  md: "max-w-[86rem]",
  lg: "max-w-[92rem]",
  xl: "max-w-[118rem]",
};

export function PageContainer({
  width = "md",
  children,
  className,
}: {
  width?: PageWidth;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "mx-auto w-full px-4 pt-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-6",
        pageWidthClasses[width],
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  status,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex min-h-8 items-center justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="text-[length:var(--fs-xs)] uppercase tracking-[0.14em] text-(--ui-muted)">
            {eyebrow}
          </div>
        ) : null}
        <h2 className="mt-1 truncate text-[length:var(--fs-3xl)] font-medium tracking-[-0.02em] text-(--ui-fg)">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-[length:var(--fs-sm)] text-(--ui-muted)">{description}</p>
        ) : null}
      </div>
      {(actions ?? status) ? (
        <div className="flex shrink-0 items-center gap-2 text-[length:var(--fs-sm)] text-(--ui-muted)">
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
    <nav aria-label={label} className="pb-1">
      <div className="flex flex-wrap gap-1 lg:flex-col lg:flex-nowrap">
        {items.map((item) => {
          const active = activeItem === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectItem(item.id)}
              className={cx(
                "group relative grid h-8 max-w-[calc(50%_-_0.125rem)] min-w-0 grid-cols-[18px_minmax(0,1fr)] items-center gap-2.5 rounded-md px-2.5 text-left text-[length:var(--fs-md)] transition-colors sm:max-w-none lg:w-full",
                active
                  ? "bg-(--color-surface) text-(--ui-fg)"
                  : "text-(--color-foreground-subtle) hover:bg-(--color-surface-hover) hover:text-(--ui-fg)",
              )}
              title={item.description}
            >
              {active ? (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded-full bg-(--color-sky-400)"
                />
              ) : null}
              <span
                className={cx(
                  "flex h-4 w-4 items-center justify-center",
                  active ? "text-(--color-sky-400) opacity-100" : "opacity-70",
                )}
              >
                {item.icon}
              </span>
              <span className={cx("truncate", active ? "font-medium" : "")}>{item.label}</span>
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
