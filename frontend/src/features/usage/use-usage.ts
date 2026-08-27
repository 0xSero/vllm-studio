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

export type UsageTarget = { kind: "local" } | { kind: "head"; connection: HeadConnection };

type UsageScope = {
  cacheKey: string;
  head: HeadConnection | null;
  client: ReturnType<typeof createHeadApiClient> | typeof api;
};

const usageScope = (target?: UsageTarget): UsageScope => {
  if (target?.kind === "local") {
    return { cacheKey: "usage:stats:local", head: null, client: api };
  }
  if (target?.kind === "head") {
    return {
      cacheKey: `usage:stats:head:${target.connection.url}`,
      head: target.connection,
      client: createHeadApiClient(target.connection),
    };
  }
  const head = getHeadConnection();
  return head
    ? { cacheKey: `usage:stats:head:${head.url}`, head, client: createHeadApiClient(head) }
    : { cacheKey: "usage:stats:local", head: null, client: api };
};

export function useUsage(target?: UsageTarget) {
  const targetKey = target
    ? `${target.kind}:${target.kind === "local" ? "local" : target.connection.url}`
    : "automatic";
  const [scope, setScope] = useState<UsageScope>(() => usageScope(target));
  const [stats, setStats] = useState<UsageStats | null>(() =>
    readPageCache<UsageStats>(usageScope(target).cacheKey),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const loadStats = useCallback(async () => {
    const nextScope = usageScope(target);
    const requestId = ++requestSequence.current;
    setScope(nextScope);
    try {
      setLoading(true);
      setError(null);
      const normalized = normalizeUsageStats(await nextScope.client.getUsageStats());
      if (requestId !== requestSequence.current) return;
      writePageCache(nextScope.cacheKey, normalized);
      setStats(normalized);
    } catch (cause) {
      if (requestId === requestSequence.current) setError((cause as Error).message);
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [targetKey, target]);

  useMountSubscription(() => {
    const reload = () => {
      const nextScope = usageScope(target);
      setScope(nextScope);
      setStats(readPageCache<UsageStats>(nextScope.cacheKey));
      void loadStats();
    };
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === HEAD_CONNECTION_STORAGE_KEY) reload();
    };
    reload();
    const interval = window.setInterval(loadStats, 5_000);
    window.addEventListener(HEAD_CONNECTION_CHANGED_EVENT, reload);
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(HEAD_CONNECTION_CHANGED_EVENT, reload);
      window.removeEventListener("storage", onStorage);
    };
  }, [loadStats, target, targetKey]);

  return { stats, loading, error, loadStats, head: scope.head };
}
