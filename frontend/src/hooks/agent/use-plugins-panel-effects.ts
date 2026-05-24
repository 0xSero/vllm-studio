// One-shot hook that fires the initial extensions listing fetch for the
// plugins panel. Lives here because the project-wide policy bans `useEffect`
// inside `src/app/agent/_components/*` — workspace components must delegate
// genuine side effects to `src/hooks/agent/use-*-effects.ts` files.

import { useEffect } from "react";

export function usePluginsPanelInitialLoadEffect(refresh: () => Promise<void>): void {
  useEffect(() => {
    void refresh();
    // Mount-once: we intentionally only run on first mount. The refresh
    // function identity changes whenever the panel mounts, which is the
    // right behaviour for our single-mount needs anyway.
  }, []);
}

/**
 * Debounced catalog fetch for the plugins panel. Re-runs whenever `query`
 * or `view` changes. Lives here so the workspace component file doesn't
 * have to call `useEffect` directly.
 */
export function usePluginsCatalogFetchEffect(params: {
  view: "browse" | "installed";
  query: string;
  onLoad: (loading: boolean) => void;
  onError: (error: string | null) => void;
  onResult: (entries: unknown) => void;
}): void {
  const { view, query, onLoad, onError, onResult } = params;
  useEffect(() => {
    if (view !== "browse") return;
    const handle = setTimeout(async () => {
      onLoad(true);
      onError(null);
      try {
        const url = `/api/agent/extensions/catalog?q=${encodeURIComponent(query)}&size=60`;
        const response = await fetch(url, { cache: "no-store" });
        const payload = (await response.json()) as {
          entries?: unknown;
          error?: string;
        };
        if (!response.ok || payload.error) {
          throw new Error(payload.error ?? `HTTP ${response.status}`);
        }
        onResult(payload.entries);
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to load catalog");
      } finally {
        onLoad(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query, view, onLoad, onError, onResult]);
}
