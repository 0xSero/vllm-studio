"use client";

import { NewTaskIcon, SettingsIcon, X } from "@/ui/icon-registry";
import type { ProjectsNavSectionComponent } from "@/features/shell/left-sidebar-lazy";
import {
  NavItemMobile,
  ProjectsNavPlaceholder,
  isRouteActive,
  tabs,
} from "@/features/shell/left-sidebar-nav";

export function MobileNavigationDrawer({
  pathname,
  projectsNavReady,
  ProjectsNavSection,
  onClose,
  onNewTask,
}: {
  pathname: string;
  projectsNavReady: boolean;
  ProjectsNavSection: ProjectsNavSectionComponent | null;
  onClose: () => void;
  onNewTask: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
      <button
        type="button"
        className="absolute inset-0 h-full w-full bg-black/60"
        aria-label="Close navigation menu"
        onClick={onClose}
      />
      <aside
        id="mobile-navigation-drawer"
        className="mobile-pwa-drawer absolute right-0 top-0 flex h-full w-full flex-col bg-(--bg) md:w-[min(22rem,88vw)] md:border-l md:border-(--border)"
      >
        <div className="mobile-pwa-drawer-header flex shrink-0 items-center justify-between gap-3 px-4">
          <div className="min-w-0 truncate text-[19px] font-semibold tracking-[-0.01em] text-(--fg)">
            Local Studio
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(--surface) text-(--fg)/70 transition-colors hover:text-(--fg)"
            aria-label="Close navigation menu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="min-h-0 flex-1 touch-pan-y overscroll-contain overflow-y-auto px-3 pb-4 pt-1">
          <NavItemMobile
            href="/agent?new=1&replace=1"
            label="New task"
            Icon={NewTaskIcon}
            active={false}
            onClick={(event) => {
              onClose();
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onNewTask();
            }}
          />
          {tabs.map((tab) => (
            <NavItemMobile
              key={tab.href}
              href={tab.href}
              label={tab.label}
              Icon={tab.icon}
              active={isRouteActive(pathname, tab.href)}
              onClick={onClose}
            />
          ))}
          <NavItemMobile
            href="/settings"
            label="Settings"
            Icon={SettingsIcon}
            active={isRouteActive(pathname, "/settings")}
            onClick={onClose}
          />
          <div className="h-4" />
          {projectsNavReady ? (
            ProjectsNavSection ? (
              <ProjectsNavSection expanded view="projects" />
            ) : (
              <ProjectsNavPlaceholder />
            )
          ) : null}
        </nav>
      </aside>
    </div>
  );
}
