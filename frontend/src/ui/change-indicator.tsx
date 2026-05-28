"use client";

import { TrendingUp, TrendingDown } from "lucide-react";

interface ChangeIndicatorProps {
  value: number | null;
  positiveColor?: string;
  negativeColor?: string;
}

function ChangeIndicator({
  value,
  positiveColor = "text-(--ui-success)",
  negativeColor = "text-(--ui-danger)",
}: ChangeIndicatorProps) {
  if (value === null || value === undefined)
    return <span className="text-(--ui-muted)">&mdash;</span>;
  const isPositive = value > 0;
  const Icon = isPositive ? TrendingUp : TrendingDown;
  return (
    <div className={`flex items-center gap-1 ${isPositive ? positiveColor : negativeColor}`}>
      <Icon className="h-3 w-3" />
      <span className="text-xs tabular-nums">{Math.abs(value).toFixed(1)}%</span>
    </div>
  );
}

export { ChangeIndicator };
export type { ChangeIndicatorProps };
