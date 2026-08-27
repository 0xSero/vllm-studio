"use client";

import { NewTaskIcon, SearchIcon, SettingsIcon } from "@/ui/icon-registry";
import { Drawer, DrawerHeader, DrawerOverlay } from "@/ui/drawer";
import type { ProjectsNavSectionComponent } from "@/features/shell/left-sidebar-lazy";
import {
  NavItemMobile,
  primaryTabs,
  customizeTab,
  ProjectsNavPlaceholder,
  isRouteActive,
} from "@/features/shell/left-sidebar-nav";

export function MobileNavigationDrawer({
  pathname,
  projectsNavReady,
  ProjectsNavSection,
  onClose,
  onNewTask,
  onOpenSearch,
}: {
  pathname: string;
  projectsNavReady: boolean;
  ProjectsNavSection: ProjectsNavSectionComponent | null;
  onClose: () => void;
  onNewTask: () => void;
  onOpenSearch: () => void;
}) {
  return (
    <DrawerOverlay onClose={onClose} className="md:hidden">
      <Drawer
        id="mobile-navigation-drawer"
        fullBleed
        className="mobile-pwa-drawer h-full bg-(--bg)"
      >
        <DrawerHeader
          title={
            <span className="text-[13px] font-medium tracking-[-0.01em] text-(--fg)">
              Local Studio
            </span>
          }
          onClose={onClose}
          className="mobile-pwa-drawer-header h-10 px-3"
        />

        <nav className="min-h-0 flex-1 touch-pan-y overscroll-contain overflow-y-auto px-3 pb-4 pt-1">
          <NavItemMobile
            href="/agent?new=1&replace=1"
            label="New task"
            Icon={NewTaskIcon}
            active={pathname === "/agent"}
            onClick={(event) => {
              onClose();
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onNewTask();
            }}
          />
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenSearch();
            }}
            className="flex h-10 w-full items-center gap-2.5 rounded-[4px] px-3 text-left text-[12px] text-(--fg)/80 transition-colors active:bg-(--hover)"
          >
            <SearchIcon className="h-[15px] w-[15px] shrink-0" />
            <span>Search</span>
          </button>
          {primaryTabs.map((tab) => (
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
            href={customizeTab.href}
            label={customizeTab.label}
            Icon={customizeTab.icon}
            active={isRouteActive(pathname, customizeTab.href)}
            onClick={onClose}
          />
          <div className="h-3" />
          {projectsNavReady ? (
            ProjectsNavSection ? (
              <ProjectsNavSection expanded view="projects" />
            ) : (
              <ProjectsNavPlaceholder />
            )
          ) : null}
          <NavItemMobile
            href="/settings"
            label="Settings"
            Icon={SettingsIcon}
            active={isRouteActive(pathname, "/settings")}
            onClick={onClose}
          />
        </nav>
      </Drawer>
    </DrawerOverlay>
  );
}
