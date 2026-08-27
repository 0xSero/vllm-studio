"use client";

import { useRouter } from "next/navigation";
import { useCallback, useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AppPage,
  AppContentColumn,
  Button,
  buttonClasses,
  Input,
  SearchInput,
  SectionNav,
  StatusPill,
  type SectionNavItem,
  type UiTone,
} from "@/ui";
import { ChevronDown, ChevronLeft } from "@/ui/icon-registry";
import { cx } from "@/ui/utils";
import { SETTINGS_SIDEBAR_PORTAL_ID } from "@/features/shell/left-sidebar-nav";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

export type SettingsSectionId = string;
export type SettingsSearchEntry = {
  label: string;
  target?: string;
  terms?: readonly string[];
};
export type SettingsSectionDef<Id extends SettingsSectionId = SettingsSectionId> =
  SectionNavItem<Id> & {
    searchTerms?: readonly string[];
    settings?: readonly SettingsSearchEntry[];
  };

type LayoutProps<Id extends SettingsSectionId = SettingsSectionId> = {
  sections: SettingsSectionDef<Id>[];
  activeSection: Id;
  title: string;
  status?: ReactNode;
  loading: boolean;
  onReload: () => void;
  onSelectSection: (section: Id) => void;
  eyebrow?: string;
  refreshLabel?: string;
  showRefresh?: boolean;
  width?: "default" | "wide";
  takeover?: boolean;
  navigationOverride?: ReactNode;
  children: ReactNode;
};

type RowProps = {
  label: string;
  description?: ReactNode;
  value?: ReactNode;
  control?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
};

function settingsSearchKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}

function settingsLayoutWidths(width: "default" | "wide") {
  return width === "wide"
    ? {
        layout: "max-w-[82rem] lg:grid-cols-[136px_minmax(0,68rem)]",
        takeover: "max-w-[72rem]",
      }
    : {
        layout: "max-w-[44rem] lg:grid-cols-[136px_minmax(0,32rem)]",
        takeover: "max-w-[34rem]",
      };
}

function SettingsNavigation<Id extends SettingsSectionId>({
  query,
  results,
  activeSection,
  activeIndex,
  title,
  sections,
  override,
  onActiveIndex,
  onSelectResult,
  onSelectSection,
}: {
  query: string;
  results: Array<{ section: SettingsSectionDef<Id>; entry: SettingsSearchEntry }>;
  activeSection: Id;
  activeIndex: number;
  title: string;
  sections: SettingsSectionDef<Id>[];
  override?: ReactNode;
  onActiveIndex: (index: number) => void;
  onSelectResult: (section: Id, target?: string) => void;
  onSelectSection: (section: Id) => void;
}) {
  if (!query.trim()) {
    return (
      override ?? (
        <SectionNav
          label={`${title} sections`}
          items={sections}
          activeItem={activeSection}
          onSelectItem={onSelectSection}
        />
      )
    );
  }
  if (!results.length) {
    return (
      <div className="px-2 py-2 text-[length:var(--fs-xs)] text-(--ui-muted)">
        No settings found
      </div>
    );
  }
  return (
    <div role="listbox" aria-label="Matching settings" className="flex flex-col gap-px">
      {results.map(({ section, entry }, index) => (
        <button
          key={`${section.id}:${entry.label}`}
          type="button"
          role="option"
          aria-selected={section.id === activeSection}
          data-active={index === activeIndex ? "true" : undefined}
          onPointerEnter={() => onActiveIndex(index)}
          onClick={() => onSelectResult(section.id, entry.target ?? entry.label)}
          className="flex h-6 w-full items-center gap-1.5 rounded-[4px] px-2 text-left text-[length:var(--fs-xs)] text-(--ui-muted) transition-colors hover:bg-(--ui-hover) hover:text-(--ui-fg) data-[active=true]:bg-(--ui-hover) data-[active=true]:text-(--ui-fg)"
        >
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center opacity-70">
            {section.icon}
          </span>
          <span className="min-w-0 truncate">
            {section.label === entry.label ? section.label : `${section.label} › ${entry.label}`}
          </span>
        </button>
      ))}
    </div>
  );
}

