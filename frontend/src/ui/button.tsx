"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "icon";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-(--ui-fg)/90 text-(--ui-bg) hover:bg-(--ui-fg) disabled:opacity-50 disabled:cursor-not-allowed",
  secondary:
    "border border-(--ui-border) text-(--ui-muted) hover:bg-(--ui-hover) hover:text-(--ui-fg) disabled:opacity-50",
  danger:
    "bg-(--ui-danger) text-(--destructive-foreground) hover:bg-(--ui-danger)/90 disabled:cursor-not-allowed disabled:opacity-50",
  ghost: "text-(--ui-muted) hover:bg-(--ui-fg)/[0.06] hover:text-(--ui-fg) disabled:opacity-50",
  icon: "text-(--ui-muted) hover:bg-(--ui-hover) hover:text-(--ui-fg) disabled:opacity-50",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-8 px-3 text-sm",
  lg: "h-9 px-4 text-sm",
};

const iconSizeClasses: Record<ButtonSize, string> = {
  sm: "h-7 w-7",
  md: "h-8 w-8",
  lg: "h-9 w-9",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    icon,
    children,
    className = "",
    disabled,
    type = "button",
    ...props
  },
  ref,
) {
  const isIcon = variant === "icon";
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-[var(--rad-md)] font-medium transition-[transform,color,background-color,border-color,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)/35 active:scale-[0.98]";
  const vClass = variantClasses[variant];
  const sClass = isIcon ? iconSizeClasses[size] : sizeClasses[size];

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={`${base} ${vClass} ${sClass} ${className}`}
      {...props}
    >
      {loading ? (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      ) : (
        icon
      )}
      {children}
    </button>
  );
});

export { Button };
export type { ButtonProps, ButtonVariant, ButtonSize };
