"use client";

import { useState, type ReactNode } from "react";
import {
  AppPage,
  Button,
  buttonClasses,
  Input,
  RefreshIconButton,
  SectionNav,
  ListRow,
  RowValue,
  EmptySafeNotice,
  StatusPill,
  type SectionNavItem,
  type UiTone,
} from "@/ui";
import { ChevronDown, Search, X } from "@/ui/icon-registry";
import { cx } from "@/ui/utils";

export type SettingsSectionId = string;
export type StatusTone = UiTone;
export type SettingsSectionDef<Id extends SettingsSectionId = SettingsSectionId> =
  SectionNavItem<Id>;

export type SettingsSectionGroup<Id extends SettingsSectionId = SettingsSectionId> = {
  label: string;
  sectionIds: readonly Id[];
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
  layout?: "document" | "shell";
  sectionGroups?: readonly SettingsSectionGroup<Id>[];
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
  variant?: "settings" | "resource";
};

export function SettingsLayout<Id extends SettingsSectionId = SettingsSectionId>({
  sections,
  activeSection,
  title,
  status,
  loading,
  onReload,
  onSelectSection,
  eyebrow,
  refreshLabel = `Refresh ${title.toLowerCase()}`,
  showRefresh = true,
  width = "default",
  layout = "document",
  sectionGroups = [],
  children,
}: LayoutProps<Id>) {
  if (layout === "shell") {
    return (
      <SettingsShellLayout
        sections={sections}
        activeSection={activeSection}
        title={title}
        status={status}
        loading={loading}
        onReload={onReload}
        onSelectSection={onSelectSection}
        eyebrow={eyebrow}
        refreshLabel={refreshLabel}
        showRefresh={showRefresh}
        sectionGroups={sectionGroups}
      >
        {children}
      </SettingsShellLayout>
    );
  }

  const active = sections.find((section) => section.id === activeSection);
  const layoutWidth =
    width === "wide"
      ? "max-w-[92rem] lg:grid-cols-[168px_minmax(0,68rem)]"
      : "max-w-[68rem] lg:grid-cols-[168px_minmax(0,46rem)]";

  return (
    <AppPage>
      <div
        className={cx(
          "mx-auto grid w-full grid-cols-1 gap-4 px-4 py-4 sm:px-6 lg:justify-center lg:gap-8 lg:py-6",
          layoutWidth,
        )}
      >
        <aside className="min-w-0 lg:sticky lg:top-8 lg:self-start">
          <div className="mb-4 hidden items-center justify-between gap-3 px-1 lg:flex">
            <h1 className="text-[length:var(--fs-lg)] font-medium tracking-[-0.01em] text-(--ui-fg)">
              {title}
            </h1>
            {showRefresh ? (
              <RefreshIconButton onClick={onReload} loading={loading} label={refreshLabel} />
            ) : null}
          </div>
          <SectionNav
            label={`${title} sections`}
            items={sections}
            activeItem={activeSection}
            onSelectItem={onSelectSection}
          />
        </aside>
        <section className="min-w-0 pb-12">
          <header className="mb-6 flex min-h-8 items-start justify-between gap-4">
            <div className="min-w-0">
              {eyebrow ? (
                <div className="mb-1 text-[length:var(--fs-xs)] uppercase tracking-[0.12em] text-(--ui-muted)">
                  {eyebrow}
                </div>
              ) : null}
              <h2 className="text-[length:var(--fs-xl)] font-medium tracking-[-0.015em] text-(--ui-fg)">
                {active?.label ?? title}
              </h2>
              {active?.description ? (
                <p className="mt-1 max-w-[38rem] text-[length:var(--fs-base)] leading-relaxed text-(--ui-muted)">
                  {active.description}
                </p>
              ) : null}
            </div>
            {status || showRefresh ? (
              <div className="flex shrink-0 items-center gap-2 text-[length:var(--fs-xs)] text-(--ui-muted)">
                {status}
                {showRefresh ? (
                  <span className="lg:hidden">
                    <RefreshIconButton onClick={onReload} loading={loading} label={refreshLabel} />
                  </span>
                ) : null}
              </div>
            ) : null}
          </header>
          <div>{children}</div>
        </section>
      </div>
    </AppPage>
  );
}

