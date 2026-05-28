"use client";

import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

function EmptyState({ icon, title, description, action, className = "" }: EmptyStateProps) {
  return (
    <div className={`text-center py-8 ${className}`}>
      {icon && <div className="mb-2 flex justify-center text-(--ui-muted) opacity-50">{icon}</div>}
      <p className="text-sm text-(--ui-muted)">{title}</p>
      {description && <p className="mt-1 text-xs text-(--ui-muted)">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export { EmptyState };
export type { EmptyStateProps };
