"use client";

import { useState, type ReactNode } from "react";
import { cx } from "@/ui/utils";

/**
 * The table language every Models tab is drawn in.
 *
 * Recommended settled the vocabulary — a borderless table on the page ground,
 * hairline-free rows separated by space, group headers as full-width rows, and
 * numbers right-aligned in tabular figures — and the other three tabs are the
 * same instrument pointed at different data. Keeping the primitives in one file
 * is what makes "the same" literal rather than approximate: a padding change
 * here moves all four tabs together.
 */
export function TableFrame({
  children,
  minWidthClass = "min-w-[46rem]",
}: {
  children: ReactNode;
  minWidthClass?: string;
}) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className={cx("w-full border-collapse tabular-nums", minWidthClass)}>{children}</table>
    </div>
  );
}

/**
 * A column header, sortable or not.
 *
 * The sort arrow sits *before* the label and always reserves its width, so the
 * header text ends on exactly the same right edge as the numbers underneath it
 * whether the column is sorted or not — and nothing shifts when you click.
 */
export function HeadCell({
  children,
  numeric,
  title,
  active,
  desc,
  onSort,
}: {
  children: string;
  numeric?: boolean;
  title?: string;
  active?: boolean;
  desc?: boolean;
  onSort?: () => void;
}) {
  const label = (
    <>
      <span aria-hidden className={cx("inline-block w-2 text-(--dim)/60", onSort ? "mr-1" : "")}>
        {onSort && active ? (desc ? "↓" : "↑") : ""}
      </span>
      {children}
    </>
  );
  return (
    <th
      className={cx("px-3 pb-2 font-medium", numeric ? "text-right" : "text-left")}
      aria-sort={onSort ? (active ? (desc ? "descending" : "ascending") : "none") : undefined}
    >
      {onSort ? (
        <button
          type="button"
          onClick={onSort}
          title={title}
          className={cx(
            "text-[length:var(--fs-xs)] font-medium transition-colors hover:text-(--fg)",
            active ? "text-(--dim)" : "text-(--dim)/70",
          )}
        >
          {label}
        </button>
      ) : (
        <span title={title} className="text-[length:var(--fs-xs)] font-medium text-(--dim)/70">
          {label}
        </span>
      )}
    </th>
  );
}

