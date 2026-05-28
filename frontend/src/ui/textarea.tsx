"use client";

import { forwardRef, type TextareaHTMLAttributes } from "react";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, className = "", id, ...props },
  ref,
) {
  const textareaId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

  return (
    <div>
      {label && (
        <label
          htmlFor={textareaId}
          className="mb-2 block text-xs font-medium uppercase tracking-wider text-(--ui-muted)"
        >
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={textareaId}
        className={`w-full resize-none rounded-lg border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm text-(--ui-fg) transition-all placeholder:text-(--ui-muted)/50 focus:border-(--ui-accent) focus:outline-none focus:ring-1 focus:ring-(--ui-accent)/20 ${error ? "border-(--ui-danger)" : ""} ${className}`}
        {...props}
      />
      {error && <p className="mt-1.5 text-xs text-(--ui-danger)">{error}</p>}
    </div>
  );
});

export { Textarea };
export type { TextareaProps };
