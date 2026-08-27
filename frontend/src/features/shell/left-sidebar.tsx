"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Suspense,
  useCallback,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Menu } from "@/ui/icon-registry";
import { useShallow } from "zustand/react/shallow";
import { DEFAULT_SIDEBAR_WIDTH, useAppStore } from "@/store";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { useOpenSessions, useSessionActivity } from "@/features/agent/session-index";
import { hrefWithOpenNonce } from "@/features/agent/ui/projects-nav/helpers";
import { DesktopSidebar } from "@/features/shell/left-sidebar-desktop";
import {
  loadProjectsNavSection,
  loadSessionsCommand,
  type NavView,
  type ProjectsNavSectionComponent,
  type SessionsCommandComponent,
} from "@/features/shell/left-sidebar-lazy";
import { MobileNavigationDrawer } from "@/features/shell/left-sidebar-mobile-drawer";
import {
  mobilePageTitle,
  routeHidesAppSidebar,
  routeOwnsMobileHeader,
} from "@/features/shell/left-sidebar-nav";
import { WorkbenchTabStrip } from "@/features/workbench/workbench-tab-strip";
import {
  setWorkbenchSidebar,
  useWorkbenchPreferences,
} from "@/features/workbench/controller-state";

type PaletteMode = "search" | null;

type SidebarResizeInteraction = {
  cleanup: () => void;
  frame: number | null;
  pendingWidth: number;
  sidebar: HTMLElement;
};

