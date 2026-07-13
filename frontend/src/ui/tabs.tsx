"use client";

import type { ReactNode } from "react";

type TabVariant = "underline" | "pill" | "button-group";

interface TabItem<T extends string = string> {
  id: T;
  label: string;
  icon?: ReactNode;
}

interface TabsProps<T extends string = string> {
  variant?: TabVariant;
  items: TabItem<T>[];
  activeTab: T;
  onSelectTab: (tab: T) => void;
  className?: string;
}

function Tabs<T extends string = string>({
  variant = "underline",
  items,
  activeTab,
  onSelectTab,
  className = "",
}: TabsProps<T>) {
  if (variant === "underline") {
    return (
      <div className={`flex gap-1 ${className}`}>
        {items.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === tab.id
                ? "border-(--ui-accent) text-(--ui-fg)"
                : "border-transparent text-(--ui-muted) hover:text-(--ui-fg)"
            }`}
          >
            {tab.icon && <span className="inline mr-2">{tab.icon}</span>}
            {tab.label}
          </button>
        ))}
      </div>
    );
  }

  if (variant === "pill") {
    return (
      <div className={`flex gap-1 overflow-x-auto ${className}`}>
        {items.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-[length:var(--fs-base)] whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? "bg-(--active) font-medium text-(--fg)"
                : "text-(--color-foreground-subtle) hover:bg-(--hover) hover:text-(--fg)"
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
    );
  }

  // button-group
  return (
    <div className={`overflow-x-auto ${className}`}>
      <div className="flex min-w-max items-center gap-2 rounded-full border border-(--ui-border) bg-(--surface-3) p-1">
        {items.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelectTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full transition-colors text-xs sm:text-sm whitespace-nowrap border ${
              activeTab === tab.id
                ? "border-transparent bg-(--active) text-(--ui-fg)"
                : "border-transparent text-(--ui-muted) hover:border-(--ui-border) hover:text-(--ui-fg)"
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export { Tabs };
export type { TabsProps, TabItem, TabVariant };
