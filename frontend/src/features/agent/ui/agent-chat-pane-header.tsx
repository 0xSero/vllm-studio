"use client";

import { Menu } from "@/ui/icon-registry";
import { useAppStore } from "@/store";

export function AgentChatPaneHeader({ title }: { title: string }) {
  const setMobileNavOpen = useAppStore((state) => state.setMobileNavOpen);
  return (
    <div className="grid h-[var(--h-toolbar-pane)] shrink-0 grid-cols-[1fr_minmax(0,auto)_1fr] items-center border-b border-(--separator) bg-(--color-header) px-2">
      <div className="flex min-w-0 items-center justify-start">
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          className="-ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-(--dim) hover:bg-(--hover) hover:text-(--fg) md:hidden"
          aria-label="Open navigation menu"
          aria-controls="mobile-navigation-drawer"
        >
          <Menu className="pointer-events-none h-[18px] w-[18px]" />
        </button>
      </div>
      <div
        className="max-w-[min(36rem,60vw)] truncate whitespace-nowrap text-center text-[length:var(--fs-lg)] font-medium leading-none tracking-[-0.015em] text-(--fg)"
        title={title}
      >
        {title}
      </div>
      <div />
    </div>
  );
}
