"use client";

import { useCallback } from "react";
import { useAsyncResource } from "@/hooks/use-async-resource";
import api from "@/lib/api/client";
import { readPageCache, writePageCache } from "@/lib/page-data-cache";
import type { UsageStats } from "@/lib/types";
import { normalizeUsageStats } from "@local-studio/contracts/usage";

export function useUsage() {
  const loadStats = useCallback(async () => normalizeUsageStats(await api.getUsageStats()), []);
  const {
    data: stats,
    loading,
    error,
    refresh,
  } = useAsyncResource(
    loadStats,
    readPageCache<UsageStats>("usage:stats:provider"),
    "Usage data unavailable",
    {
      onLoaded: useCallback(
        (value: UsageStats | null) => writePageCache("usage:stats:provider", value),
        [],
      ),
    },
  );
  return { stats, loading, error, loadStats: refresh };
}
