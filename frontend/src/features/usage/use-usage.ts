"use client";

import { useCallback, useRef, useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { normalizeUsageStats } from "@local-studio/contracts/usage";
import api from "@/lib/api/client";
import {
  createHeadApiClient,
  getHeadConnection,
  HEAD_CONNECTION_CHANGED_EVENT,
  HEAD_CONNECTION_STORAGE_KEY,
  type HeadConnection,
} from "@/lib/api/head-controller";
import { readPageCache, writePageCache } from "@/lib/page-data-cache";
import type { UsageStats } from "@/lib/types";

type UsageScope =
  | { cacheKey: string; head: HeadConnection }
  | { cacheKey: "usage:stats:local"; head: null };

const usageScope = (): UsageScope => {
  const head = getHeadConnection();
  return head
    ? { cacheKey: `usage:stats:head:${head.url}`, head }
    : { cacheKey: "usage:stats:local", head: null };
};

export function useUsage() {
  const [scope, setScope] = useState<UsageScope>(usageScope);
  const [stats, setStats] = useState<UsageStats | null>(() =>
    readPageCache<UsageStats>(usageScope().cacheKey),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const loadStats = useCallback(async () => {
    const nextScope = usageScope();
    const requestId = ++requestSequence.current;
    setScope(nextScope);
    try {
      setLoading(true);
      setError(null);
      const normalized = normalizeUsageStats(
        await (nextScope.head ? createHeadApiClient(nextScope.head) : api).getUsageStats(),
      );
      if (requestId !== requestSequence.current) return;
      writePageCache(nextScope.cacheKey, normalized);
      setStats(normalized);
    } catch (cause) {
      if (requestId === requestSequence.current) setError((cause as Error).message);
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, []);

  useMountSubscription(() => {
    const reload = () => {
      const nextScope = usageScope();
      setScope(nextScope);
      setStats(readPageCache<UsageStats>(nextScope.cacheKey));
      void loadStats();
    };
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === HEAD_CONNECTION_STORAGE_KEY) reload();
    };
    reload();
    window.addEventListener(HEAD_CONNECTION_CHANGED_EVENT, reload);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(HEAD_CONNECTION_CHANGED_EVENT, reload);
      window.removeEventListener("storage", onStorage);
    };
  }, [loadStats]);

  return { stats, loading, error, loadStats, head: scope.head };
}
