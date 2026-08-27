"use client";

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { useFormControlAttributes } from "./form-field-context";
import { cx, FIELD_LABEL_CLASS } from "./utils";

const modelInputBaseClasses =
  "h-6 w-full rounded-[5px] border border-transparent bg-(--ui-surface) px-2 text-[length:var(--fs-sm)] text-(--ui-fg) outline-none transition-[background-color,border-color,box-shadow] duration-[var(--motion-fast)] placeholder:text-(--ui-muted)/65 hover:border-(--ui-border-hover) focus:border-(--ui-border-heavy) focus:bg-(--ui-bg) focus-visible:ring-1 focus-visible:ring-(--focus-ring) disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-50";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    error,
    icon,
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
  const inputId = field.id ?? (label ? generatedId : undefined);
  const errorId = error ? `${inputId ?? generatedId}-error` : undefined;
  const describedBy = [field.describedBy, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      {label && (
        <label htmlFor={inputId} className={FIELD_LABEL_CLASS}>
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-(--ui-muted)"
          >
            {icon}
          </div>
        )}
        <input
          ref={ref}
          id={inputId}
          data-ui-control="field"
          required={field.required}
          aria-describedby={describedBy}
          aria-invalid={field.invalid ?? (error ? true : undefined)}
          className={`h-[var(--control-height)] w-full rounded-[5px] border border-(--ui-separator) bg-(--surface-3) px-2 text-[length:var(--fs-sm)] text-(--ui-fg) transition-[background-color,border-color,box-shadow] duration-[var(--motion-fast)] placeholder:text-(--hl2) hover:border-(--ui-border-heavy) focus:border-(--link)/70 focus:bg-(--ui-bg) focus:outline-none focus-visible:ring-1 focus-visible:ring-(--focus-ring) disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-50 ${icon ? "pl-8" : ""} ${error ? "border-(--ui-danger) focus:border-(--ui-danger)" : ""} ${className}`}
          {...props}
        />
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-(--ui-danger)">
          {error}
        </p>
      )}
    </div>
  );
});

export { Input };
export type { InputProps };

export type ModelInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  value: string;
  onChange: (value: string) => void;
};

export function ModelInput({
  value,
  onChange,
  type = "text",
  className,
  ...props
}: ModelInputProps) {
  return (
    <input
      {...props}
      type={type}
      data-ui-control="compact"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cx(modelInputBaseClasses, className)}
    />
  );
}
