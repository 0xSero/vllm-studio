"use client";

import { effectInterval } from "@/lib/effect-timers";

import { useCallback, useMemo, useState } from "react";
import api from "@/lib/api/client";
import type { ApiClient } from "@/lib/api/create-api-client";
import type { ModelDownload } from "@/lib/types";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

type StartDownloadParams = {
  model_id: string;
  revision?: string;
  destination_dir?: string;
  allow_patterns?: string[];
  ignore_patterns?: string[];
  hf_token?: string;
};

export function useDownloads(pollIntervalMs = 2500, client: ApiClient = api) {
  const [downloads, setDownloads] = useState<ModelDownload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingModelIds, setStartingModelIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const data = await client.getDownloads();
      setDownloads(data.downloads || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load downloads");
    } finally {
      setLoading(false);
    }
  }, [client]);

  // Only in-flight/resumable-soon states justify the fast poll; terminal
  // states (failed/canceled/completed) don't change server-side, so they fall
  // back to the slow poll instead of holding the fast interval forever.
  const hasActive = downloads.some((d) => d.status === "downloading" || d.status === "paused");

  useMountSubscription(() => {
    void refresh();
    if (pollIntervalMs <= 0) return;
    const timer = effectInterval(refresh, hasActive ? pollIntervalMs : 15_000);
    return () => timer.cancel();
  }, [pollIntervalMs, refresh, hasActive]);

  const startDownload = useCallback(
    async (params: StartDownloadParams) => {
      const modelId = params.model_id;
      setStartingModelIds((previous) => new Set(previous).add(modelId));
      setError(null);
      try {
        const result = await client.startDownload(params);
        await refresh();
        return result.download;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start download");
        throw err;
      } finally {
        setStartingModelIds((previous) => {
          const next = new Set(previous);
          next.delete(modelId);
          return next;
        });
      }
    },
    [client, refresh],
  );

  const pauseDownload = useCallback(
    async (id: string) => {
      const result = await client.pauseDownload(id);
      await refresh();
      return result.download;
    },
    [client, refresh],
  );

  const resumeDownload = useCallback(
    async (id: string, hfToken?: string) => {
      const result = await client.resumeDownload(id, hfToken);
      await refresh();
      return result.download;
    },
    [client, refresh],
  );

  const cancelDownload = useCallback(
    async (id: string) => {
      const result = await client.cancelDownload(id);
      await refresh();
      return result.download;
    },
    [client, refresh],
  );

  const downloadsByModel = useMemo(() => {
    const map = new Map<string, ModelDownload>();
    for (const download of downloads) {
      if (!map.has(download.model_id)) {
        map.set(download.model_id, download);
      }
    }
    return map;
  }, [downloads]);

  return {
    downloads,
    downloadsByModel,
    startingModelIds,
    loading,
    error,
    refresh,
    startDownload,
    pauseDownload,
    resumeDownload,
    cancelDownload,
  };
}
