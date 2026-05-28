"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "./button";

interface RefreshButtonProps {
  onRefresh: () => void;
  loading?: boolean;
  className?: string;
}

function RefreshButton({ onRefresh, loading = false, className = "" }: RefreshButtonProps) {
  return (
    <Button variant="icon" onClick={onRefresh} disabled={loading} className={className}>
      <RefreshCw className={`h-4 w-4 text-(--ui-muted) ${loading ? "animate-spin" : ""}`} />
    </Button>
  );
}

export { RefreshButton };
export type { RefreshButtonProps };
