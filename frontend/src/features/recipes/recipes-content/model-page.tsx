"use client";

import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { ChevronRight } from "@/ui/icon-registry";
import { StatusPill, type UiTone } from "@/ui";
import { cx } from "@/ui/utils";

export type ModelStatusTone = UiTone;
export type ModelRowVariant = "default" | "catalog";

export type ModelSummaryItem = {
  label: string;
  value: ReactNode;
};

type ModelRowProps = {
  label: string;
  description?: string;
  leading?: ReactNode;
  value?: ReactNode;
  control?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  variant?: ModelRowVariant;
  className?: string;
  onClick?: () => void;
  /** Parent-owned disclosure state; drives the chevron only. */
  expanded?: boolean;
};

/**
 * Rows sit in a bounded card and are separated by a hairline that stops short
 * of the border on both sides, the way the Codex plugins list does it. A
 * full-bleed `divide-y` runs into the card edge and reads as a table; the inset
 * keeps each row legible as its own object.
 *
 * Done with a pseudo-element on every child after the first so callers keep
 * rendering a plain list and nothing has to know its own index.
 */
const GROUP_DIVIDERS =
  "[&>*+*]:relative [&>*+*]:before:pointer-events-none [&>*+*]:before:absolute [&>*+*]:before:inset-x-2.5 [&>*+*]:before:top-0 [&>*+*]:before:h-px [&>*+*]:before:bg-(--ui-border)/70";

export function ModelSection({
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
    <section className="min-w-0">
      <div className="flex min-h-8 items-end justify-between gap-4 px-0.5 pb-2">
        <div className="min-w-0">
          <h3 className="text-[length:var(--fs-md)] font-medium text-(--ui-fg)">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-[length:var(--fs-sm)] text-(--ui-muted)">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div
        className={cx(
          // `empty:hidden` so a section whose rows all render null collapses
          // instead of leaving a hairline-thin empty box.
          "flex min-w-0 flex-col overflow-hidden rounded-[10px] border border-(--ui-border) bg-(--ui-surface) empty:hidden",
          GROUP_DIVIDERS,
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function ModelActiveSummary({
  title,
  subtitle,
  leading,
  status,
  actions,
  details,
  progress,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  details?: ModelSummaryItem[];
  progress?: ReactNode;
}) {
  return (
    <div className="px-1 py-2">
      <div className="grid min-h-7 grid-cols-1 gap-2 md:grid-cols-[minmax(180px,0.32fr)_minmax(0,1fr)] md:items-center md:gap-5">
        <div className="flex min-w-0 items-center gap-2.5">
          {leading ? <span className="shrink-0 opacity-80">{leading}</span> : null}
          <div className="min-w-0">
            <div className="truncate text-[length:var(--fs-md)] font-medium text-(--ui-fg)">
              Active model
            </div>
            <div className="mt-0.5 truncate text-[length:var(--fs-sm)] text-(--ui-muted)">
              Controller-loaded recipe
            </div>
          </div>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <div
                className="min-w-0 truncate font-mono text-[length:var(--fs-md)] text-(--ui-fg)"
                title={typeof title === "string" ? title : undefined}
              >
                {title}
              </div>
              {status ? <div className="shrink-0">{status}</div> : null}
            </div>
            <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
              {subtitle ? (
                <span
                  className="max-w-full truncate"
                  title={typeof subtitle === "string" ? subtitle : undefined}
                >
                  {subtitle}
                </span>
              ) : null}
              {details?.map((item) => (
                <span key={String(item.label)} className="shrink-0">
                  {item.label} <span className="text-(--ui-fg)">{item.value}</span>
                </span>
              ))}
            </div>
            {progress ? (
              <div className="mt-1 text-[length:var(--fs-sm)] text-(--ui-muted)">{progress}</div>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The row's trailing cell.
 *
 * A read-only value belongs beside the status it qualifies, not stranded
 * mid-row — left-aligning it opened a dead gap between the text and the badge
 * at the right edge. Controls keep their natural width so an input never
 * stretches across empty space.
 */
function RowValueCell({
  control,
  value,
  interactive,
}: {
  control?: ReactNode;
  value?: ReactNode;
  interactive: boolean;
}) {
  if (!control && !value) return null;
  return (
    <div
      className={cx("min-w-0", control ? "shrink-0" : "text-right")}
      onClick={control && interactive ? (event) => event.stopPropagation() : undefined}
    >
      {control ?? value}
    </div>
  );
}

/** Chevron shown only when a row actually has something to reveal. */
function DisclosureChevron({ expanded }: { expanded: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "flex h-5 w-5 shrink-0 items-center justify-center text-(--ui-muted) transition-transform duration-150",
        expanded ? "rotate-90" : "",
      )}
    >
      <ChevronRight className="h-3.5 w-3.5" />
    </span>
  );
}

export function ModelRow({
  label,
  description,
  leading,
  value,
  control,
  status,
  actions,
  children,
  variant = "default",
  className,
  onClick,
  expanded,
}: ModelRowProps) {
  const interactive = Boolean(onClick);
  const stopRowClick = interactive
    ? (event: ReactMouseEvent) => event.stopPropagation()
    : undefined;
  return (
    <div
      className={cx(
        "group min-w-0",
        interactive
          ? "cursor-pointer transition-colors hover:bg-(--ui-hover)/35 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-(--ui-info)/45"
          : "",
        className,
      )}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-expanded={interactive && children ? Boolean(expanded) : undefined}
    >
      <div
        className={cx(
          "flex min-h-9 min-w-0 items-center gap-2.5 px-2.5",
          variant === "catalog" ? "py-2.5" : "py-2",
        )}
      >
        {leading ? <span className="flex shrink-0 items-center">{leading}</span> : null}
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-[length:var(--fs-md)] font-medium text-(--ui-fg)"
            title={label}
          >
            {label}
          </div>
          {description ? (
            <div
              className="mt-0.5 truncate text-[length:var(--fs-sm)] text-(--ui-muted)"
              title={description}
            >
              {description}
            </div>
          ) : null}
        </div>
        <RowValueCell control={control} value={value} interactive={interactive} />
        {status ? (
          <div className="shrink-0" onClick={stopRowClick}>
            {status}
          </div>
        ) : null}
        {actions ? (
          <div className="flex shrink-0 items-center gap-1" onClick={stopRowClick}>
            {actions}
          </div>
        ) : null}
        {interactive && children ? <DisclosureChevron expanded={Boolean(expanded)} /> : null}
      </div>
      {children ? (
        <div className="px-2.5 pb-2.5">
          <div className="rounded-[10px] bg-(--ui-surface-2) px-3 py-2">{children}</div>
        </div>
      ) : null}
    </div>
  );
}

export function ModelValue({
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
      className={cx(
        "truncate text-[length:var(--fs-md)]",
        mono ? "font-mono" : "",
        dim ? "text-(--ui-muted)" : "text-(--ui-fg)",
      )}
      title={typeof children === "string" ? children : undefined}
    >
      {children || "Not set"}
    </div>
  );
}

export function ModelStatus({
  tone = "default",
  children,
}: {
  tone?: ModelStatusTone;
  children: ReactNode;
}) {
  return (
    <StatusPill tone={tone} variant="dot" className="text-[length:var(--fs-xs)]">
      {children}
    </StatusPill>
  );
}
