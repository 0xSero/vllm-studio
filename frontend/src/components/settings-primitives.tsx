"use client";

import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";

export type SettingsSectionId = string;
export type StatusTone = "default" | "good" | "warning" | "danger" | "info";
export type SettingsSectionDef<Id extends SettingsSectionId = SettingsSectionId> = {
  id: Id;
  label: string;
  description: string;
  icon: ReactNode;
};

type LayoutProps<Id extends SettingsSectionId = SettingsSectionId> = {
  sections: SettingsSectionDef<Id>[];
  activeSection: Id;
  title: string;
  status: string;
  loading: boolean;
  onReload: () => void;
  onSelectSection: (section: Id) => void;
  eyebrow?: string;
  refreshLabel?: string;
  children: ReactNode;
};

type RowProps = {
  label: string;
  description?: string;
  value?: ReactNode;
  control?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
};

const pillClasses: Record<StatusTone, string> = {
  default: "border-(--border) text-(--dim) bg-(--bg)/60",
  good: "border-(--hl2)/35 text-(--hl2) bg-(--hl2)/10",
  warning: "border-(--hl3)/35 text-(--hl3) bg-(--hl3)/10",
  danger: "border-(--err)/35 text-(--err) bg-(--err)/10",
  info: "border-(--hl1)/35 text-(--hl1) bg-(--hl1)/10",
};

export function SettingsLayout<Id extends SettingsSectionId = SettingsSectionId>({
  sections,
  activeSection,
  title,
  status,
  loading,
  onReload,
  onSelectSection,
  eyebrow = title,
  refreshLabel = `Refresh ${title.toLowerCase()}`,
  children,
}: LayoutProps<Id>) {
  const activeLabel = sections.find((section) => section.id === activeSection)?.label ?? title;
  return (
    <main className="min-h-full overflow-y-auto overflow-x-hidden bg-(--bg) text-(--fg)">
      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[176px_minmax(0,760px)] lg:gap-8 lg:py-7">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-(--fg)">{title}</h1>
            <button
              type="button"
              onClick={onReload}
              disabled={loading}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg) disabled:opacity-50"
              aria-label={refreshLabel}
              title={refreshLabel}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
          <nav
            aria-label={`${title} sections`}
            className="-mx-1 overflow-x-auto pb-1 lg:mx-0 lg:overflow-visible"
          >
            <div className="flex min-w-max gap-1 lg:min-w-0 lg:flex-col">
              {sections.map((section) => {
                const active = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => onSelectSection(section.id)}
                    className={`group grid h-8 grid-cols-[18px_1fr] items-center gap-2 rounded-md px-2 text-left text-[12px] transition-colors lg:w-full ${active ? "bg-(--active) text-(--fg)" : "text-(--dim) hover:bg-(--hover) hover:text-(--fg)"}`}
                    title={section.description}
                  >
                    <span className="flex h-4 w-4 items-center justify-center opacity-80">
                      {section.icon}
                    </span>
                    <span className="truncate">{section.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        </aside>
        <section className="min-w-0 pb-10">
          <div className="mb-4 flex min-h-8 items-center justify-between gap-3 border-b border-(--border)/70 pb-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.16em] text-(--dim)">{eyebrow}</div>
              <h2 className="mt-1 truncate text-[19px] font-semibold tracking-[-0.015em] text-(--fg)">
                {activeLabel}
              </h2>
            </div>
            <span className="shrink-0 text-[11px] text-(--dim)">{status}</span>
          </div>
          <div className="space-y-5">{children}</div>
        </section>
      </div>
    </main>
  );
}

export function SettingsGroup({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-(--border) bg-(--surface)">
      <div className="flex min-h-12 items-start justify-between gap-4 border-b border-(--border)/70 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-(--fg)">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-[11px] leading-4 text-(--dim)">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="divide-y divide-(--border)/60">{children}</div>
    </section>
  );
}

export function SettingsRow({
  label,
  description,
  value,
  control,
  status,
  actions,
  children,
}: RowProps) {
  return (
    <div className="px-4 py-3">
      <div className="grid min-h-8 grid-cols-1 gap-2 sm:grid-cols-[minmax(130px,0.52fr)_minmax(0,1fr)] sm:items-center sm:gap-5">
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-(--fg)">{label}</div>
          {description ? (
            <div className="mt-0.5 text-[11px] leading-4 text-(--dim)">{description}</div>
          ) : null}
        </div>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            {control ?? value ?? <SettingsValue dim>Not reported yet</SettingsValue>}
          </div>
          {status ? <div className="shrink-0">{status}</div> : null}
          {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        </div>
      </div>
      {children ? <div className="mt-3 sm:ml-[calc(130px+1.25rem)]">{children}</div> : null}
    </div>
  );
}

export function SettingsValue({
  children,
  mono = false,
  dim = false,
}: {
  children: ReactNode;
  mono?: boolean;
  dim?: boolean;
}) {
  return (
    <div
      className={`truncate text-[12px] ${mono ? "font-mono" : ""} ${dim ? "text-(--dim)" : "text-(--fg)"}`}
      title={typeof children === "string" ? children : undefined}
    >
      {children || "Not set"}
    </div>
  );
}

export function StatusPill({
  tone = "default",
  children,
}: {
  tone?: StatusTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex h-6 items-center rounded-full border px-2 text-[10px] font-medium ${pillClasses[tone]}`}
    >
      {children}
    </span>
  );
}

export function SettingsButton({
  children,
  onClick,
  disabled,
  title,
  tone = "default",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  tone?: "default" | "primary" | "danger";
  type?: "button" | "submit";
}) {
  const classes =
    tone === "primary"
      ? "bg-(--fg) text-(--bg) hover:opacity-90"
      : tone === "danger"
        ? "text-(--err) hover:bg-(--err)/10"
        : "text-(--dim) hover:bg-(--hover) hover:text-(--fg)";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-45 ${classes}`}
    >
      {children}
    </button>
  );
}

export function SettingsInput({
  value,
  onChange,
  placeholder,
  type = "text",
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password";
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={`h-8 w-full border-0 border-b border-(--border)/70 bg-transparent px-0.5 text-[12px] text-(--fg) outline-none transition placeholder:text-(--dim)/65 focus:border-(--hl1) ${className}`}
    />
  );
}

export function EmptySafeNotice({ children }: { children: ReactNode }) {
  return <div className="py-1 text-[11px] leading-4 text-(--dim)">{children}</div>;
}
