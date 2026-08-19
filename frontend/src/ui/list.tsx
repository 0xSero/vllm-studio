"use client";

import type { ReactNode } from "react";
import { cx } from "./utils";

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
  description?: ReactNode;
  value?: ReactNode;
  control?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const primaryValue = control ?? value;

  return (
    <div
      className={cx("rounded-md px-2 py-2 transition-colors hover:bg-(--ui-hover)/30", className)}
    >
      <div className="grid min-h-7 grid-cols-1 gap-1.5 md:grid-cols-[minmax(168px,0.3fr)_minmax(0,1fr)] md:items-center md:gap-4">
        <div className="min-w-0">
          <div
            className="truncate text-[length:var(--fs-base)] font-medium text-(--ui-fg)"
            title={label}
          >
            {label}
          </div>
          {description ? (
            <div className="mt-0.5 text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
              {description}
            </div>
          ) : null}
        </div>
        <div className="flex min-w-0 items-center justify-end gap-2">
          {primaryValue ? <div className="min-w-0 flex-1">{primaryValue}</div> : null}
          {status ? <div className="shrink-0">{status}</div> : null}
          {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
        </div>
      </div>
      {children ? (
        <div className="mt-2 grid grid-cols-1 gap-1.5 md:grid-cols-[minmax(168px,0.3fr)_minmax(0,1fr)] md:gap-4">
          <div className="hidden md:block" />
          <div className="min-w-0">{children}</div>
        </div>
      ) : null}
    </div>
  );
}

export function RowValue({
  children,
  mono = false,
  dim = false,
  truncate = false,
  wrap = false,
  className,
}: {
  children: ReactNode;
  mono?: boolean;
  dim?: boolean;
  truncate?: boolean;
  wrap?: boolean;
  className?: string;
}) {
  const value =
    children === null || children === undefined || children === "" ? "Not set" : children;
  return (
    <div
      className={cx(
        "text-[length:var(--fs-base)]",
        mono ? "font-mono text-[length:var(--fs-md)]" : "",
        dim ? "text-(--ui-muted)" : "text-(--ui-fg)/80",
        truncate ? "min-w-0 truncate" : "",
        wrap && !truncate ? "min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]" : "",
        className,
      )}
      title={typeof children === "string" ? children : undefined}
    >
      {value}
    </div>
  );
}

export function EmptySafeNotice({ children }: { children: ReactNode }) {
  return (
    <div className="px-3.5 py-2.5 text-[length:var(--fs-md)] leading-relaxed text-(--ui-muted)">
      {children}
    </div>
  );
}

export function KeyValueRow({
  label,
  value,
  tone = "default",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: "default" | "ok" | "error";
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex items-baseline justify-between gap-3 text-[length:var(--fs-xs)]",
        className,
      )}
    >
      <dt className="text-(--ui-muted)">{label}</dt>
      <dd
        className={cx(
          "min-w-0 truncate text-right font-mono",
          tone === "ok" ? "text-(--ok)" : tone === "error" ? "text-(--err)" : "text-(--ui-fg)",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
