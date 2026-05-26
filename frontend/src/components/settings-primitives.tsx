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

const pillDotClasses: Record<StatusTone, string> = {
  default: "bg-(--dim)/50",
  good: "bg-(--hl2)",
  warning: "bg-(--hl3)",
  danger: "bg-(--err)",
  info: "bg-(--hl1)",
};

const pillTextClasses: Record<StatusTone, string> = {
  default: "text-(--dim)/60",
  good: "text-(--hl2)/80",
  warning: "text-(--hl3)/80",
  danger: "text-(--err)/80",
  info: "text-(--hl1)/80",
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
      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[200px_minmax(0,760px)] lg:gap-10 lg:py-8">
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-(--fg)">{title}</h1>
            <button
              type="button"
              onClick={onReload}
              disabled={loading}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-(--dim)/60 transition-colors hover:bg-(--hover) hover:text-(--fg) disabled:opacity-50"
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
                    className={`group grid h-8 grid-cols-[18px_1fr] items-center gap-2.5 rounded-md px-2.5 text-left text-[12px] transition-colors lg:w-full ${active ? "bg-(--hover) text-(--fg)" : "text-(--dim)/70 hover:bg-(--hover) hover:text-(--fg)"}`}
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
          <div className="mb-6 flex min-h-8 items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.14em] text-(--dim)/50">
                {eyebrow}
              </div>
              <h2 className="mt-1 truncate text-[22px] font-medium tracking-[-0.02em] text-(--fg)">
                {activeLabel}
              </h2>
            </div>
            <span className="shrink-0 text-[11px] text-(--dim)/50">{status}</span>
          </div>
          <div className="space-y-8">{children}</div>
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
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-medium tracking-[-0.01em] text-(--fg)">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-[12px] leading-relaxed text-(--dim)/50">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="divide-y divide-(--border)/[0.06] overflow-hidden rounded-xl border border-(--border)/[0.08] bg-(--surface)/[0.25]">
        {children}
      </div>
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
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-normal text-(--fg)/90">{label}</div>
        {description ? (
          <div className="mt-0.5 text-[12px] leading-relaxed text-(--dim)/50">{description}</div>
        ) : null}
        {children ? <div className="mt-2">{children}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {control ?? value ?? null}
        {status ? <div className="shrink-0">{status}</div> : null}
        {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </div>
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
      className={`text-[13px] ${mono ? "font-mono text-[12px]" : ""} ${dim ? "text-(--dim)/60" : "text-(--fg)/70"}`}
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
      className={`inline-flex items-center gap-1.5 text-[11px] font-normal ${pillTextClasses[tone]}`}
    >
      <span className={`h-[5px] w-[5px] rounded-full ${pillDotClasses[tone]}`} />
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
      ? "bg-(--fg)/90 text-(--bg) hover:bg-(--fg)"
      : tone === "danger"
        ? "text-(--err)/70 hover:text-(--err) hover:bg-(--err)/10"
        : "text-(--dim)/60 hover:text-(--fg)/80 hover:bg-(--hover)";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex h-[30px] items-center justify-center gap-1.5 rounded-lg px-2.5 text-[11px] font-normal transition-colors disabled:pointer-events-none disabled:opacity-45 ${classes}`}
    >
      {children}
    </button>
  );
}

export function SettingsInput({
  value,
  onChange,
  onBlur,
  placeholder,
  type = "text",
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  type?: "text" | "password";
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      className={`h-9 w-full rounded-lg border border-(--border)/[0.08] bg-(--surface-2)/40 px-3 text-[13px] text-(--fg)/80 outline-none transition placeholder:text-(--dim)/40 focus:border-(--accent)/30 focus:bg-(--surface-2)/60 ${className}`}
    />
  );
}

export function EmptySafeNotice({ children }: { children: ReactNode }) {
  return <div className="py-1 text-[12px] leading-relaxed text-(--dim)/55">{children}</div>;
}
