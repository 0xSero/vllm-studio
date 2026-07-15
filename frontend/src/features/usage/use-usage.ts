"use client";

import { useCallback, useRef, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import api from "@/lib/api/client";
import { readPageCache, writePageCache } from "@/lib/page-data-cache";
import type { UsageStats } from "@/lib/types";
import { normalizeUsageStats } from "@/features/usage/normalize-usage-stats";

export type UsageSource = "provider" | "pi-sessions";

export function useUsage(source: UsageSource) {
  const [stats, setStats] = useState<UsageStats | null>(() =>
    readPageCache<UsageStats>(`usage:stats:${source}`),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const loadStats = useCallback(async () => {
    const requestId = ++requestSequence.current;
    try {
      setLoading(true);
      setError(null);
      const response =
        source === "pi-sessions" ? api.getPiSessionsUsageStats() : api.getUsageStats();
      const normalized = normalizeUsageStats(await response);
      if (requestId !== requestSequence.current) return;
      writePageCache(`usage:stats:${source}`, normalized);
      setStats(normalized);
    } catch (cause) {
      if (requestId === requestSequence.current) setError((cause as Error).message);
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [source]);

  useMountSubscription(() => {
    setStats(readPageCache<UsageStats>(`usage:stats:${source}`));
    void loadStats();
  }, [loadStats, source]);

  return { stats, loading, error, loadStats };
}
