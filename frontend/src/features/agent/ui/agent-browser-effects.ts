import { useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { BrowserPaneState } from "@/features/agent/ui/agent-browser-screencast";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

export type LocalhostSite = {
  port: number;
  url: string;
  displayUrl: string;
  title: string;
  process?: string;
  current?: boolean;
};

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
  useMountSubscription(() => {
    if (!enabled) return;
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
        }
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, onErrorChange, onLoadingChange, onSitesChange]);
}

type BrowserWebview = HTMLElement & {
  executeJavaScript: (script: string, userGesture?: boolean) => Promise<unknown>;
  getURL: () => string;
  loadURL: (url: string) => Promise<void>;
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

export const shouldLoadBrowserUrl = (desired: string, current: string, observed: string): boolean =>
  Boolean(desired && desired !== observed && desired !== current);

export const shouldSyncBrowserLocation = (
  desired: string,
  observed: string,
  current: string,
): boolean => desired === observed || current === desired;

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
  const observedUrl = useRef(url);

  useMountSubscription(() => {
    if (enabled && url && readingMode) {
      void fetchReadable(url);
    }
  }, [enabled, fetchReadable, readingMode, url]);

  useMountSubscription(() => {
    if (!enabled || !isElectron || readingMode) return;
    const webview = webviewRef.current;
    if (!webview) return;
    const navigate = () => {
      if (typeof webview.getURL !== "function" || typeof webview.loadURL !== "function") return;
      try {
        const current = webview.getURL();
        if (shouldLoadBrowserUrl(url, current, observedUrl.current)) {
          void webview
            .loadURL(url)
            .then(() => {
              const loaded = webview.getURL();
              observedUrl.current = loaded;
              if (loaded) onLocationChange?.(loaded);
            })
            .catch(() => undefined);
        }
      } catch {
        return;
      }
    };
    navigate();
    webview.addEventListener("dom-ready", navigate as EventListener);
    return () => webview.removeEventListener("dom-ready", navigate as EventListener);
  }, [enabled, isElectron, onLocationChange, readingMode, url, webviewRef]);

  useMountSubscription(() => {
    if (!enabled || !isElectron || readingMode) return;
    const webview = webviewRef.current;
    if (!webview) return;
    const sync = () => {
      try {
        const current = webview.getURL();
        if (!shouldSyncBrowserLocation(url, observedUrl.current, current)) return;
        observedUrl.current = current;
        if (current) onLocationChange?.(current);
        onNavState?.({
          url: current || url,
          title: typeof webview.getTitle === "function" ? webview.getTitle() : "",
          canGoBack: typeof webview.canGoBack === "function" ? webview.canGoBack() : false,
          canGoForward: typeof webview.canGoForward === "function" ? webview.canGoForward() : false,
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
  }, [enabled, isElectron, onLocationChange, onNavState, readingMode, url, webviewRef]);
}
