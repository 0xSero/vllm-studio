"use client";

import { Activity } from "@/ui/icon-registry";
import { Button } from "./button";

interface PageStateProps {
  loading: boolean;
  data: unknown | null;
  hasData: boolean;
  error?: string | null;
  onLoad: () => void;
}

function PageState({ loading, data, hasData, error, onLoad }: PageStateProps) {
  const isInitialLoading = loading && !hasData;

  if (isInitialLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-50 bg-background">
        <Activity className="h-6 w-6 animate-pulse text-(--ui-muted)" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex items-center justify-center h-full min-h-50 bg-background">
        <div className="text-center mb-0">
          <p className="mb-4 text-(--ui-danger)">{error}</p>
          <Button variant="secondary" onClick={onLoad}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

export { PageState };
export type { PageStateProps };
