import type { HTMLAttributes } from "react";
import { cx } from "../utils";

export type MessageRole = "user" | "assistant" | "system";

export type MessageProps = HTMLAttributes<HTMLElement> & {
  from: MessageRole;
  label?: string;
};

export function Message({ from, label, className, children, ...props }: MessageProps) {
  const name = label ?? (from === "assistant" ? "Agent" : from === "user" ? "Operator" : "System");
  return (
    <article
      data-role={from}
      aria-label={`${name} message`}
      className={cx(
        "group flex w-full flex-col gap-1.5 text-[length:var(--fs-base)]",
        from === "user" && "items-end",
        className,
      )}
      {...props}
    >
      <span className="font-mono text-[length:var(--fs-xs)] uppercase tracking-[0.12em] text-(--ui-muted)">
        {name}
      </span>
      {children}
    </article>
  );
}

export function MessageContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "max-w-[min(78ch,92%)] border border-(--ui-border) bg-(--ui-surface) px-3 py-2.5 leading-6 text-(--ui-fg) forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]",
        "group-data-[role=user]:bg-(--ui-hover)",
        className,
      )}
      {...props}
    />
  );
}

export function MessageActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="group"
      aria-label="Message actions"
      className={cx("flex min-h-11 items-center gap-1", className)}
      {...props}
    />
  );
}
