"use client";

import type { ReactNode } from "react";

type CardPadding = "sm" | "md" | "lg";

interface CardProps {
  padding?: CardPadding;
  children: ReactNode;
  className?: string;
  bordered?: boolean;
}

const paddingClasses: Record<CardPadding, string> = {
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
};

function Card({ padding = "md", children, className = "", bordered = true }: CardProps) {
  return (
    <div
      className={`rounded-lg bg-(--ui-bg) ${bordered ? "border border-(--ui-border)" : ""} ${paddingClasses[padding]} ${className}`}
    >
      {children}
    </div>
  );
}

export { Card };
export type { CardProps, CardPadding };
