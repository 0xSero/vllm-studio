import { useCallback, useSyncExternalStore, type RefObject } from "react";

type BrowserWebview = HTMLElement & {
  executeJavaScript: (script: string, userGesture?: boolean) => Promise<unknown>;
  getURL: () => string;
};

type UseAgentBrowserEffectsParams = {
  url: string;
  readingMode: boolean;
  isElectron: boolean;
  webviewRef: RefObject<BrowserWebview | null>;
  fetchReadable: (target: string) => Promise<void>;
  onLocationChange?: (value: string) => void;
  enabled?: boolean;
};

export function useAgentBrowserEffects({
  url,
  readingMode,
  isElectron,
  webviewRef,
  fetchReadable,
  onLocationChange,
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
      if (!enabled || !isElectron || readingMode || !onLocationChange) return () => {};
      const webview = webviewRef.current;
      if (!webview) return () => {};
      const syncUrl = () => {
        try {
          const current = webview.getURL();
          if (current) onLocationChange(current);
        } catch {
          // Ignore transient webview state while navigating.
        }
      };
      webview.addEventListener("did-navigate", syncUrl as EventListener);
      webview.addEventListener("did-navigate-in-page", syncUrl as EventListener);
      return () => {
        webview.removeEventListener("did-navigate", syncUrl as EventListener);
        webview.removeEventListener("did-navigate-in-page", syncUrl as EventListener);
      };
    },
    [enabled, isElectron, onLocationChange, readingMode, url, webviewRef],
  );

  useSyncExternalStore(subscribeReadable, getAgentBrowserSnapshot, getAgentBrowserSnapshot);
  useSyncExternalStore(subscribeLocationSync, getAgentBrowserSnapshot, getAgentBrowserSnapshot);
}

const getAgentBrowserSnapshot = (): number => 0;
