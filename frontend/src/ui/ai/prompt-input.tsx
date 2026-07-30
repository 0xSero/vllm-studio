"use client";

import {
  forwardRef,
  type FormHTMLAttributes,
  type HTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { ArrowUp, Square } from "@/ui/icon-registry";
import { cx } from "../utils";

export type PromptInputStatus = "ready" | "submitted" | "streaming" | "error";

export function promptInputSubmitMode(status: PromptInputStatus): {
  active: boolean;
  label: string;
  type: "button" | "submit";
} {
  const active = status === "submitted" || status === "streaming";
  return {
    active,
    label: active ? "Stop response" : "Send message",
    type: active ? "button" : "submit",
  };
}

export const PromptInput = forwardRef<HTMLFormElement, FormHTMLAttributes<HTMLFormElement>>(
  function PromptInput({ className, ...props }, ref) {
    return (
      <form
        ref={ref}
        className={cx(
          "border border-(--ui-border) bg-(--ui-surface) focus-within:ring-2 focus-within:ring-(--ring) forced-colors:border-[CanvasText]",
          className,
        )}
        {...props}
      />
    );
  },
);

export function PromptInputBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("flex min-h-20 items-end gap-2 p-2", className)} {...props} />;
}

export const PromptInputTextarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function PromptInputTextarea({ className, rows = 2, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-label={props["aria-label"] ?? "Message"}
      className={cx(
        "min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-(--ui-fg) outline-none placeholder:text-(--ui-muted)",
        className,
      )}
      {...props}
    />
  );
});

export function PromptInputFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "flex min-h-11 items-center justify-between border-t border-(--ui-border) px-2",
        className,
      )}
      {...props}
    />
  );
}

export function PromptInputSubmit({
  status = "ready",
  onStop,
  onClick,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  status?: PromptInputStatus;
  onStop?: React.MouseEventHandler<HTMLButtonElement>;
}) {
  const mode = promptInputSubmitMode(status);
  return (
    <button
      type={mode.type}
      aria-label={mode.label}
      aria-busy={mode.active}
      onClick={mode.active ? (onStop ?? onClick) : onClick}
      className={cx(
        "grid size-11 place-items-center bg-(--color-primary) text-(--color-primary-foreground) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) disabled:opacity-45 forced-colors:border forced-colors:border-[ButtonText]",
        className,
      )}
      {...props}
    >
      {mode.active ? (
        <Square className="size-4" aria-hidden />
      ) : (
        <ArrowUp className="size-4" aria-hidden />
      )}
    </button>
  );
}
