"use client";

import { forwardRef, type SelectHTMLAttributes } from "react";

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options?: SelectOption[];
  placeholder?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, options, placeholder, children, className = "", id, ...props },
  ref,
) {
  const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

  return (
    <div>
      {label && (
        <label
          htmlFor={selectId}
          className="mb-2 block text-xs font-medium uppercase tracking-wider text-(--ui-muted)"
        >
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        className={`w-full rounded-lg border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm text-(--ui-fg) transition-all focus:border-(--ui-accent) focus:outline-none focus:ring-1 focus:ring-(--ui-accent)/20 ${className}`}
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
    </div>
  );
});

export { Select };
export type { SelectProps, SelectOption };