export function SettingsLayout<Id extends SettingsSectionId = SettingsSectionId>({
  sections,
  activeSection,
  title,
  status,
  loading: _loading,
  onReload: _onReload,
  onSelectSection,
  eyebrow,
  refreshLabel: _refreshLabel = `Refresh ${title.toLowerCase()}`,
  showRefresh: _showRefresh = false,
  width = "default",
  takeover = false,
  navigationOverride,
  children,
}: LayoutProps<Id>) {
  const [navigationQuery, setNavigationQuery] = useState("");
  const deferredNavigationQuery = useDeferredValue(navigationQuery);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [sidebarHost, setSidebarHost] = useState<HTMLElement | null>(null);
  const router = useRouter();
  const active = sections.find((section) => section.id === activeSection);
  useMountSubscription(() => {
    setSidebarHost(document.getElementById(SETTINGS_SIDEBAR_PORTAL_ID));
  }, []);
  useMountSubscription(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const editing =
        target instanceof HTMLElement &&
        Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
      if (event.key === "/" && !editing) {
        event.preventDefault();
        const inputs = document.querySelectorAll<HTMLInputElement>(
          'input[aria-label="Search Settings"]',
        );
        [...inputs].find((input) => input.offsetParent !== null)?.focus();
      }
      if (
        event.key === "Escape" &&
        document.activeElement instanceof HTMLInputElement &&
        document.activeElement.getAttribute("aria-label") === "Search Settings"
      ) {
        if (navigationQuery) {
          event.preventDefault();
          setNavigationQuery("");
          setActiveSearchIndex(0);
        } else {
          document.activeElement.blur();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigationQuery]);
  const searchResults = useMemo(() => {
    const query = deferredNavigationQuery.trim().toLowerCase();
    if (!query) return [];
    return sections.flatMap((section) => {
      const entries = section.settings ?? [];
      const matches = entries.filter((entry) =>
        `${entry.label} ${entry.terms?.join(" ") ?? ""}`.toLowerCase().includes(query),
      );
      const sectionMatches =
        `${section.label} ${section.description} ${section.searchTerms?.join(" ") ?? ""}`
          .toLowerCase()
          .includes(query);
      return [
        ...(sectionMatches && matches.length === 0
          ? [{ section, entry: { label: section.label } }]
          : []),
        ...matches.map((entry) => ({ section, entry })),
      ];
    });
  }, [deferredNavigationQuery, sections]);
  const updateNavigationQuery = (value: string) => {
    setNavigationQuery(value);
    setActiveSearchIndex(0);
    const query = value.trim().toLowerCase();
    if (!query) return;
    const match = sections.find((section) => {
      const sectionText = `${section.label} ${section.description} ${section.searchTerms?.join(" ") ?? ""}`;
      const settingsText = (section.settings ?? [])
        .map((entry) => `${entry.label} ${entry.terms?.join(" ") ?? ""}`)
        .join(" ");
      return `${sectionText} ${settingsText}`.toLowerCase().includes(query);
    });
    if (match && match.id !== activeSection) onSelectSection(match.id);
  };
  const widths = settingsLayoutWidths(width);

  const selectSearchResult = (section: Id, target?: string) => {
    onSelectSection(section);
    if (!target) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const element = document.querySelector<HTMLElement>(
          `[data-setting-key="${settingsSearchKey(target)}"]`,
        );
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        element?.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
        element?.focus({ preventScroll: true });
      });
    });
  };
  const navigateBack = useCallback(() => {
    const fallback = window.sessionStorage.getItem("local-studio:last-workspace-url") ?? "/agent";
    router.replace(fallback.startsWith("/settings") ? "/agent" : fallback);
  }, [router]);
  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!searchResults.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSearchIndex((current) =>
        event.key === "ArrowDown"
          ? (current + 1) % searchResults.length
          : (current - 1 + searchResults.length) % searchResults.length,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const result = searchResults[activeSearchIndex];
      if (result) selectSearchResult(result.section.id, result.entry.target ?? result.entry.label);
    }
  };
  const navigation = (
    <SettingsNavigation
      query={navigationQuery}
      results={searchResults}
      activeSection={activeSection}
      activeIndex={activeSearchIndex}
      title={title}
      sections={sections}
      override={navigationOverride}
      onActiveIndex={setActiveSearchIndex}
      onSelectResult={selectSearchResult}
      onSelectSection={onSelectSection}
    />
  );
  const content = (
    <>
      <header className="mb-3 flex min-h-7 items-start justify-between gap-3">
        <div className="min-w-0">
          {eyebrow ? (
            <div className="mb-0.5 text-[length:var(--fs-xs)] text-(--ui-muted)">{eyebrow}</div>
          ) : null}
          <h2
            className={cx(
              "font-medium tracking-[-0.015em] text-(--ui-fg)",
              takeover ? "text-[length:var(--fs-lg)]" : "text-[length:var(--fs-md)]",
            )}
          >
            {active?.label ?? title}
          </h2>
        </div>
        {!takeover && status ? (
          <div className="flex shrink-0 items-center gap-2 text-[length:var(--fs-xs)] text-(--ui-muted)">
            {status}
          </div>
        ) : null}
      </header>
      <div>{children}</div>
    </>
  );

  if (takeover) {
    return (
      <>
        {sidebarHost
          ? createPortal(
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 px-1.5 pb-1 pt-0">
                  <button
                    type="button"
                    onClick={navigateBack}
                    className="flex h-[var(--sidebar-row-height)] w-full items-center gap-2 rounded-[var(--sidebar-row-radius)] px-2 text-left text-[length:var(--fs-md)] text-(--ui-muted) transition-colors hover:bg-(--ui-hover) hover:text-(--ui-fg)"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Back
                  </button>
                </div>
                <div className="px-1.5 pb-1.5">
                  <SearchInput
                    value={navigationQuery}
                    onChange={updateNavigationQuery}
                    onKeyDown={handleSearchKeyDown}
                    placeholder="Search Settings"
                    aria-label="Search Settings"
                    className="[&_input]:h-7 [&_input]:rounded-[4px] [&_input]:bg-(--ui-surface)"
                  />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-1.5">{navigation}</div>
              </div>,
              sidebarHost,
            )
          : null}
        <AppPage className="overflow-hidden">
          <section className="min-h-0 min-w-0 overflow-y-auto">
            <div className="border-b border-(--ui-separator) px-3 py-2 lg:hidden">
              <div className="mb-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={navigateBack}
                  className="inline-flex h-7 items-center gap-1 rounded-[4px] px-1.5 text-[length:var(--fs-xs)] text-(--ui-muted)"
                >
                  <ChevronLeft className="h-3 w-3" />
                  Back
                </button>
                <span className="text-[length:var(--fs-sm)] font-medium">{title}</span>
              </div>
              <SearchInput
                value={navigationQuery}
                onChange={updateNavigationQuery}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search Settings"
                aria-label="Search Settings"
                className="mb-2 [&_input]:h-7 [&_input]:rounded-[4px] [&_input]:bg-(--ui-surface)"
              />
              <div className="overflow-x-auto [&_nav]:min-w-max [&_nav>div]:contents [&_nav_button]:max-w-none [&_nav_button]:shrink-0">
                {navigation}
              </div>
            </div>
            <AppContentColumn className={widths.takeover}>{content}</AppContentColumn>
          </section>
        </AppPage>
      </>
    );
  }

  return (
    <AppPage>
      <div
        className={cx(
          "mx-auto grid w-full grid-cols-1 gap-3 px-3 py-3 sm:px-4 lg:justify-center lg:gap-3 lg:py-5",
          widths.layout,
        )}
      >
        <aside className="min-w-0 lg:sticky lg:top-5 lg:self-start">
          <div className="mb-2 hidden items-center justify-between gap-2 px-1 lg:flex">
            <h1 className="text-[length:var(--fs-sm)] font-medium tracking-[-0.01em] text-(--ui-fg)">
              {title}
            </h1>
          </div>
          {navigation}
        </aside>
        <section className="min-w-0 pb-10">{content}</section>
      </div>
    </AppPage>
  );
}

