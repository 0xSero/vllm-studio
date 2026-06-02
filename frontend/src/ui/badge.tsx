"use client";

import type { ReactNode } from "react";

type BadgeVariant = "default" | "success" | "warning" | "error" | "accent" | "muted";
type BadgeSize = "sm" | "md";

interface BadgeProps {
  variant?: BadgeVariant;
  size?: BadgeSize;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "border border-(--ui-border) bg-(--ui-surface) text-(--ui-fg)",
  success: "border border-(--ui-success)/30 bg-(--ui-success)/20 text-(--ui-success)",
  warning: "border border-(--ui-warning)/30 bg-(--ui-warning)/20 text-(--ui-warning)",
  error: "border border-(--ui-danger)/30 bg-(--ui-danger)/20 text-(--ui-danger)",
  accent: "border border-(--ui-accent)/30 bg-(--ui-accent)/20 text-(--ui-accent)",
  muted: "border border-(--ui-border) bg-(--ui-border)/20 text-(--ui-muted)",
};

const sizeClasses: Record<BadgeSize, string> = {
  sm: "px-1.5 py-0.5 text-[length:var(--fs-sm)]",
  md: "px-2 py-1 text-xs",
};

function Badge({ variant = "default", size = "md", icon, children, className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded font-medium ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
    >
      {icon && <span className="mr-1">{icon}</span>}
      {children}
    </span>
  );
}

export { Badge };
export type { BadgeProps, BadgeVariant, BadgeSize };
