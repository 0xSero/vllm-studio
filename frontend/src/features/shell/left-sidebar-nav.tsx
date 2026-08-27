"use client";

import Link from "next/link";
import { type ComponentType, type MouseEvent } from "react";
import { AutomationsIcon, SettingsIcon } from "@/ui/icon-registry";

export type IconComponent = ComponentType<{ className?: string; strokeWidth?: number }>;

export const primaryTabs = [
  { href: "/agent/automations", label: "Automations", icon: AutomationsIcon },
] as const;

export const tabs = [...primaryTabs];

export const customizeTab = {
  href: "/customize",
  label: "Customize",
  icon: SettingsIcon,
} as const;

export const SETTINGS_SIDEBAR_PORTAL_ID = "settings-sidebar-content";

export function mobilePageTitle(pathname: string): string {
  if (pathname.startsWith("/agent/automations")) return "Automations";
  if (pathname.startsWith("/agent")) return "Tasks";
  if (pathname.startsWith("/logs")) return "Logs";
  if (pathname.startsWith("/settings")) return "Settings";
  if (pathname.startsWith("/customize")) return "Customize";
  const tab = tabs.find((entry) => isRouteActive(pathname, entry.href));
  return tab?.label ?? "Local Studio";
}

export function isRouteActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  if (href === "/agent") {
    return pathname.startsWith("/agent") && !pathname.startsWith("/agent/automations");
  }
  if (href === "/settings") {
    return pathname.startsWith("/settings");
  }
  if (href === "/customize") {
    return pathname.startsWith("/customize");
  }
  return pathname.startsWith(href);
}

export function routeHidesAppSidebar(pathname: string): boolean {
  return pathname.startsWith("/setup") || pathname.startsWith("/quick");
}

export function routeOwnsMobileHeader(pathname: string): boolean {
  return pathname === "/agent";
}

export function ProjectsNavPlaceholder() {
  return null;
}

export function NavItemMobile({
  href,
  label,
  Icon,
  active,
  onClick,
}: {
  href: string;
  label: string;
  Icon: IconComponent;
  active: boolean;
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      onClick={onClick}
      className={`flex h-10 items-center gap-2.5 rounded-[4px] px-3 text-[12px] transition-colors ${
        active
          ? "bg-(--active) font-medium text-(--fg)"
          : "text-(--fg)/80 hover:bg-(--hover) hover:text-(--fg) active:bg-(--active)/70"
      }`}
    >
      <Icon className="h-[15px] w-[15px] shrink-0" strokeWidth={1.6} />
      <span>{label}</span>
    </Link>
  );
}

export function NavItemDesktop({
  href,
  label,
  Icon,
  active,
}: {
  href: string;
  label: string;
  Icon: IconComponent;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      onPointerUp={(event) => event.currentTarget.blur()}
      title={label}
      className={`group flex h-[var(--sidebar-row-height)] shrink-0 items-center gap-2 rounded-[var(--sidebar-row-radius)] px-2 transition-[background-color,color,box-shadow] duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--focus-ring) focus-visible:ring-offset-[-1px] active:bg-(--active)/70 ${
        active ? "bg-(--active) text-(--fg)" : "text-(--fg)/85 hover:bg-(--hover) hover:text-(--fg)"
      }`}
    >
      <Icon
        className={`h-4 w-4 shrink-0 ${active ? "opacity-95" : "opacity-58"}`}
        strokeWidth={1.6}
      />
      <span className="whitespace-nowrap text-[length:var(--fs-md)]">{label}</span>
    </Link>
  );
}

export function NavActionDesktop({
  label,
  Icon,
  onClick,
  shortcut,
}: {
  label: string;
  Icon: IconComponent;
  onClick: () => void;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      onPointerUp={(event) => event.currentTarget.blur()}
      onClick={onClick}
      title={shortcut ? `${label} (${shortcut})` : label}
      className="group flex h-[var(--sidebar-row-height)] w-full shrink-0 items-center gap-2 rounded-[var(--sidebar-row-radius)] px-2 text-left text-(--fg)/85 transition-[background-color,color,box-shadow] duration-[var(--motion-fast)] hover:bg-(--hover) hover:text-(--fg) focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--focus-ring) focus-visible:ring-offset-[-1px] active:bg-(--active)/70"
    >
      <Icon className="h-4 w-4 shrink-0 opacity-58 group-hover:opacity-95" strokeWidth={1.6} />
      <span className="min-w-0 flex-1 truncate text-[length:var(--fs-md)]">{label}</span>
      {shortcut ? (
        <kbd className="w-7 text-right text-[10px] leading-4 text-(--dim) opacity-0 transition-opacity duration-[var(--motion-fast)] group-hover:opacity-100">
          {shortcut}
        </kbd>
      ) : null}
    </button>
  );
}
