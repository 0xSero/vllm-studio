"use client";

import { forwardRef, useId, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "@/ui/icon-registry";
import { useFormControlAttributes } from "./form-field-context";
import { FIELD_LABEL_CLASS } from "./utils";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options?: SelectOption[];
  placeholder?: string;
  compact?: boolean;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    options,
    placeholder,
    compact = false,
    children,
    className = "",
    id,
    required,
    "aria-describedby": ariaDescribedBy,
    "aria-invalid": ariaInvalid,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const field = useFormControlAttributes({
    id,
    required,
    describedBy: ariaDescribedBy,
    invalid: ariaInvalid,
  });
  const selectId = field.id ?? (label ? generatedId : undefined);

  return (
    <div className={compact ? "inline-block" : undefined}>
      {label && (
        <label htmlFor={selectId} className={FIELD_LABEL_CLASS}>
          {label}
        </label>
      )}
      <div className={compact ? "relative inline-block min-w-0" : "relative min-w-0"}>
        <select
          ref={ref}
          id={selectId}
          data-ui-control="field"
          required={field.required}
          aria-describedby={field.describedBy}
          aria-invalid={field.invalid}
          className={`${compact ? "h-6 w-auto min-w-24 border-(--ui-separator)/65 bg-(--ui-fg)/5 pl-2 pr-6 text-[length:var(--fs-xs)]" : "h-[var(--control-height)] w-full border-(--ui-separator) bg-(--ui-surface) pl-2 pr-7 text-[length:var(--fs-sm)]"} appearance-none rounded-[5px] border text-(--ui-fg) transition-[background-color,border-color,box-shadow] duration-[var(--motion-fast)] hover:border-(--ui-border-heavy) focus:border-(--ui-border-heavy) focus:bg-(--ui-bg) focus:outline-none focus-visible:ring-1 focus-visible:ring-(--focus-ring) disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-50 ${className}`}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options
            ? options.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))
            : children}
        </select>
        <ChevronDown
          className={`pointer-events-none absolute top-1/2 h-3 w-3 -translate-y-1/2 text-(--ui-muted) ${compact ? "right-1.5" : "right-2"}`}
        />
      </div>
    </div>
  );
});

export { Select };
export type { SelectProps, SelectOption };
