import { Loader2, RefreshCw } from "lucide-react";
import { cx } from "./utils";

const SPINNER_SIZES = {
  xs: "h-3 w-3",
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-5 w-5",
} as const;

export type SpinnerSize = keyof typeof SPINNER_SIZES;

export function Spinner({
  size = "md",
  variant = "loader",
  className,
}: {
  size?: SpinnerSize;
  variant?: "loader" | "refresh";
  className?: string;
}) {
  const Icon = variant === "refresh" ? RefreshCw : Loader2;
  return <Icon className={cx(SPINNER_SIZES[size], "animate-spin", className)} aria-hidden />;
}
