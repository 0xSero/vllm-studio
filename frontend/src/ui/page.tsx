"use client";

import type { ReactNode } from "react";
import { cx } from "./utils";
import { Tabs, type TabItem } from "./tabs";

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
        "h-full min-h-0 overflow-y-auto overflow-x-hidden bg-(--ui-bg) text-(--ui-fg)",
        className,
      )}
    >
      {children}
    </main>
  );
}

export function AppContentColumn({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("mx-auto w-full max-w-[72rem] px-4 pb-12 pt-6 sm:px-8 lg:pt-8", className)}>
      {children}
    </div>
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
        "mx-auto w-full px-3 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-4 sm:pt-4",
        pageWidthClasses[width],
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  status,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-3 flex min-h-7 items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 className="sr-only truncate text-[length:var(--fs-lg)] font-medium tracking-[-0.015em] text-(--ui-fg) md:not-sr-only">
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-[length:var(--fs-sm)] text-(--ui-muted)">{description}</p>
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
                "group grid h-6 max-w-[calc(50%_-_0.125rem)] min-w-0 grid-cols-[14px_minmax(0,1fr)] items-center gap-1.5 rounded-[4px] px-1.5 text-left text-[length:var(--fs-xs)] transition-[color,background-color] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--ui-accent)/35 sm:max-w-none lg:w-full",
                active
                  ? "bg-(--ui-active) text-(--ui-fg)"
                  : "text-(--ui-muted) hover:bg-(--ui-hover)/70 hover:text-(--ui-fg)",
              )}
              title={item.description}
            >
              <span
                className={cx(
                  "flex h-3 w-3 items-center justify-center text-(--ui-muted) [&_svg]:h-3 [&_svg]:w-3",
                  active ? "opacity-100" : "opacity-70 group-hover:opacity-100",
                )}
              >
                {item.icon}
              </span>
              <span className="truncate font-normal">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function TabbedPage<T extends string = string>({
  title,
  description,
  actions,
  width = "sm",
  tabs,
  activeTab,
  onSelectTab,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  width?: PageWidth;
  tabs: TabItem<T>[];
  activeTab: T;
  onSelectTab: (tab: T) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <AppPage>
      <PageContainer width={width} className={cx("pt-3 sm:pt-4", className)}>
        <PageHeader title={title} description={description} actions={actions} />
        <div className="mt-4 border-b border-(--ui-separator)">
          <Tabs items={tabs} activeTab={activeTab} onSelectTab={onSelectTab} className="-mb-px" />
        </div>
        <div className="mt-4">{children}</div>
      </PageContainer>
    </AppPage>
  );
}
