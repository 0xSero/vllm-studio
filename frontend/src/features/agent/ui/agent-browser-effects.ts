import {
  useCallback,
  useSyncExternalStore,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { BrowserPaneState } from "@/features/agent/ui/agent-browser-screencast";

export type LocalhostSite = {
  port: number;
  url: string;
  displayUrl: string;
  title: string;
  process?: string;
  current?: boolean;
};

const getLocalhostSitesSnapshot = (): number => 0;

type UseLocalhostSitesEffectsParams = {
  enabled: boolean;
  onLoadingChange: Dispatch<SetStateAction<boolean>>;
  onSitesChange: Dispatch<SetStateAction<LocalhostSite[]>>;
  onErrorChange: Dispatch<SetStateAction<string | null>>;
};

export function useLocalhostSitesEffects({
  enabled,
  onLoadingChange,
  onSitesChange,
  onErrorChange,
}: UseLocalhostSitesEffectsParams): void {
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!enabled) return () => {};
      let cancelled = false;
      onLoadingChange(true);
      onErrorChange(null);
      void fetch("/api/agent/browser/localhosts", { cache: "no-store" })
        .then(async (response) => {
          const payload = (await response.json()) as { sites?: LocalhostSite[]; error?: string };
          if (!response.ok || payload.error) throw new Error(payload.error || "Failed to scan");
          if (!cancelled) onSitesChange(payload.sites ?? []);
        })
        .catch((error) => {
          if (!cancelled) {
            onSitesChange([]);
            onErrorChange(error instanceof Error ? error.message : "Failed to scan localhost");
          }
        })
        .finally(() => {
          if (!cancelled) {
            onLoadingChange(false);
            notify();
          }
        });
      return () => {
        cancelled = true;
      };
    },
    [enabled, onErrorChange, onLoadingChange, onSitesChange],
  );

  useSyncExternalStore(subscribe, getLocalhostSitesSnapshot, getLocalhostSitesSnapshot);
}

const getAgentBrowserSnapshot = (): number => 0;

type BrowserWebview = HTMLElement & {
  executeJavaScript: (script: string, userGesture?: boolean) => Promise<unknown>;
  getURL: () => string;
  getTitle?: () => string;
  canGoBack?: () => boolean;
  canGoForward?: () => boolean;
};

type UseAgentBrowserEffectsParams = {
  url: string;
  readingMode: boolean;
  isElectron: boolean;
  webviewRef: RefObject<BrowserWebview | null>;
  fetchReadable: (target: string) => Promise<void>;
  onLocationChange?: (value: string) => void;
  onNavState?: (state: BrowserPaneState) => void;
  enabled?: boolean;
};

export function useAgentBrowserEffects({
  url,
  readingMode,
  isElectron,
  webviewRef,
  fetchReadable,
  onLocationChange,
  onNavState,
  enabled = true,
}: UseAgentBrowserEffectsParams): void {
  const subscribeReadable = useCallback(
    (_notify: () => void) => {
      if (enabled && url && readingMode) {
        void fetchReadable(url);
      }
      return () => {};
    },
    [enabled, fetchReadable, readingMode, url],
  );

  const subscribeLocationSync = useCallback(
    (_notify: () => void) => {
      if (!enabled || !isElectron || readingMode) return () => {};
      const webview = webviewRef.current;
      if (!webview) return () => {};
      const sync = () => {
        try {
          const current = webview.getURL();
          if (current) onLocationChange?.(current);
          onNavState?.({
            url: current || url,
            title: typeof webview.getTitle === "function" ? webview.getTitle() : "",
            canGoBack: typeof webview.canGoBack === "function" ? webview.canGoBack() : false,
            canGoForward:
              typeof webview.canGoForward === "function" ? webview.canGoForward() : false,
          });
        } catch {
          // Ignore transient webview state while navigating.
        }
      };
      webview.addEventListener("did-navigate", sync as EventListener);
      webview.addEventListener("did-navigate-in-page", sync as EventListener);
      webview.addEventListener("did-stop-loading", sync as EventListener);
      return () => {
        webview.removeEventListener("did-navigate", sync as EventListener);
        webview.removeEventListener("did-navigate-in-page", sync as EventListener);
        webview.removeEventListener("did-stop-loading", sync as EventListener);
      };
    },
    [enabled, isElectron, onLocationChange, onNavState, readingMode, url, webviewRef],
  );

  useSyncExternalStore(subscribeReadable, getAgentBrowserSnapshot, getAgentBrowserSnapshot);
  useSyncExternalStore(subscribeLocationSync, getAgentBrowserSnapshot, getAgentBrowserSnapshot);
}
