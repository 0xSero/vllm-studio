"use client";

import Link from "next/link";
import { ProfileFooter } from "@/features/shell/profile-footer";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  BellIcon,
  ChevronLeft,
  ChevronRight,
  SearchIcon,
  NewTaskIcon,
  PanelLeftHollow,
  PanelLeftFilled,
} from "@/ui/icon-registry";
import type { NavView, ProjectsNavSectionComponent } from "@/features/shell/left-sidebar-lazy";
import {
  NavItemDesktop,
  NavActionDesktop,
  ProjectsNavPlaceholder,
  primaryTabs,
  customizeTab,
  isRouteActive,
  SETTINGS_SIDEBAR_PORTAL_ID,
} from "@/features/shell/left-sidebar-nav";

const HISTORY_STEPPER_CLASS =
  "flex h-7 w-7 items-center justify-center rounded-[5px] text-(--hl2) opacity-0 transition-[opacity,color,background-color] duration-[var(--motion-fast)] hover:bg-(--hover) hover:text-(--fg) focus-visible:opacity-100 group-hover/sidebar:opacity-70";

function handleDesktopSidebarKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const candidates = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex="0"]',
    ),
  ).filter(
    (element) => element.offsetParent !== null && element.getAttribute("aria-hidden") !== "true",
  );
  if (candidates.length === 0) return;
  const current =
    target instanceof Element ? target.closest<HTMLElement>("a, button, [tabindex]") : null;
  const currentIndex = current ? candidates.indexOf(current) : -1;
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? candidates.length - 1
        : event.key === "ArrowUp"
          ? Math.max(0, currentIndex - 1)
          : Math.min(candidates.length - 1, currentIndex + 1);
  event.preventDefault();
  candidates[nextIndex]?.focus();
}

