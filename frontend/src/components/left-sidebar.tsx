"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Database,
  HardDrive,
  Search as SearchIcon,
  Server,
  Settings,
  PanelLeftClose,
  Menu,
  PanelLeftOpen,
  Square,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store";
import { ProjectsNavSection } from "@/components/projects-nav-section";
import { SessionsCommand } from "@/components/sessions-command";

// Custom event used by ProjectsNavSection to broadcast the set of currently
// running agent panes/tabs. We listen for it here so the search palette can
// surface "Running now" entries even when the project tree is collapsed.
const ACTIVE_AGENT_SESSIONS_EVENT = "vllm-studio.agent.activeSessions";

type ActiveSessionDetail = {
  projectId: string;
  cwd: string;
  paneId: string;
  tabId: string;
  piSessionId: string | null;
  title: string;
  status: string;
  active?: boolean;
  updatedAt: string;
};

const tabs = [
  { href: "/", label: "Status", icon: BarChart3 },
  { href: "/usage", label: "Usage", icon: Database },
  { href: "/recipes", label: "Models", icon: HardDrive },
  { href: "/server", label: "Server", icon: Server },
];

function isRouteActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/" || pathname === "/discover";
  }
  if (href === "/settings") {
    return pathname.startsWith("/settings") || pathname.startsWith("/configs");
  }
  return pathname.startsWith(href);
}

/**
 * Left navigation rail. Desktop keeps a compact rail. Mobile/PWA uses a top
 * app bar with a hamburger drawer instead of a bottom tab bar, keeping the
 * viewport clear for dense telemetry and agent panes.
 */
export function LeftSidebar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { desktopSidebarPinnedOpen, setDesktopSidebarPinnedOpen } = useAppStore(
    useShallow((s) => ({
      desktopSidebarPinnedOpen: s.desktopSidebarPinnedOpen,
      setDesktopSidebarPinnedOpen: s.setDesktopSidebarPinnedOpen,
    })),
  );
  const isExpanded = desktopSidebarPinnedOpen;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSessions, setActiveSessions] = useState<ActiveSessionDetail[]>([]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen]);

  // Global Cmd/Ctrl+K opens the session search palette.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Mirror active sessions broadcast by the agent workspace so the palette
  // can show what's running even when the user is on a non-agent route.
  useEffect(() => {
    const onActive = (event: Event) => {
      const detail = (event as CustomEvent<{ sessions?: ActiveSessionDetail[] }>).detail;
      setActiveSessions(Array.isArray(detail?.sessions) ? detail.sessions : []);
    };
    window.addEventListener(ACTIVE_AGENT_SESSIONS_EVENT, onActive);
    return () => window.removeEventListener(ACTIVE_AGENT_SESSIONS_EVENT, onActive);
  }, []);

  if (pathname.startsWith("/setup")) {
    return <div className="h-full w-full">{children}</div>;
  }

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden">
      {!isExpanded ? (
        <button
          onClick={() => setDesktopSidebarPinnedOpen(true)}
          className="fixed left-3 top-3 z-50 hidden h-8 w-8 items-center justify-center rounded-md bg-(--bg)/70 text-(--dim) transition-colors hover:bg-(--surface) hover:text-(--fg) md:flex"
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          <PanelLeftOpen className="h-5 w-5" />
        </button>
      ) : null}
      <aside
        className={`hidden md:flex sticky top-0 h-[100dvh] transition-[width] duration-150 ease-out border-r border-(--border) bg-(--rail) flex-col shrink-0 z-40 overflow-hidden ${
          isExpanded ? "w-[var(--sidebar-w)]" : "w-0 border-r-0"
        }`}
        aria-hidden={!isExpanded}
      >
        {isExpanded ? (
          <>
            {/* Header with window controls + nav arrows */}
            <div className="sticky top-0 z-50 flex h-12 shrink-0 items-center justify-between px-4 bg-(--rail)">
              <button
                onClick={() => setDesktopSidebarPinnedOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg)"
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => window.history.back()}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg)"
                  title="Go back"
                  aria-label="Go back"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  onClick={() => window.history.forward()}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg)"
                  title="Go forward"
                  aria-label="Go forward"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Primary nav */}
            <nav className="flex-1 min-h-0 flex flex-col px-2 py-1 overflow-y-auto overflow-x-hidden">
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="mb-1 flex h-8 items-center gap-3 rounded-md px-3 text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg)"
                title="Search sessions (⌘K)"
              >
                <SearchIcon className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate text-left text-[14px]">Search</span>
                <kbd className="px-1 py-0.5 text-[11px] font-mono text-(--dim)">⌘K</kbd>
              </button>

              <div className="mb-1 mt-4 px-3 text-[12px] font-medium text-(--dim)">Workspace</div>
              {tabs.map((tab) => (
                <NavItemDesktop
                  key={tab.href}
                  href={tab.href}
                  label={tab.label}
                  Icon={tab.icon}
                  active={isRouteActive(pathname, tab.href)}
                  expanded={isExpanded}
                />
              ))}
              <ProjectsNavSection expanded={isExpanded} />
            </nav>

            <div className="shrink-0 px-2 py-3">
              <NavItemDesktop
                href="/settings"
                label="Settings"
                Icon={Settings}
                active={isRouteActive(pathname, "/settings")}
                expanded={isExpanded}
              />
            </div>
          </>
        ) : null}
      </aside>

      {/* Mobile/PWA: top app bar + hamburger drawer (no footer nav). */}
      <div className="mobile-pwa-topbar md:hidden fixed left-0 right-0 top-0 z-40 border-b border-(--border)/70 bg-(--bg) px-4">
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <span className="truncate text-[13px] font-semibold tracking-tight text-(--fg)">
            Status
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
            <Menu className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>

      {mobileMenuOpen ? (
        <MobileNavigationDrawer pathname={pathname} onClose={() => setMobileMenuOpen(false)} />
      ) : null}

      <SessionsCommand
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        activeSessions={activeSessions}
      />

      {/* Main content */}
      <main className="mobile-pwa-main flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden bg-(--bg) md:pt-0">
        {children}
      </main>
    </div>
  );
}

