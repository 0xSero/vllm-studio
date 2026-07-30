"use client";

import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { ChevronDown } from "@/ui/icon-registry";
import { cx } from "../utils";

export function scrollConversationToEnd(target: HTMLElement | null): void {
  target?.scrollTo({ top: target.scrollHeight, behavior: "smooth" });
}

export const Conversation = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
  function Conversation({ className, ...props }, ref) {
    return (
      <section
        ref={ref}
        aria-label="Conversation"
        className={cx(
          "relative flex min-h-0 flex-1 flex-col border border-(--ui-border) bg-(--ui-bg) forced-colors:border-[CanvasText]",
          className,
        )}
        {...props}
      />
    );
  },
);

export function ConversationContent({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
      className={cx("min-h-0 flex-1 overflow-y-auto p-4", className)}
      {...props}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">{children}</div>
    </div>
  );
}

export function ConversationEmptyState({
  title,
  description,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cx(
        "mx-auto flex max-w-md flex-col items-center border border-dashed border-(--ui-border) p-6 text-center",
        className,
      )}
      {...props}
    >
      <h2 className="font-medium text-(--ui-fg)">{title}</h2>
      {description ? <p className="mt-1 text-(--ui-muted)">{description}</p> : null}
      {children}
    </div>
  );
}

export function ConversationScrollButton({
  target,
  className,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  target?: React.RefObject<HTMLElement | null>;
}) {
  return (
    <button
      type="button"
      aria-label="Scroll to latest message"
      onClick={() => scrollConversationToEnd(target?.current ?? null)}
      className={cx(
        "absolute bottom-3 right-3 grid size-11 place-items-center border border-(--ui-border) bg-(--ui-surface) text-(--ui-fg) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
        className,
      )}
      {...props}
    >
      <ChevronDown className="size-4" aria-hidden />
    </button>
  );
}
