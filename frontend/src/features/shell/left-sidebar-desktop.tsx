"use client";

import Link from "next/link";
import { ProfileFooter } from "@/features/shell/profile-footer";
import { type MouseEvent as ReactMouseEvent } from "react";
import {
  BellIcon,
  ChevronLeft,
  ChevronRight,
  SearchIcon,
  NewTaskIcon,
  SettingsIcon,
  PanelLeftHollow,
  PanelLeftFilled,
} from "@/ui/icon-registry";
import type { NavView, ProjectsNavSectionComponent } from "@/features/shell/left-sidebar-lazy";
import {
  NavItemDesktop,
  ProjectsNavPlaceholder,
  isRouteActive,
  tabs,
} from "@/features/shell/left-sidebar-nav";

const HISTORY_STEPPER_CLASS =
  "flex h-6 w-6 items-center justify-center rounded-md text-(--hl2) transition-colors hover:bg-(--hover) hover:text-(--fg)";

export function DesktopSidebar({
  pathname,
  isExpanded,
  width,
  resizing,
  projectsNavReady,
  ProjectsNavSection,
  onStartResize,
  onRevealProjectsNav,
  onSetPinnedOpen,
  onOpenSearch,
  navView,
  onToggleNavView,
  runningSessions,
  finishedSessions,
  onNewTask,
}: {
  pathname: string;
  isExpanded: boolean;
  width: number;
  resizing: boolean;
  projectsNavReady: boolean;
  ProjectsNavSection: ProjectsNavSectionComponent | null;
  onStartResize: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onRevealProjectsNav: () => void;
  onSetPinnedOpen: (open: boolean) => void;
  onOpenSearch: () => void;
  navView: NavView;
  onToggleNavView: () => void;
  runningSessions: number;
  finishedSessions: number;
  onNewTask: () => void;
}) {
  return (
    <aside
      onPointerEnter={onRevealProjectsNav}
      onFocusCapture={onRevealProjectsNav}
      className={`relative hidden md:flex sticky top-0 h-[100dvh] border-r border-(--border) bg-(--sidebar-bg) flex-col shrink-0 z-40 overflow-hidden ${
        resizing ? "" : "transition-[width] duration-150 ease-out"
      }`}
      style={{
        width: isExpanded ? `${width}px` : 44,
      }}
    >
      {isExpanded ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          title="Resize sidebar"
          onMouseDown={onStartResize}
          className={`absolute right-0 top-0 z-[60] h-full w-2 cursor-col-resize transition-colors ${
            resizing ? "bg-(--fg)/10" : "hover:bg-(--fg)/8"
          }`}
        />
      ) : null}
      {!isExpanded ? (
        <div className="flex h-[var(--h-toolbar)] shrink-0 items-center justify-center">
          <button
            onClick={() => onSetPinnedOpen(true)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-(--hl2) transition-colors hover:bg-(--hover) hover:text-(--fg)"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <PanelLeftHollow className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      ) : null}
      <div
        className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
          isExpanded ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {isExpanded ? (
          <>
            <div className="sticky top-0 z-50 flex h-[var(--h-toolbar)] shrink-0 items-center gap-1 bg-(--sidebar-bg) px-2">
              <button
                onClick={() => onSetPinnedOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-(--hl2) transition-colors hover:bg-(--hover) hover:text-(--fg)"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <PanelLeftFilled className="h-3 w-3" strokeWidth={1.75} />
              </button>
              <button
                onClick={() => window.history.back()}
                className={HISTORY_STEPPER_CLASS}
                title="Go back"
                aria-label="Go back"
              >
                <ChevronLeft className="h-3 w-3" strokeWidth={1.75} />
              </button>
              <button
                onClick={() => window.history.forward()}
                className={HISTORY_STEPPER_CLASS}
                title="Go forward"
                aria-label="Go forward"
              >
                <ChevronRight className="h-3 w-3" strokeWidth={1.75} />
              </button>
              {/* Search is an icon here rather than a row of its own: it reclaims
                  a full row for the content the sidebar actually exists to list. */}
              <button
                onClick={onOpenSearch}
                className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-(--hl2) transition-colors hover:bg-(--hover) hover:text-(--fg)"
                title="Search sessions (⌘K)"
                aria-label="Search sessions"
              >
                <SearchIcon className="h-4 w-4" />
              </button>
              {/* Session state, stated rather than hinted. The bell used to
                  carry a bare blue dot that meant "something happened" and
                  nothing more; a count of what is running — or of what finished
                  while you were elsewhere — is the thing you actually wanted to
                  know, and it reads without opening anything. */}
              <SessionStatus running={runningSessions} finished={finishedSessions} />
              {/* The bell swaps what the nav below lists — notifications when
                  lit, the project tree otherwise — so it reads as a view toggle.
                  Pressed is a foreground shift only, matching the other chrome
                  buttons: a filled pill here sat lit whenever the notifications
                  view was open, which read as a stuck hover state. */}
              <button
                onClick={onToggleNavView}
                aria-pressed={navView === "notifications"}
                className="flex h-7 w-7 items-center justify-center rounded-md text-(--hl2) transition-colors hover:bg-(--hover) hover:text-(--fg) aria-pressed:text-(--fg)"
                title={navView === "notifications" ? "Show projects" : "Show notifications"}
                aria-label={navView === "notifications" ? "Show projects" : "Show notifications"}
              >
                <BellIcon className="h-4 w-4" />
              </button>
            </div>

            <nav className="sidebar-scroller flex min-h-0 flex-1 flex-col gap-[var(--sidebar-row-gap)] overflow-x-hidden overflow-y-auto px-[var(--sidebar-padding-x)] py-0.5 [contain:layout_paint]">
              <Link
                href="/agent?new=1&replace=1"
                prefetch={false}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  onNewTask();
                }}
                className="flex h-[var(--sidebar-row-height)] shrink-0 items-center gap-2 rounded-[var(--sidebar-row-radius)] px-2 text-(--fg)/85 transition-colors hover:bg-(--hover) hover:text-(--fg)"
                title="New task"
              >
                <NewTaskIcon className="h-4 w-4 shrink-0 opacity-70" />
                <span className="flex-1 truncate text-left text-[length:var(--fs-md)] font-normal">
                  New task
                </span>
              </Link>
              {tabs.map((tab) => (
                <NavItemDesktop
                  key={tab.href}
                  href={tab.href}
                  label={tab.label}
                  Icon={tab.icon}
                  active={isRouteActive(pathname, tab.href)}
                />
              ))}
              {projectsNavReady ? (
                ProjectsNavSection ? (
                  <ProjectsNavSection expanded={isExpanded} view={navView} />
                ) : (
                  <ProjectsNavPlaceholder />
                )
              ) : null}
            </nav>

            <div className="shrink-0 bg-(--sidebar-bg) px-[var(--sidebar-padding-x)] pb-2 pt-1">
              <ProfileFooter settingsActive={isRouteActive(pathname, "/settings")} />
            </div>
          </>
        ) : null}
      </div>
    </aside>
  );
}

/**
 * What the sessions are doing, in the width of a chip.
 *
 * Running wins over finished: a live run is the thing you might want to go
 * watch, and a finished one will still be there afterwards. Nothing renders
 * when nothing is happening, so the resting nav stays quiet.
 */
function SessionStatus({ running, finished }: { running: number; finished: number }) {
  if (running > 0) {
    return (
      <span
        className="flex shrink-0 items-center gap-1 rounded-md px-1.5 text-[length:var(--fs-xs)] tabular-nums text-(--hl2)"
        title={`${running} ${running === 1 ? "session is" : "sessions are"} running`}
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-(--ok)" aria-hidden />
        {running}
      </span>
    );
  }
  if (finished > 0) {
    return (
      <span
        className="flex shrink-0 items-center gap-1 rounded-md px-1.5 text-[length:var(--fs-xs)] tabular-nums text-(--hl2)"
        title={`${finished} ${finished === 1 ? "session" : "sessions"} finished while you were away`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-(--ok)/60" aria-hidden />
        {finished}
      </span>
    );
  }
  return null;
}
