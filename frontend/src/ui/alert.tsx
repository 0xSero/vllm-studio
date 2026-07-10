"use client";

import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "@/ui/icon-registry";

type AlertVariant = "info" | "success" | "warning" | "error";

interface AlertProps {
  variant?: AlertVariant;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

const variantConfig: Record<AlertVariant, { classes: string; DefaultIcon: typeof Info }> = {
  info: {
    classes: "border-(--ui-info)/30 bg-(--ui-info)/10 text-(--ui-info)",
    DefaultIcon: Info,
  },
  success: {
    classes: "border-(--ui-success)/30 bg-(--ui-success)/10 text-(--ui-success)",
    DefaultIcon: CheckCircle2,
  },
  warning: {
    classes: "border-(--ui-warning)/30 bg-(--ui-warning)/10 text-(--ui-warning)",
    DefaultIcon: TriangleAlert,
  },
  error: {
    classes: "border-(--ui-danger)/30 bg-(--ui-danger)/10 text-(--ui-danger)",
    DefaultIcon: AlertCircle,
  },
};

function Alert({ variant = "info", icon, children, className = "" }: AlertProps) {
  const config = variantConfig[variant];
  const IconComponent = config.DefaultIcon;
  const live = variant === "error" ? "assertive" : variant === "info" ? undefined : "polite";

  return (
    <div
      role={variant === "error" ? "alert" : live ? "status" : undefined}
      aria-live={live}
      className={`rounded-lg border p-4 ${config.classes} ${className}`}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5">{icon || <IconComponent className="h-4 w-4" />}</div>
        <div className="text-sm">{children}</div>
      </div>
    </div>
  );
}

export { Alert };
export type { AlertProps, AlertVariant };