/** A section break inside the table body: what this run of rows is, and a count. */
export function GroupRow({
  colSpan,
  label,
  blurb,
  right,
}: {
  colSpan: number;
  label: string;
  blurb?: string;
  right?: ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 pb-1.5 pt-6">
        <div className="flex items-baseline justify-between gap-4">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <span className="shrink-0 text-[length:var(--fs-xs)] font-medium text-(--dim)">
              {label}
            </span>
            {blurb ? (
              <span className="truncate text-[length:var(--fs-xs)] text-(--dim)/60">{blurb}</span>
            ) : null}
          </div>
          {right ? (
            <span className="shrink-0 text-[length:var(--fs-xs)] text-(--dim)/60">{right}</span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

/**
 * A body row. Rows that cannot be acted on are dimmed rather than reddened —
 * the eye should land on what is usable, not on what is broken.
 */
export function DataRow({
  children,
  onOpen,
  ariaLabel,
  dimmed,
  className,
}: {
  children: ReactNode;
  onOpen?: () => void;
  ariaLabel?: string;
  dimmed?: boolean;
  className?: string;
}) {
  return (
    <tr
      onClick={onOpen}
      onKeyDown={
        onOpen
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
      tabIndex={onOpen ? 0 : undefined}
      aria-label={ariaLabel}
      className={cx(
        "group transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-(--ui-accent)/40",
        onOpen ? "cursor-pointer hover:bg-(--hover)/45" : "",
        dimmed ? "opacity-45" : "",
        className,
      )}
    >
      {children}
    </tr>
  );
}

/** Leftmost cell: identity. Rounded so the hover wash has a shaped left edge. */
export function LeadCell({ children }: { children: ReactNode }) {
  return <td className="rounded-l-lg px-3 py-2">{children}</td>;
}

/** A right-aligned value cell, with an optional quieter second line beneath. */
export function NumCell({
  children,
  sub,
  strong,
  title,
}: {
  children: ReactNode;
  sub?: ReactNode;
  strong?: boolean;
  title?: string;
}) {
  return (
    // whitespace-nowrap: a value like "~155 GB" wrapping onto two lines makes
    // the row twice as tall as its neighbours and breaks the scan down the
    // column. Narrow viewports scroll the table instead.
    <td className="whitespace-nowrap px-3 py-2 text-right" title={title}>
      <div
        className={cx(
          strong
            ? "text-[length:var(--fs-md)] font-medium text-(--fg)"
            : "text-[length:var(--fs-sm)] text-(--dim)",
        )}
      >
        {children}
      </div>
      {sub ? (
        // Capped and truncated: a sub-line can be an arbitrary sentence from
        // the controller (a runtime description, a failure reason), and an
        // uncapped nowrap cell drags every column after it off the viewport.
        <div className="ml-auto max-w-[13rem] truncate text-[length:var(--fs-xs)] text-(--dim)/60">
          {sub}
        </div>
      ) : null}
    </td>
  );
}

/** Rightmost cell: status, and the row's action revealed on hover. */
export function EndCell({ children }: { children: ReactNode }) {
  return <td className="rounded-r-lg px-3 py-2 text-right">{children}</td>;
}

/**
 * The one accent on a row: invisible until the row is hovered or focused, so a
 * table of thirty rows does not read as thirty buttons.
 */
export function RowAction({
  children,
  onClick,
  disabled,
  title,
  tone = "accent",
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  tone?: "accent" | "danger" | "quiet";
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      // -mr-2 cancels the button's own right padding so its label lands on the
      // same right edge as the plain-text statuses and the header above.
      className={cx(
        "-mr-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[length:var(--fs-xs)] font-medium opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 group-hover:opacity-100 disabled:cursor-not-allowed",
        tone === "danger"
          ? "text-(--err) focus-visible:ring-(--err)/50"
          : tone === "quiet"
            ? "text-(--dim) focus-visible:ring-(--dim)/50"
            : "text-(--link) focus-visible:ring-(--link)/50",
      )}
    >
      {children}
    </button>
  );
}

/** Plain right-aligned status text, the resting state of the end cell. */
export function StatusText({
  children,
  tone = "dim",
}: {
  children: ReactNode;
  tone?: "dim" | "error" | "ok";
}) {
  return (
    <span
      className={cx(
        "text-[length:var(--fs-xs)]",
        tone === "error" ? "text-(--err)" : tone === "ok" ? "text-(--ok)" : "text-(--dim)",
      )}
    >
      {children}
    </span>
  );
}

/** Skeleton rows shaped like the table that is about to replace them. */
export function TableSkeleton({
  columns,
  rows = 6,
  minWidthClass,
}: {
  columns: readonly string[];
  rows?: number;
  minWidthClass?: string;
}) {
  return (
    <TableFrame minWidthClass={minWidthClass}>
      <thead>
        <tr>
          {columns.map((label, index) => (
            <HeadCell key={label} numeric={index > 0}>
              {label}
            </HeadCell>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colSpan={columns.length} className="px-3 pb-1.5 pt-6">
            <div className="h-3 w-24 animate-pulse rounded bg-(--ui-hover)" />
          </td>
        </tr>
        {Array.from({ length: rows }, (_, row) => (
          <tr key={row}>
            <td className="px-3 py-2">
              <div className="flex items-center gap-2.5">
                <div className="h-6 w-6 shrink-0 animate-pulse rounded-md bg-(--ui-hover)" />
                <div className="h-3.5 w-40 animate-pulse rounded bg-(--ui-hover)" />
              </div>
            </td>
            {columns.slice(1).map((label, cell) => (
              <td key={label} className="px-3 py-2">
                {cell < columns.length - 2 ? (
                  <div
                    className="ml-auto h-3 animate-pulse rounded bg-(--ui-hover)/70"
                    style={{ width: `${40 + (cell % 3) * 8}px` }}
                  />
                ) : null}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </TableFrame>
  );
}

/** The empty / error state, drawn as quietly as the table it stands in for. */
export function TableNotice({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 px-3 py-10">
      <div className="text-[length:var(--fs-md)] font-medium text-(--fg)">{title}</div>
      <p className="max-w-lg text-[length:var(--fs-sm)] leading-5 text-(--dim)">{body}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Section summary
 *
 * A table answers "which row", but not "how much of this is there at
 * all". StatStrip is the sentence a section opens with, and it is
 * deliberately bound to the table directly beneath it rather than
 * floating at the top of the page as a global dashboard — a number you
 * cannot trace to rows you can see is a number nobody trusts.
 * ------------------------------------------------------------------ */

export type StatTone = "default" | "ok" | "warn" | "err";

const STAT_TONE_CLASS: Record<StatTone, string> = {
  default: "text-(--fg)",
  ok: "text-(--ok)",
  warn: "text-(--warn)",
  err: "text-(--err)",
};

export type Stat = {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  /** What this number is actually counting. Every stat that can be misread carries one. */
  title?: string;
  tone?: StatTone;
};

/** One cell of a StatStrip. Exported so a lone stat can stand outside a grid. */
export function StatCell({ label, value, sub, title, tone = "default" }: Stat) {
  return (
    <div className="min-w-0 px-3 py-2 first:pl-0" title={title}>
      <div className="truncate text-[length:var(--fs-xs)] text-(--dim)/70">{label}</div>
      <div
        className={cx(
          "mt-0.5 truncate text-[length:var(--fs-md)] font-medium tabular-nums",
          STAT_TONE_CLASS[tone],
        )}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 truncate text-[length:var(--fs-xs)] text-(--dim)/60">{sub}</div>
      ) : null}
    </div>
  );
}

/**
 * The stats for one section, driven from an array so each surface states its
 * numbers as data rather than as another copy of this markup.
 */
export function StatStrip({ stats }: { stats: readonly Stat[] }) {
  return (
    <div className="grid grid-cols-2 divide-x divide-(--ui-separator) border-b border-(--ui-separator) pb-3 sm:grid-cols-3 lg:grid-cols-6">
      {stats.map((stat) => (
        <StatCell key={stat.label} {...stat} />
      ))}
    </div>
  );
}

/**
 * A NumCell that also ranks.
 *
 * The rule is 2px, sits under the number and bleeds to the cell's right edge,
 * so the column still reads as numbers first and the bar is only a way to see
 * the shape of the distribution without a second chart. `share` is 0–1.
 */
export function BarCell({
  children,
  sub,
  share,
  title,
}: {
  children: ReactNode;
  sub?: ReactNode;
  share: number;
  title?: string;
}) {
  const width = Math.min(100, Math.max(share > 0 ? 2 : 0, share * 100));
  return (
    <td className="whitespace-nowrap px-3 py-2 text-right" title={title}>
      <div className="text-[length:var(--fs-sm)] text-(--fg)">{children}</div>
      <div className="ml-auto mt-1 h-0.5 w-full max-w-[7rem] overflow-hidden rounded-full bg-(--ui-surface-2)">
        <div className="h-full rounded-full bg-(--accent)/35" style={{ width: `${width}%` }} />
      </div>
      {sub ? (
        <div className="ml-auto mt-1 max-w-[13rem] truncate text-[length:var(--fs-xs)] text-(--dim)/60">
          {sub}
        </div>
      ) : null}
    </td>
  );
}

const EXPAND_AT = 180;

/**
 * A long error message inside a table cell.
 *
 * Clamped to two lines so one stack trace cannot own the whole viewport, with
 * the full text one click away — truncating an error to an ellipsis and
 * offering no way back is how a log stops being useful.
 */
export function ExpandText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const expandable = text.length > EXPAND_AT || text.includes("\n");
  return (
    <div className="min-w-0">
      <div
        className={cx(
          "whitespace-pre-wrap break-words text-[length:var(--fs-xs)] leading-4 text-(--dim)",
          open ? "" : "line-clamp-2",
        )}
      >
        {text}
      </div>
      {expandable ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setOpen((current) => !current);
          }}
          className="mt-1 text-[length:var(--fs-xs)] text-(--link) hover:underline"
        >
          {open ? "Show less" : "Show full message"}
        </button>
      ) : null}
    </div>
  );
}
