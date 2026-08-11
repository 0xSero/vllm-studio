"use client";

import type { ReactNode } from "react";
import { ListRow, StatusPill, type ListRowProps, type UiTone } from "@/ui";
import { cx } from "@/ui/utils";

export type ModelStatusTone = UiTone;
export type ModelRowVariant = "default" | "catalog";

export type ModelSummaryItem = {
  label: string;
  value: ReactNode;
};

type ModelRowProps = Omit<ListRowProps, "variant"> & { variant?: ModelRowVariant };

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
      <div className="flex min-h-9 items-end justify-between gap-4 border-b border-(--ui-border)/75 pb-2">
        <div className="min-w-0">
          <h3 className="text-[length:var(--fs-md)] font-medium text-(--ui-fg)">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-[length:var(--fs-sm)] text-(--ui-muted)">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="divide-y divide-(--ui-border)/55">{children}</div>
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

export function ModelRow({ variant = "default", ...props }: ModelRowProps) {
  const value =
    props.value ?? (props.control ? undefined : <ModelValue dim>Not reported yet</ModelValue>);
  return <ListRow {...props} value={value} variant={variant === "catalog" ? "catalog" : "model"} />;
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
