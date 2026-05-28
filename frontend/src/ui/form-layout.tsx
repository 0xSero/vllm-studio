"use client";

import type { ReactNode } from "react";
import { Checkbox } from "./checkbox";
import { cx } from "./utils";

export function FormSection({
  icon,
  title,
  children,
  className,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("space-y-4", className)}>
      <div className="flex items-center gap-2 border-b border-(--ui-border)/50 pb-2 text-(--ui-fg)">
        {icon ? <span className="text-(--ui-accent)">{icon}</span> : null}
        <span className="text-sm font-medium">{title}</span>
      </div>
      {children}
    </section>
  );
}

export function CheckboxRow({
  checked,
  onChange,
  label,
  description,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={cx("rounded-md border border-(--ui-border) bg-(--ui-bg) p-3", className)}>
      <Checkbox
        checked={checked}
        onChange={onChange}
        label={label}
        description={description}
        className="items-start"
        labelClassName="text-(--ui-fg)"
      />
    </div>
  );
}
