import { useEffect, type RefObject } from "react";

type BrowserWebview = HTMLElement & {
  executeJavaScript: (script: string, userGesture?: boolean) => Promise<unknown>;
};

type UseAgentBrowserEffectsParams = {
  url: string;
  readingMode: boolean;
  isElectron: boolean;
  webviewRef: RefObject<BrowserWebview | null>;
  fetchReadable: (target: string) => Promise<void>;
  setLiveBlank: (value: boolean) => void;
};

export function useAgentBrowserEffects({
  url,
  readingMode,
  isElectron,
  webviewRef,
  fetchReadable,
  setLiveBlank,
}: UseAgentBrowserEffectsParams): void {
  useEffect(() => {
    if (!url || !readingMode) return;
    void fetchReadable(url);
  }, [fetchReadable, readingMode, url]);

  useEffect(() => {
    if (!isElectron || readingMode) return;
    const webview = webviewRef.current;
    if (!webview) return;
    let cancelled = false;
    const checkBlank = () => {
      if (cancelled) return;
      void webview
        .executeJavaScript(
          "document.body && document.body.innerText && document.body.innerText.length",
        )
        .then((value) => {
          if (cancelled) return;
          const length = typeof value === "number" ? value : Number(value) || 0;
          setLiveBlank(length === 0);
        })
        .catch(() => {
          if (!cancelled) setLiveBlank(true);
        });
    };
    const onLoaded = () => {
      window.setTimeout(checkBlank, 800);
    };
    const onFailed = () => setLiveBlank(true);
    webview.addEventListener("did-finish-load", onLoaded as EventListener);
    webview.addEventListener("did-fail-load", onFailed as EventListener);
    return () => {
      cancelled = true;
      webview.removeEventListener("did-finish-load", onLoaded as EventListener);
      webview.removeEventListener("did-fail-load", onFailed as EventListener);
    };
  }, [isElectron, readingMode, setLiveBlank, url, webviewRef]);
}