type SettingsShellLayoutProps<Id extends SettingsSectionId> = Omit<
  LayoutProps<Id>,
  "layout" | "width" | "refreshLabel" | "showRefresh"
> & {
  refreshLabel: string;
  showRefresh: boolean;
};

function SettingsShellLayout<Id extends SettingsSectionId>({
  sections,
  activeSection,
  title,
  status,
  loading,
  onReload,
  onSelectSection,
  eyebrow,
  refreshLabel,
  showRefresh,
  sectionGroups = [],
  children,
}: SettingsShellLayoutProps<Id>) {
  const [searchQuery, setSearchQuery] = useState("");
  const active = sections.find((section) => section.id === activeSection);
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const visibleSections = normalizedQuery
    ? sections.filter((section) =>
        `${section.label} ${section.description}`.toLocaleLowerCase().includes(normalizedQuery),
      )
    : sections;
  const visibleSectionIds = new Set(visibleSections.map((section) => section.id));
  const assignedSectionIds = new Set(sectionGroups.flatMap((group) => group.sectionIds));
  const visibleGroups = sectionGroups
    .map((group) => ({
      label: group.label,
      items: group.sectionIds
        .map((sectionId) => sections.find((section) => section.id === sectionId))
        .filter(
          (section): section is SettingsSectionDef<Id> =>
            section !== undefined && visibleSectionIds.has(section.id),
        ),
    }))
    .filter((group) => group.items.length > 0);
  const ungroupedSections = visibleSections.filter(
    (section) => !assignedSectionIds.has(section.id),
  );

  return (
    <AppPage className="h-full !min-h-0 !overflow-hidden">
      <div className="grid h-full min-h-0 w-full grid-cols-1 overflow-y-auto lg:grid-cols-[168px_minmax(0,1fr)] lg:overflow-hidden">
        <aside className="min-w-0 border-b border-(--ui-border) px-4 py-4 sm:px-6 lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-b-0 lg:px-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <h1 className="text-[length:var(--fs-lg)] font-medium tracking-[-0.01em] text-(--ui-fg)">
              {title}
            </h1>
            {showRefresh ? (
              <RefreshIconButton onClick={onReload} loading={loading} label={refreshLabel} />
            ) : null}
          </div>
          <div className="relative mt-4">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-(--ui-muted)" />
            <input
              type="text"
              role="searchbox"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search settings…"
              aria-label="Search settings"
              autoComplete="off"
              className="h-8 w-full rounded-lg border border-(--ui-separator) bg-(--ui-surface) pr-8 pl-8 text-[length:var(--fs-sm)] text-(--ui-fg) outline-none transition-colors placeholder:text-(--ui-muted)/70 focus:border-(--ui-accent)/60 focus:ring-1 focus:ring-(--ui-accent)/20"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear settings search"
                className="absolute top-1/2 right-1.5 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-(--ui-muted) transition-[transform,color,background-color] hover:bg-(--ui-hover) hover:text-(--ui-fg) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)/35 active:scale-[0.96]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <div className="mt-4 space-y-4">
            {visibleGroups.map((group) => (
              <div key={group.label}>
                <div className="px-2 pb-1 text-[length:var(--fs-xs)] font-medium text-(--ui-muted)">
                  {group.label}
                </div>
                <SectionNav
                  label={`${group.label} settings`}
                  items={group.items}
                  activeItem={activeSection}
                  onSelectItem={onSelectSection}
                />
              </div>
            ))}
            {ungroupedSections.length > 0 ? (
              <SectionNav
                label={`${title} sections`}
                items={ungroupedSections}
                activeItem={activeSection}
                onSelectItem={onSelectSection}
              />
            ) : null}
            {visibleSections.length === 0 ? (
              <div className="px-2 py-1 text-[length:var(--fs-sm)] text-(--ui-muted)">
                No results found
              </div>
            ) : null}
          </div>
        </aside>
        <section className="min-w-0 lg:min-h-0 lg:overflow-y-auto">
          <div className="w-full max-w-[46rem] px-4 py-5 pb-12 sm:px-6 lg:px-8 lg:py-6">
            <header className="mb-6 flex min-h-8 items-start justify-between gap-4">
              <div className="min-w-0">
                {eyebrow ? (
                  <div className="mb-1 text-[length:var(--fs-xs)] uppercase tracking-[0.12em] text-(--ui-muted)">
                    {eyebrow}
                  </div>
                ) : null}
                <h2 className="text-[length:var(--fs-xl)] font-medium tracking-[-0.015em] text-(--ui-fg)">
                  {active?.label ?? title}
                </h2>
                {active?.description ? (
                  <p className="mt-1 max-w-[38rem] text-[length:var(--fs-base)] leading-relaxed text-(--ui-muted)">
                    {active.description}
                  </p>
                ) : null}
              </div>
              {status ? (
                <div className="shrink-0 text-[length:var(--fs-xs)] text-(--ui-muted)">
                  {status}
                </div>
              ) : null}
            </header>
            <div>{children}</div>
          </div>
        </section>
      </div>
    </AppPage>
  );
}