const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 480;
const MIN_WORKSPACE_WIDTH = 560;
const LAST_WORKSPACE_URL_KEY = "local-studio:last-workspace-url";
function clampSidebarWidth(width: number, maxWidth = SIDEBAR_MAX_WIDTH): number {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH;
  return Math.min(maxWidth, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

export function LeftSidebar({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const hidesAppSidebar = routeHidesAppSidebar(pathname);
  const ownsThreadTabs = pathname === "/agent";
  const projectsNavImmediate = !hidesAppSidebar;
  const { mobileMenuOpen, setMobileMenuOpen } = useAppStore(
    useShallow((s) => ({
      mobileMenuOpen: s.mobileNavOpen,
      setMobileMenuOpen: s.setMobileNavOpen,
    })),
  );
  const { sidebarPinnedOpen: isExpanded, sidebarWidth } = useWorkbenchPreferences();
  const setSidebarWidth = useCallback(
    (width: number) => setWorkbenchSidebar({ sidebarWidth: width }),
    [],
  );
  const setSidebarPinnedOpen = useCallback(
    (open: boolean) => setWorkbenchSidebar({ sidebarPinnedOpen: open }),
    [],
  );
  const [sidebarMaxWidth, setSidebarMaxWidth] = useState(SIDEBAR_MAX_WIDTH);
  const clampedSidebarWidth = clampSidebarWidth(sidebarWidth, sidebarMaxWidth);
  const ownsMobileHeader = routeOwnsMobileHeader(pathname);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>(null);
  const [navView, setNavView] = useState<NavView>("projects");
  const sessionActivity = useSessionActivity();
  const runningSessions = sessionActivity.active.size;
  const finishedSessions = sessionActivity.finished.size;
  const activeSessions = useOpenSessions();
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [projectsNavReady, setProjectsNavReady] = useState(projectsNavImmediate);
  const [ProjectsNavSection, setProjectsNavSection] = useState<ProjectsNavSectionComponent | null>(
    null,
  );
  const [SessionsCommand, setSessionsCommand] = useState<SessionsCommandComponent | null>(null);
  const resizeInteractionRef = useRef<SidebarResizeInteraction | null>(null);

  useMountSubscription(() => {
    const updateMaxWidth = () => {
      setSidebarMaxWidth(
        Math.max(
          SIDEBAR_MIN_WIDTH,
          Math.min(SIDEBAR_MAX_WIDTH, window.innerWidth - MIN_WORKSPACE_WIDTH),
        ),
      );
    };
    updateMaxWidth();
    window.addEventListener("resize", updateMaxWidth);
    return () => window.removeEventListener("resize", updateMaxWidth);
  }, []);

  useMountSubscription(() => {
    if (pathname.startsWith("/settings")) return;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.sessionStorage.setItem(LAST_WORKSPACE_URL_KEY, current);
  }, [pathname]);

  useMountSubscription(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen, setMobileMenuOpen]);

  useMountSubscription(() => {
    setMobileMenuOpen(false);
  }, [pathname, setMobileMenuOpen]);

  useMountSubscription(() => {
    if (hidesAppSidebar) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteMode((mode) => (mode === "search" ? null : "search"));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hidesAppSidebar]);

  useMountSubscription(() => {
    return () => {
      resizeInteractionRef.current?.cleanup();
    };
  }, []);

  useMountSubscription(() => {
    if (projectsNavReady || hidesAppSidebar) return;
    if (projectsNavImmediate || mobileMenuOpen) {
      setProjectsNavReady(true);
    }
  }, [hidesAppSidebar, mobileMenuOpen, projectsNavImmediate, projectsNavReady]);

  useMountSubscription(() => {
    if (!projectsNavReady || ProjectsNavSection) return;
    let cancelled = false;
    void loadProjectsNavSection().then((Component) => {
      if (!cancelled) setProjectsNavSection(() => Component);
    });
    return () => {
      cancelled = true;
    };
  }, [ProjectsNavSection, projectsNavReady]);

  useMountSubscription(() => {
    if (!paletteMode || SessionsCommand) return;
    let cancelled = false;
    void loadSessionsCommand().then((Component) => {
      if (!cancelled) setSessionsCommand(() => Component);
    });
    return () => {
      cancelled = true;
    };
  }, [SessionsCommand, paletteMode]);

  const startSidebarResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!isExpanded) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = clampedSidebarWidth;
      const sidebar = event.currentTarget.closest<HTMLElement>("aside");
      if (!sidebar) return;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      setSidebarResizing(true);

      const interaction: SidebarResizeInteraction = {
        cleanup: () => undefined,
        frame: null,
        pendingWidth: startWidth,
        sidebar,
      };

      const cleanup = () => {
        if (resizeInteractionRef.current !== interaction) return;
        if (interaction.frame !== null) cancelAnimationFrame(interaction.frame);
        interaction.sidebar.style.width = `${interaction.pendingWidth}px`;
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", cleanup);
        resizeInteractionRef.current = null;
        setSidebarWidth(interaction.pendingWidth);
        setSidebarResizing(false);
      };
      const onMouseMove = (moveEvent: MouseEvent) => {
        interaction.pendingWidth = clampSidebarWidth(
          startWidth + moveEvent.clientX - startX,
          sidebarMaxWidth,
        );
        if (interaction.frame !== null) return;
        interaction.frame = requestAnimationFrame(() => {
          interaction.frame = null;
          interaction.sidebar.style.width = `${interaction.pendingWidth}px`;
        });
      };

      interaction.cleanup = cleanup;
      resizeInteractionRef.current?.cleanup();
      resizeInteractionRef.current = interaction;
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", cleanup);
    },
    [clampedSidebarWidth, isExpanded, setSidebarWidth, sidebarMaxWidth],
  );
  const resizeSidebarByKeyboard = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!isExpanded || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
      event.preventDefault();
      const step = event.shiftKey ? 32 : 16;
      const direction = event.key === "ArrowRight" ? 1 : -1;
      setSidebarWidth(clampSidebarWidth(clampedSidebarWidth + direction * step, sidebarMaxWidth));
    },
    [clampedSidebarWidth, isExpanded, setSidebarWidth, sidebarMaxWidth],
  );
  const openNewTask = useCallback(
    () => router.push(hrefWithOpenNonce("/agent?new=1&replace=1")),
    [router],
  );
  const navigateBack = useCallback(() => {
    if (pathname.startsWith("/settings")) {
      const fallback = window.sessionStorage.getItem(LAST_WORKSPACE_URL_KEY) ?? "/agent";
      router.replace(fallback.startsWith("/settings") ? "/agent" : fallback);
      return;
    }
    if (window.history.length > 1) router.back();
    else router.replace("/agent");
  }, [pathname, router]);

  useMountSubscription(() => {
    if (pathname === "/agent") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "n") return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return;
      }
      event.preventDefault();
      openNewTask();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openNewTask, pathname]);

  if (hidesAppSidebar) {
    return <div className="h-full w-full">{children}</div>;
  }

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden">
      <DesktopSidebar
        pathname={pathname}
        isExpanded={isExpanded}
        width={clampedSidebarWidth}
        resizing={sidebarResizing}
        projectsNavReady={projectsNavReady}
        ProjectsNavSection={ProjectsNavSection}
        onStartResize={startSidebarResize}
        onResizeKeyDown={resizeSidebarByKeyboard}
        onResetWidth={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
        onRevealProjectsNav={() => {
          if (!hidesAppSidebar && !projectsNavReady) setProjectsNavReady(true);
        }}
        onSetPinnedOpen={setSidebarPinnedOpen}
        onOpenSearch={() => setPaletteMode("search")}
        navView={navView}
        onToggleNavView={() =>
          setNavView((view) => (view === "notifications" ? "projects" : "notifications"))
        }
        runningSessions={runningSessions}
        finishedSessions={finishedSessions}
        onNewTask={openNewTask}
        onNavigateBack={navigateBack}
        onNavigateForward={() => router.forward()}
      />

      {mobileMenuOpen ? (
        <MobileNavigationDrawer
          pathname={pathname}
          projectsNavReady={projectsNavReady}
          ProjectsNavSection={ProjectsNavSection}
          onClose={() => setMobileMenuOpen(false)}
          onNewTask={openNewTask}
          onOpenSearch={() => setPaletteMode("search")}
        />
      ) : null}

      {SessionsCommand ? (
        <SessionsCommand
          open={paletteMode !== null}
          onClose={() => setPaletteMode(null)}
          activeSessions={activeSessions}
        />
      ) : null}

      <section className="workbench-shell flex min-h-0 min-w-0 flex-1 flex-col bg-(--agent-bg)">
        {ownsMobileHeader ? null : (
          <div className="mobile-pwa-topbar z-40 shrink-0 border-b border-(--border)/70 bg-(--bg) px-4 md:hidden">
            <Link href="/" className="flex min-w-0 items-center gap-2.5">
              <span className="truncate text-[length:var(--fs-base)] font-semibold tracking-tight text-(--fg)">
                {mobilePageTitle(pathname)}
              </span>
            </Link>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="flex !h-8 !min-h-8 !w-8 !min-w-8 items-center justify-center rounded-md border-0 bg-transparent text-(--dim) transition-colors hover:bg-(--surface) hover:text-(--fg)"
                aria-label="Open navigation menu"
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-navigation-drawer"
              >
                <Menu className="h-[17px] w-[17px]" />
              </button>
            </div>
          </div>
        )}

        {ownsThreadTabs ? (
          <Suspense fallback={<WorkbenchTabFallback />}>
            <WorkbenchTabStrip />
          </Suspense>
        ) : null}

        <div
          id={ownsThreadTabs ? "workbench-active-surface" : undefined}
          role={ownsThreadTabs ? "tabpanel" : undefined}
          aria-labelledby={ownsThreadTabs ? "workbench-active-tab" : undefined}
          data-no-topbar={ownsMobileHeader ? "true" : undefined}
          className={`mobile-pwa-main workbench-surface min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-(--agent-bg) md:pt-0 ${
            ownsThreadTabs ? "workbench-tabpanel" : ""
          }`}
        >
          {children}
        </div>
      </section>
    </div>
  );
}

function WorkbenchTabFallback() {
  return (
    <div className="h-[var(--workbench-tab-height)] shrink-0 border-b border-(--border) bg-(--color-header)" />
  );
}
