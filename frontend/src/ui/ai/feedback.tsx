import type { HTMLAttributes, ReactNode } from "react";
import {
  Activity,
  Check,
  ChevronRight,
  Clock,
  ExternalLink,
  MessageSquare,
  Wrench,
} from "@/ui/icon-registry";
import { cx } from "../utils";

export type ReasoningSummaryProps = HTMLAttributes<HTMLDetailsElement> & {
  summary: string;
  duration?: string;
};

export function ReasoningSummary({
  summary,
  duration,
  className,
  ...props
}: ReasoningSummaryProps) {
  return (
    <details
      className={cx(
        "group border-l-2 border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-(--ui-fg) forced-colors:border-[CanvasText]",
        className,
      )}
      {...props}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)">
        <ChevronRight className="size-4" aria-hidden />
        Reasoning summary
        {duration ? <span className="ml-auto font-mono text-(--ui-muted)">{duration}</span> : null}
      </summary>
      <p className="pb-2 pl-6 leading-6 text-(--ui-muted)">{summary}</p>
    </details>
  );
}

export function Reasoning(props: ReasoningSummaryProps) {
  return <ReasoningSummary {...props} />;
}

export type ToolUseState = "pending" | "running" | "completed" | "failed";

export function ToolUse({
  name,
  state,
  description,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDetailsElement> & {
  name: string;
  state: ToolUseState;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <details
      className={cx(
        "border border-(--ui-border) bg-(--ui-surface) forced-colors:border-[CanvasText]",
        className,
      )}
      {...props}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)">
        <Wrench className="size-4" aria-hidden />
        <span className="font-medium text-(--ui-fg)">{name}</span>
        <span className="ml-auto font-mono text-[length:var(--fs-xs)] uppercase text-(--ui-muted)">
          {state}
        </span>
      </summary>
      <div className="border-t border-(--ui-border) px-3 py-2 text-(--ui-muted)">
        {description ? <p>{description}</p> : null}
        {children}
      </div>
    </details>
  );
}

export function AgentCard({
  name,
  role,
  status,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {
  name: string;
  role: string;
  status: string;
  children?: ReactNode;
}) {
  return (
    <article
      aria-label={`${name} agent`}
      className={cx(
        "border border-(--ui-border) bg-(--ui-surface) p-3 forced-colors:border-[CanvasText]",
        className,
      )}
      {...props}
    >
      <header className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center border border-(--ui-border)">
          <MessageSquare className="size-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-(--ui-fg)">{name}</strong>
          <span className="block text-(--ui-muted)">{role}</span>
        </span>
        <span className="font-mono text-[length:var(--fs-xs)] uppercase text-(--ui-muted)">
          {status}
        </span>
      </header>
      {children ? <div className="mt-3 border-t border-(--ui-border) pt-3">{children}</div> : null}
    </article>
  );
}

export function Loader({
  label,
  state = "streaming",
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  label?: string;
  state?: "pending" | "streaming" | "complete";
}) {
  const Icon = state === "pending" ? Clock : state === "complete" ? Check : Activity;
  const resolvedLabel =
    label ??
    (state === "pending"
      ? "Agent is waiting"
      : state === "complete"
        ? "Agent completed"
        : "Agent is working");
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx("flex min-h-11 items-center gap-2 text-(--ui-muted)", className)}
      {...props}
    >
      <Icon className="size-4" aria-hidden />
      <span>{resolvedLabel}</span>
      <span className="sr-only">State: {state}</span>
    </div>
  );
}

export function Suggestion({
  children,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx(
        "min-h-11 border border-(--ui-border) bg-(--ui-surface) px-3 text-left text-(--ui-fg) hover:bg-(--ui-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) forced-colors:border-[ButtonText]",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function InlineCitation({
  href,
  index,
  title,
  className,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  index: number;
  title: string;
}) {
  return (
    <a
      href={href}
      aria-label={`Citation ${index}: ${title}`}
      className={cx(
        "inline-flex min-h-11 items-center gap-1 border-b border-(--ui-border) px-1 font-mono text-(--color-primary) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
        className,
      )}
      {...props}
    >
      [{index}]
      <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}
