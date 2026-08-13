"use client";

import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { StatusPill, type UiTone } from "@/ui";
import { ChevronRight } from "@/ui/icon-registry";
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
  expanded?: boolean;
};

const isActivationKey = (key: string) => key === "Enter" || key === " ";

const ROW_CARD =
  "flex min-w-0 flex-col rounded-[10px] border border-(--ui-border) bg-(--ui-surface) empty:hidden [&>*:first-child]:rounded-t-[9px] [&>*:last-child]:rounded-b-[9px] [&>*+*]:relative [&>*+*]:before:pointer-events-none [&>*+*]:before:absolute [&>*+*]:before:inset-x-2.5 [&>*+*]:before:top-0 [&>*+*]:before:h-px [&>*+*]:before:bg-(--ui-border)/70";

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
      <div className="flex min-h-9 items-end justify-between gap-4 pb-2">
        <div className="min-w-0">
          <h3 className="text-[length:var(--fs-md)] font-medium text-(--ui-fg)">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-[length:var(--fs-sm)] text-(--ui-muted)">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className={ROW_CARD}>{children}</div>
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
    <div className="px-2.5 py-2">
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
  const disclosure = expanded !== undefined;
  const stopRowClick = interactive
    ? (event: ReactMouseEvent) => event.stopPropagation()
    : undefined;
  const rowRole = interactive
    ? { role: "button" as const, tabIndex: 0, "aria-expanded": disclosure ? expanded : undefined }
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
              if (isActivationKey(event.key)) {
                event.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      {...rowRole}
    >
      <div
        className={cx(
          "flex min-h-7 min-w-0 flex-col gap-2 px-2.5 md:flex-row md:items-center md:gap-2.5",
          variant === "catalog" ? "py-2.5" : "py-2",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {leading ? <span className="flex shrink-0 items-center">{leading}</span> : null}
          <div className="min-w-0">
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
        </div>
        <div className="flex min-w-0 items-center justify-between gap-2.5 md:justify-end">
          <div
            className={cx("min-w-0", control ? "shrink-0" : "md:text-right")}
            onClick={control ? stopRowClick : undefined}
          >
            {control ?? value ?? <ModelValue dim>Not reported yet</ModelValue>}
          </div>
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
          {disclosure ? (
            <ChevronRight
              aria-hidden
              className={cx(
                "h-3.5 w-3.5 shrink-0 text-(--ui-muted) transition-transform duration-150",
                expanded ? "rotate-90" : "",
              )}
            />
          ) : null}
        </div>
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
