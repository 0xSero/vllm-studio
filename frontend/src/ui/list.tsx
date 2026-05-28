"use client";

import type { ReactNode } from "react";
import { cx } from "./utils";

export function ListGroup({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("mb-6 last:mb-0", className)}>
      {title || actions ? (
        <div className="mb-1.5 flex items-end justify-between gap-3 px-3.5">
          <h3 className="text-[12px] font-semibold tracking-[-0.005em] text-(--ui-muted)">
            {title}
          </h3>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      ) : null}
      <div className="overflow-hidden rounded-[var(--ui-radius-lg)] border border-(--ui-border) bg-(--ui-surface) [&>*+*]:before:pointer-events-none [&>*+*]:before:absolute [&>*+*]:before:left-3.5 [&>*+*]:before:right-0 [&>*+*]:before:top-0 [&>*+*]:before:h-px [&>*+*]:before:bg-(--ui-separator) [&>*]:relative">
        {children}
      </div>
      {description ? (
        <p className="mt-1.5 px-3.5 text-[11px] leading-relaxed text-(--ui-muted)">{description}</p>
      ) : null}
    </section>
  );
}

export function ListRow({
  label,
  description,
  value,
  control,
  status,
  actions,
  children,
  className,
}: {
  label: string;
  description?: string;
  value?: ReactNode;
  control?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex min-h-[40px] items-center justify-between gap-4 px-3.5 py-2.5",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-(--ui-fg)">{label}</div>
        {description ? (
          <div className="mt-0.5 text-[11px] leading-relaxed text-(--ui-muted)">{description}</div>
        ) : null}
        {children ? <div className="mt-1.5">{children}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {control ?? value ?? null}
        {status ? <div className="shrink-0">{status}</div> : null}
        {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </div>
    </div>
  );
}

export function RowValue({
  children,
  mono = false,
  dim = false,
  className,
}: {
  children: ReactNode;
  mono?: boolean;
  dim?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "text-[13px]",
        mono ? "font-mono text-[12px]" : "",
        dim ? "text-(--ui-muted)" : "text-(--ui-fg)/80",
        className,
      )}
      title={typeof children === "string" ? children : undefined}
    >
      {children || "Not set"}
    </div>
  );
}

export function EmptySafeNotice({ children }: { children: ReactNode }) {
  return (
    <div className="px-3.5 py-2.5 text-[12px] leading-relaxed text-(--ui-muted)">{children}</div>
  );
}

export function KeyValueRow({
  label,
  value,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex items-baseline justify-between gap-3 text-xs", className)}>
      <dt className="text-(--ui-muted)">{label}</dt>
      <dd className="min-w-0 truncate text-right font-mono text-(--ui-fg)">{value}</dd>
    </div>
  );
}
