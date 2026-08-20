"use client";

import { NewTaskIcon, SettingsIcon } from "@/ui/icon-registry";
import { Drawer, DrawerHeader, DrawerOverlay } from "@/ui/drawer";
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
    <DrawerOverlay onClose={onClose} className="md:hidden">
      <Drawer
        id="mobile-navigation-drawer"
        fullBleed
        // `mobile-pwa-drawer` carries the safe-area insets, the slide-in
        // animation and the phone type scale; the shared Drawer supplies the
        // surface, so the PWA class only has to keep doing the PWA parts.
        className="mobile-pwa-drawer h-full bg-(--bg)"
      >
        <DrawerHeader
          title={
            <span className="text-[19px] font-semibold tracking-[-0.01em] text-(--fg)">
              Local Studio
            </span>
          }
          onClose={onClose}
          className="mobile-pwa-drawer-header h-auto px-4"
        />

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
      </Drawer>
    </DrawerOverlay>
  );
}
