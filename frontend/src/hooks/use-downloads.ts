"use client";

import { effectInterval } from "@/lib/effect-timers";

import { useCallback, useMemo, useState } from "react";
import api from "@/lib/api/client";
import type { ModelDownload } from "@/lib/types";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { useAsyncResource } from "@/hooks/use-async-resource";

type StartDownloadParams = {
  model_id: string;
  revision?: string;
  destination_dir?: string;
  allow_patterns?: string[];
  ignore_patterns?: string[];
  hf_token?: string;
};

export function useDownloads(pollIntervalMs = 2500) {
  const [startingModelIds, setStartingModelIds] = useState<Set<string>>(new Set());
  const loadDownloads = useCallback(async () => (await api.getDownloads()).downloads || [], []);
  const {
    data: downloads,
    loading,
    error,
    setError,
    refresh,
  } = useAsyncResource(loadDownloads, [] as ModelDownload[], "Failed to load downloads");
  const hasActive = downloads.some((d) => d.status === "downloading" || d.status === "paused");

  useMountSubscription(() => {
    if (pollIntervalMs <= 0) return;
    const timer = effectInterval(refresh, hasActive ? pollIntervalMs : 15_000);
    return () => timer.cancel();
  }, [pollIntervalMs, refresh, hasActive]);

  const startDownload = useCallback(
    async (params: StartDownloadParams) => {
      const modelId = params.model_id;
      setStartingModelIds((previous) => new Set(previous).add(modelId));
      setError("");
      try {
        const result = await api.startDownload(params);
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
    [refresh],
  );

  const pauseDownload = useCallback(
    async (id: string) => {
      const result = await api.pauseDownload(id);
      await refresh();
      return result.download;
    },
    [refresh],
  );

  const resumeDownload = useCallback(
    async (id: string, hfToken?: string) => {
      const result = await api.resumeDownload(id, hfToken);
      await refresh();
      return result.download;
    },
    [refresh],
  );

  const cancelDownload = useCallback(
    async (id: string) => {
      const result = await api.cancelDownload(id);
      await refresh();
      return result.download;
    },
    [refresh],
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