const settingsGroupBodyClasses = cx(
  "overflow-hidden rounded-[10px] border border-(--ui-border) bg-(--ui-surface)",
  "[&>*+*]:relative [&>*+*]:before:pointer-events-none [&>*+*]:before:absolute",
  "[&>*+*]:before:inset-x-3 [&>*+*]:before:top-0 [&>*+*]:before:h-px",
  "[&>*+*]:before:bg-(--ui-separator)",
);

export function SettingsGroup({
  title,
  description,
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
    <section className="mb-8 last:mb-0">
      <div className="mb-2 flex items-start justify-between gap-4 px-1">
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
                  "h-3.5 w-3.5 text-(--ui-muted) transition-transform",
                  open ? "" : "-rotate-90",
                )}
                aria-hidden
              />
              <h3 className="text-[length:var(--fs-base)] font-medium tracking-[-0.01em]">
                {title}
              </h3>
            </button>
          ) : (
            <h3 className="text-[length:var(--fs-base)] font-medium tracking-[-0.01em] text-(--ui-fg)">
              {title}
            </h3>
          )}
          {description ? (
            <p className="mt-1 text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {showBody ? <div className={settingsGroupBodyClasses}>{children}</div> : null}
    </section>
  );
}

export function SettingsRow(props: RowProps) {
  return <ListRow {...props} />;
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
  return (
    <RowValue mono={mono} dim={dim} truncate={truncate} wrap={wrap}>
      {children}
    </RowValue>
  );
}

export type SettingsFactRow = {
  label: string;
  value: ReactNode;
  key?: string | number;
  description?: ReactNode;
  variant?: "settings" | "resource";
  mono?: boolean;
  dim?: boolean;
  truncate?: boolean;
  wrap?: boolean;
  status?: { label: ReactNode; tone?: StatusTone };
  actions?: ReactNode;
  children?: ReactNode;
};

export function SettingsFactRows({ rows }: { rows: SettingsFactRow[] }) {
  return (
    <>
      {rows.map((row) => (
        <SettingsRow
          key={row.key ?? row.label}
          variant={row.variant}
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
      variant={tone === "primary" ? "primary" : tone === "danger" ? "danger" : "ghost"}
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
        tone === "primary" ? "primary" : tone === "danger" ? "danger" : "ghost",
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
      className={cx("h-8", className)}
    />
  );
}

export { EmptySafeNotice, StatusPill };
