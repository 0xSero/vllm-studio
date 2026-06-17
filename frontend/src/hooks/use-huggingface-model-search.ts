"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import type { HuggingFaceModel } from "@/lib/types";
import { fetchHuggingFaceModels, isRecentHuggingFaceModel } from "@/lib/huggingface";

const PAGE_SIZE = 50;

/**
 * Shared HuggingFace paged-search state machine (Discover + Explore):
 * 300ms debounced re-fetch on search change, append paging via loadMore,
 * and the browse-mode recency filter. Callers contribute their own
 * filter/sort params through `configureParams` (memoize it — its identity
 * drives the debounce subscription).
 */
export function useHuggingFaceModelSearch(
  search: string,
  configureParams: (params: URLSearchParams, isBrowsing: boolean) => void,
) {
  const [models, setModels] = useState<HuggingFaceModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const fetchModels = useCallback(
    async (append: boolean, pageIndex: number) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        const isBrowsing = search.trim().length === 0;
        if (!isBrowsing) params.set("search", search);
        configureParams(params, isBrowsing);
        params.set("limit", String(PAGE_SIZE));
        params.set("full", "false");
        params.set("offset", String(pageIndex * PAGE_SIZE));

        const data = await fetchHuggingFaceModels(params);
        const visibleData = isBrowsing ? data.filter(isRecentHuggingFaceModel) : data;

        if (append) {
          setModels((prev) => [...prev, ...visibleData]);
          setPage(pageIndex);
        } else {
          setModels(visibleData);
          setPage(0);
        }
        // hasMore: HF returned a full page, so there may be more. In browse mode
        // the recency filter may remove every result on a given page — that
        // doesn't mean there are no more recent models on later pages, so we
        // only gate on the raw page size, not the filtered count.
        setHasMore(data.length === PAGE_SIZE);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [search, configureParams],
  );

  const subscribeModelSearch = useCallback(
    (_notify: () => void) => {
      setPage(0);
      const debounce = setTimeout(() => {
        void fetchModels(false, 0);
      }, 300);
      return () => clearTimeout(debounce);
    },
    [fetchModels],
  );

  useSyncExternalStore(subscribeModelSearch, getModelSearchSnapshot, getModelSearchSnapshot);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      void fetchModels(true, page + 1);
    }
  }, [loading, hasMore, page, fetchModels]);

  return { models, loading, error, hasMore, loadMore, fetchModels };
}

const getModelSearchSnapshot = (): number => 0;