export function DesktopSidebar({
  pathname,
  isExpanded,
  width,
  resizing,
  projectsNavReady,
  ProjectsNavSection,
  onStartResize,
  onResizeKeyDown,
  onResetWidth,
  onRevealProjectsNav,
  onSetPinnedOpen,
  onOpenSearch,
  navView,
  onToggleNavView,
  runningSessions,
  finishedSessions,
  onNewTask,
  onNavigateBack,
  onNavigateForward,
}: {
  pathname: string;
  isExpanded: boolean;
  width: number;
  resizing: boolean;
  projectsNavReady: boolean;
  ProjectsNavSection: ProjectsNavSectionComponent | null;
  onStartResize: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onResetWidth: () => void;
  onRevealProjectsNav: () => void;
  onSetPinnedOpen: (open: boolean) => void;
  onOpenSearch: () => void;
  navView: NavView;
  onToggleNavView: () => void;
  runningSessions: number;
  finishedSessions: number;
  onNewTask: () => void;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
}) {
  const settingsMode = pathname.startsWith("/settings");
  return (
    <aside
      onPointerEnter={onRevealProjectsNav}
      onFocusCapture={onRevealProjectsNav}
      className={`group/sidebar relative hidden md:flex sticky top-0 h-[100dvh] border-r border-(--border) bg-(--sidebar-bg) flex-col shrink-0 z-40 ${
        isExpanded ? "overflow-hidden" : "overflow-visible border-r-0 bg-transparent"
      } ${
        resizing
          ? ""
          : "transition-[width] duration-[var(--motion-fast)] ease-[var(--ease-standard)]"
      }`}
      style={{
        width: isExpanded ? `${width}px` : 0,
      }}
    >
      {isExpanded ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          aria-valuemin={194}
          aria-valuemax={360}
          aria-valuenow={width}
          tabIndex={0}
          title="Resize sidebar"
          onMouseDown={onStartResize}
          onDoubleClick={onResetWidth}
          onKeyDown={onResizeKeyDown}
          className="group absolute right-0 top-0 z-[60] h-full w-2 cursor-col-resize"
        >
          <span
            className={`absolute inset-y-0 right-0 w-px transition-colors duration-[var(--motion-fast)] ${
              resizing ? "bg-(--accent)/55" : "bg-transparent group-hover:bg-(--fg)/12"
            }`}
          />
        </div>
      ) : null}
      {!isExpanded ? (
        <div className="absolute left-[calc(0.5rem+var(--desktop-titlebar-left-inset))] top-2 z-[70] flex h-7 w-7 shrink-0 items-center justify-center">
          <button
            onClick={() => onSetPinnedOpen(true)}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-transparent text-(--hl2) transition-colors hover:bg-(--hover) hover:text-(--fg)"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <PanelLeftHollow className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      ) : null}
      <div
        aria-hidden={!isExpanded}
        className={`flex min-h-0 flex-1 flex-col overflow-hidden transition-opacity duration-[var(--motion-fast)] ${
          isExpanded ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div className="sticky top-0 z-50 flex h-9 shrink-0 items-center gap-0.5 bg-(--sidebar-bg) pr-2 pl-[calc(0.5rem+var(--desktop-titlebar-left-inset))]">
          <button
            onClick={() => onSetPinnedOpen(false)}
            className="flex h-7 w-7 items-center justify-center rounded-[5px] text-(--hl2) transition-colors duration-[var(--motion-fast)] hover:bg-(--hover) hover:text-(--fg)"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <PanelLeftFilled className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <div className="min-w-0 flex-1" />
          <span className="flex h-7 w-8 shrink-0 items-center justify-center">
            <SessionStatus running={runningSessions} finished={finishedSessions} />
          </span>
          <button
            onClick={onNavigateBack}
            className={HISTORY_STEPPER_CLASS}
            title="Go back"
            aria-label="Go back"
          >
            <ChevronLeft className="h-3 w-3" strokeWidth={1.75} />
          </button>
          <button
            onClick={onNavigateForward}
            className={HISTORY_STEPPER_CLASS}
            title="Go forward"
            aria-label="Go forward"
          >
            <ChevronRight className="h-3 w-3" strokeWidth={1.75} />
          </button>
          <button
            onClick={onToggleNavView}
            aria-pressed={navView === "notifications"}
            className="flex h-7 w-7 items-center justify-center rounded-[5px] text-(--hl2) opacity-0 transition-[opacity,color,background-color] duration-[var(--motion-fast)] hover:bg-(--hover) hover:text-(--fg) focus-visible:opacity-100 group-hover/sidebar:opacity-70 aria-pressed:opacity-100 aria-pressed:text-(--fg)"
            title={navView === "notifications" ? "Show projects" : "Show notifications"}
            aria-label={navView === "notifications" ? "Show projects" : "Show notifications"}
          >
            <BellIcon className="h-4 w-4" />
          </button>
        </div>

        <div
          role="navigation"
          aria-label={settingsMode ? "Settings" : "Primary"}
          onKeyDown={handleDesktopSidebarKeyDown}
          className="sidebar-scroller flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-[var(--sidebar-padding-x)] py-1 [contain:layout_paint]"
        >
          {settingsMode ? (
            <div id={SETTINGS_SIDEBAR_PORTAL_ID} className="flex min-h-0 flex-1 flex-col" />
          ) : (
            <>
              <div className="flex shrink-0 flex-col gap-[var(--sidebar-row-gap)]">
                <Link
                  href="/agent?new=1&replace=1"
                  prefetch={false}
                  onPointerUp={(event) => event.currentTarget.blur()}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    onNewTask();
                  }}
                  className="group flex h-[var(--sidebar-row-height)] shrink-0 items-center gap-2 rounded-[var(--sidebar-row-radius)] px-2 text-(--fg)/90 transition-[background-color,color,box-shadow] duration-[var(--motion-fast)] hover:bg-(--hover) hover:text-(--fg) focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--focus-ring) focus-visible:ring-offset-[-1px] active:bg-(--active)/70"
                  title="New task"
                >
                  <NewTaskIcon className="h-4 w-4 shrink-0 opacity-80" />
                  <span className="flex-1 truncate text-left text-[length:var(--fs-md)] font-medium">
                    New task
                  </span>
                  <kbd className="w-7 text-right text-[10px] leading-4 text-(--dim) opacity-0 transition-opacity duration-[var(--motion-fast)] group-hover:opacity-100">
                    ⌘N
                  </kbd>
                </Link>
                <NavActionDesktop
                  label="Search"
                  Icon={SearchIcon}
                  shortcut="⌘K"
                  onClick={onOpenSearch}
                />
                {primaryTabs.map((tab) => (
                  <NavItemDesktop
                    key={tab.href}
                    href={tab.href}
                    label={tab.label}
                    Icon={tab.icon}
                    active={isRouteActive(pathname, tab.href)}
                  />
                ))}
                <NavItemDesktop
                  href={customizeTab.href}
                  label={customizeTab.label}
                  Icon={customizeTab.icon}
                  active={isRouteActive(pathname, customizeTab.href)}
                />
              </div>
              {projectsNavReady ? (
                ProjectsNavSection ? (
                  <ProjectsNavSection expanded={isExpanded} view={navView} />
                ) : (
                  <ProjectsNavPlaceholder />
                )
              ) : null}
            </>
          )}
        </div>

        <div className="shrink-0 bg-(--sidebar-bg) px-[var(--sidebar-padding-x)] pb-2 pt-1">
          <ProfileFooter settingsActive={isRouteActive(pathname, "/settings")} />
        </div>
      </div>
    </aside>
  );
}

function SessionStatus({ running, finished }: { running: number; finished: number }) {
  if (running > 0) {
    return (
      <span
        className="flex shrink-0 items-center gap-1 rounded-md px-1 text-[length:var(--fs-xs)] tabular-nums text-(--hl2) opacity-0 transition-opacity group-hover/sidebar:opacity-70"
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
        className="flex shrink-0 items-center gap-1 rounded-md px-1 text-[length:var(--fs-xs)] tabular-nums text-(--hl2) opacity-0 transition-opacity group-hover/sidebar:opacity-70"
        title={`${finished} ${finished === 1 ? "session" : "sessions"} finished while you were away`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-(--ok)/60" aria-hidden />
        {finished}
      </span>
    );
  }
  return null;
}
