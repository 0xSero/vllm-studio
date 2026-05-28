"use client";

import type { ReactNode } from "react";

interface FormFieldProps {
  label: string;
  required?: boolean;
  error?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

function FormField({
  label,
  required = false,
  error,
  description,
  children,
  className = "",
}: FormFieldProps) {
  return (
    <div className={className}>
      <label className="mb-2 block text-xs font-medium uppercase tracking-wider text-(--ui-muted)">
        {label}
        {required && <span className="text-(--ui-accent)"> *</span>}
      </label>
      {children}
      {description && <p className="mt-1.5 text-xs text-(--ui-muted)">{description}</p>}
      {error && <p className="mt-1.5 text-xs text-(--ui-danger)">{error}</p>}
    </div>
  );
}

export { FormField };
export type { FormFieldProps };