function MobileNavigationDrawer({ pathname, onClose }: { pathname: string; onClose: () => void }) {
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
        className="mobile-pwa-drawer absolute right-0 top-0 flex h-full w-[min(22rem,88vw)] flex-col border-l border-(--border) bg-(--bg)"
      >
        <div className="mobile-pwa-drawer-header flex shrink-0 items-center justify-between gap-3 border-b border-(--border) px-4">
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-(--fg)">Navigation</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center text-(--dim) hover:text-(--fg)"
            aria-label="Close navigation menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-(--dim)">
            Navigation
          </div>
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
            Icon={Settings}
            active={isRouteActive(pathname, "/settings")}
            onClick={onClose}
          />
          <div className="my-3 border-t border-(--border)" />
          <ProjectsNavSection expanded />
        </nav>
      </aside>
    </div>
  );
}

function NavItemMobile({
  href,
  label,
  Icon,
  active,
  onClick,
}: {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`mb-1 flex h-12 items-center gap-3 border-l-2 px-2 text-sm font-medium transition-colors ${
        active
          ? "border-(--accent) text-(--fg)"
          : "border-transparent text-(--dim) hover:text-(--fg)"
      }`}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span>{label}</span>
    </Link>
  );
}

/* ---------- Desktop variants use the `group-hover` collapsed state ---------- */

function NavItemDesktop({
  href,
  label,
  Icon,
  active,
  expanded,
}: {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  expanded: boolean;
}) {
  return (
    <Link
      href={href}
      title={label}
      className={`h-8 flex items-center gap-3 rounded-md px-3 transition-colors shrink-0 ${
        active ? "bg-(--hover) text-(--fg)" : "text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
      }`}
    >
      <Icon className="w-[18px] h-[18px] shrink-0" />
      <span
        className={`text-[14px] font-medium whitespace-nowrap transition-opacity duration-100 ${
          expanded ? "opacity-100" : "opacity-0"
        }`}
      >
        {label}
      </span>
    </Link>
  );
}
