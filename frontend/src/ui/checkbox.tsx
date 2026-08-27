"use client";

import { Check } from "@/ui/icon-registry";

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  className?: string;
  labelClassName?: string;
}

function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  className = "",
  labelClassName = "",
}: CheckboxProps) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2 ${disabled ? "cursor-not-allowed opacity-50" : ""} ${className}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-[background-color,border-color,color,box-shadow] peer-focus-visible:ring-1 peer-focus-visible:ring-(--focus-ring) peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-(--ui-bg) ${
          checked
            ? "border-(--ui-accent) bg-(--ui-accent) text-(--color-primary-foreground)"
            : "border-(--ui-border-heavy) bg-(--ui-surface) text-transparent"
        }`}
      >
        <Check className="h-2.5 w-2.5" strokeWidth={2.4} />
      </span>
      {(label || description) && (
        <div>
          {label && (
            <span
              className={`text-[length:var(--fs-sm)] font-medium text-(--ui-fg) ${labelClassName}`}
            >
              {label}
            </span>
          )}
          {description && (
            <p className="mt-0.5 text-[length:var(--fs-xs)] text-(--ui-muted)">{description}</p>
          )}
        </div>
      )}
    </label>
  );
}

export { Checkbox };
export type { CheckboxProps };