export function SettingsGroup({
  title,
  actions,
  children,
  collapsible,
  defaultOpen,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  const showBody = collapsible ? open : true;

  return (
    <section
      data-setting-key={settingsSearchKey(title)}
      tabIndex={-1}
      className="mb-5 outline-none transition-colors duration-[var(--motion-fast)] focus:bg-(--ui-hover)/30 last:mb-0"
    >
      <div className="mb-1.5 flex items-start justify-between gap-3 px-1">
        <div className="min-w-0">
          {collapsible ? (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              className="group flex items-center gap-1.5 text-(--ui-fg)"
            >
              <ChevronDown
                className={cx(
                  "h-3.5 w-3.5 text-(--ui-muted) transition-transform duration-[var(--motion-fast)]",
                  open ? "" : "-rotate-90",
                )}
                aria-hidden
              />
              <h3 className="text-[length:var(--fs-xs)] font-medium tracking-[-0.01em]">{title}</h3>
            </button>
          ) : (
            <h3 className="text-[length:var(--fs-xs)] font-medium tracking-[-0.01em] text-(--ui-fg)">
              {title}
            </h3>
          )}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {showBody ? (
        <div className="overflow-hidden rounded-[var(--rad-lg)] border border-(--ui-border) bg-(--ui-surface) [&>*+*]:border-t [&>*+*]:border-(--ui-separator)/65">
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function SettingsRow({ label, value, control, status, actions, children }: RowProps) {
  const primaryValue = control ?? value;

  return (
    <div
      data-setting-key={settingsSearchKey(label)}
      tabIndex={-1}
      className="px-3.5 py-2 outline-none transition-colors hover:bg-(--ui-hover)/45 focus:bg-(--ui-hover)/55"
    >
      <div className="grid min-h-7 grid-cols-1 gap-1 md:grid-cols-[minmax(160px,0.3fr)_minmax(0,1fr)] md:items-center md:gap-3">
        <div className="min-w-0">
          <div
            className="truncate text-[length:var(--fs-xs)] font-medium text-(--ui-fg)"
            title={label}
          >
            {label}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {primaryValue ? (
            <div className={control ? "min-w-0 shrink-0" : "min-w-0 flex-1"}>{primaryValue}</div>
          ) : null}
          {status ? <div className="shrink-0">{status}</div> : null}
          {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        </div>
      </div>
      {children ? (
        <div className="mt-1.5 grid grid-cols-1 gap-1 md:grid-cols-[minmax(160px,0.3fr)_minmax(0,1fr)] md:gap-3">
          <div className="hidden md:block" />
          <div className="min-w-0">{children}</div>
        </div>
      ) : null}
    </div>
  );
}

export function SettingsValue({
  children,
  mono = false,
  dim = false,
  truncate = false,
  wrap = false,
}: {
  children: ReactNode;
  mono?: boolean;
  dim?: boolean;
  truncate?: boolean;
  wrap?: boolean;
}) {
  const value =
    children === null || children === undefined || children === "" ? "Not set" : children;
  return (
    <div
      className={cx(
        "text-[length:var(--fs-sm)]",
        mono ? "font-mono text-[length:var(--fs-xs)]" : "",
        dim ? "text-(--ui-muted)" : "text-(--ui-fg)/80",
        truncate ? "min-w-0 truncate" : "",
        wrap && !truncate ? "min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]" : "",
      )}
      title={typeof children === "string" ? children : undefined}
    >
      {value}
    </div>
  );
}

export type SettingsFactRow = {
  label: string;
  value: ReactNode;
  key?: string | number;
  description?: ReactNode;
  mono?: boolean;
  dim?: boolean;
  truncate?: boolean;
  wrap?: boolean;
  status?: { label: ReactNode; tone?: UiTone };
  actions?: ReactNode;
  children?: ReactNode;
};

export function SettingsFactRows({ rows }: { rows: SettingsFactRow[] }) {
  return (
    <>
      {rows.map((row) => (
        <SettingsRow
          key={row.key ?? row.label}
          label={row.label}
          description={row.description}
          value={
            <SettingsValue mono={row.mono} dim={row.dim} truncate={row.truncate} wrap={row.wrap}>
              {row.value}
            </SettingsValue>
          }
          status={
            row.status ? (
              <StatusPill tone={row.status.tone}>{row.status.label}</StatusPill>
            ) : undefined
          }
          actions={row.actions}
        >
          {row.children}
        </SettingsRow>
      ))}
    </>
  );
}

export function SettingsButton({
  children,
  onClick,
  disabled,
  title,
  tone = "default",
  type = "button",
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  tone?: "default" | "primary" | "danger";
  type?: "button" | "submit";
  "aria-label"?: string;
}) {
  return (
    <Button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      size="sm"
      variant={tone === "primary" ? "primary" : tone === "danger" ? "danger" : "secondary"}
    >
      {children}
    </Button>
  );
}

export function SettingsLink({
  href,
  children,
  tone = "default",
  "aria-label": ariaLabel,
}: {
  href: string;
  children: ReactNode;
  tone?: "default" | "primary" | "danger";
  "aria-label"?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      style={
        tone === "primary"
          ? { color: "var(--color-primary-foreground)" }
          : tone === "danger"
            ? { color: "var(--destructive-foreground)" }
            : undefined
      }
      className={buttonClasses(
        tone === "primary" ? "primary" : tone === "danger" ? "danger" : "secondary",
        "sm",
      )}
    >
      {children}
    </a>
  );
}

const noticeClasses: Record<UiTone, string> = {
  default: "border-(--ui-border) bg-(--ui-hover)/40 text-(--ui-muted)",
  good: "border-(--ui-success)/30 bg-(--ui-success)/10 text-(--ui-success)",
  warning: "border-(--ui-warning)/30 bg-(--ui-warning)/10 text-(--ui-warning)",
  danger: "border-(--ui-danger)/30 bg-(--ui-danger)/10 text-(--ui-danger)",
  info: "border-(--ui-info)/30 bg-(--ui-info)/10 text-(--ui-info)",
};

export function SettingsNotice({
  children,
  tone = "info",
  className,
}: {
  children: ReactNode;
  tone?: UiTone;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "rounded-md border px-3 py-2 text-[length:var(--fs-sm)] leading-relaxed",
        noticeClasses[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SettingsInput({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  type = "text",
  className = "",
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  type?: "text" | "password";
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <Input
      id={id}
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={cx("h-7", className)}
    />
  );
}

export { StatusPill };
