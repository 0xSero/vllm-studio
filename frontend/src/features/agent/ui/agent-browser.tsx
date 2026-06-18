"use client";

/**
 * Embedded browser pane for the agent surface.
 *
 * Two surfaces, switched by a toggle on the toolbar:
 *
 * 1. Live mode (default in Electron) — renders the page through `<webview>`.
 *    Auto-detects "blank" (empty body / failed navigation) and falls back to
 *    Reading mode without user intervention.
 * 2. Reading mode (default in dev) — pulls the page through
 *    `/api/agent/browser/fetch`, strips scripts/styles, and renders clean
 *    text with markdown links. Always works because we're not relying on the
 *    upstream's CSP/X-Frame-Options.
 *
 * The exported `WebviewElement` is the same handle the workspace's tool
 * bridge needs (executeJavaScript / loadURL / capturePage) so the agent can
 * still drive the browser when the user opts in.
 */
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type FormEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import { ArrowLeftIcon, ArrowRightIcon, CloseIcon, ReloadIcon } from "@/ui/icons";
import { MarkdownContent } from "@/ui/markdown-content";
import { DEFAULT_BROWSER_URL } from "@/features/agent/tools/persistence";
import {
  ScreencastSurface,
  type BrowserPaneState,
} from "@/features/agent/ui/agent-browser-screencast";

export type WebviewElement = HTMLElement & {
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  src: string;
  loadURL: (url: string) => Promise<void>;
  getURL: () => string;
  getTitle: () => string;
  executeJavaScript: (script: string, userGesture?: boolean) => Promise<unknown>;
  capturePage: () => Promise<{ toDataURL: () => string }>;
  addEventListener: HTMLElement["addEventListener"];
  removeEventListener: HTMLElement["removeEventListener"];
};

type ReadablePage = {
  url: string;
  title: string;
  text: string;
  markdown?: string;
  contentType?: string;
};

export type LocalhostSite = {
  port: number;
  url: string;
  displayUrl: string;
  title: string;
  process?: string;
  current?: boolean;
};

type Props = {
  url: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  onNavigate: (value: string) => void;
  onLocationChange: (value: string) => void;
  onClose: () => void;
  isElectron: boolean;
};

export type AgentBrowserHandle = {
  webview: WebviewElement | null;
  iframe: HTMLIFrameElement | null;
};

export const AgentBrowser = forwardRef<AgentBrowserHandle, Props>(function AgentBrowser(
  { url, inputValue, onInputChange, onNavigate, onLocationChange, onClose, isElectron },
  ref,
) {
  const webviewRef = useRef<WebviewElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // Live mode is the server-side screencast; it is the default everywhere and
  // falls back to reading mode only when the host has no Chromium.
  const [readingMode, setReadingMode] = useState(false);
  const [liveUnavailable, setLiveUnavailable] = useState<string | null>(null);
  const [navState, setNavState] = useState<BrowserPaneState | null>(null);
  const [readable, setReadable] = useState<ReadablePage | null>(null);
  const [readingError, setReadingError] = useState<string | null>(null);
  const [readingLoading, setReadingLoading] = useState(false);
  const [hasOpenedUrl, setHasOpenedUrl] = useState(() =>
    Boolean(url && url !== DEFAULT_BROWSER_URL),
  );
  const [localSites, setLocalSites] = useState<LocalhostSite[]>([]);
  const [localSitesLoading, setLocalSitesLoading] = useState(false);
  const [localSitesError, setLocalSitesError] = useState<string | null>(null);
  const showStartPage = !hasOpenedUrl && url === DEFAULT_BROWSER_URL;
  const addressValue = showStartPage && inputValue === DEFAULT_BROWSER_URL ? "" : inputValue;

  useImperativeHandle(
    ref,
    () => ({
      get webview() {
        return webviewRef.current;
      },
      get iframe() {
        return iframeRef.current;
      },
    }),
    [],
  );

  const fetchReadable = useCallback(async (target: string) => {
    setReadingLoading(true);
    setReadingError(null);
    try {
      const response = await fetch(`/api/agent/browser/fetch?url=${encodeURIComponent(target)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as ReadablePage & { error?: string };
      if (!response.ok || payload.error) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setReadable(payload);
    } catch (error) {
      setReadable(null);
      setReadingError(error instanceof Error ? error.message : "Failed to read page");
    } finally {
      setReadingLoading(false);
    }
  }, []);

  useAgentBrowserEffects({
    url,
    readingMode,
    isElectron,
    webviewRef,
    fetchReadable,
    onLocationChange,
    onNavState: setNavState,
    enabled: !showStartPage,
  });
  useLocalhostSitesEffects({
    enabled: showStartPage,
    onLoadingChange: setLocalSitesLoading,
    onSitesChange: setLocalSites,
    onErrorChange: setLocalSitesError,
  });

  const postLiveVerb = useCallback((verb: "back" | "forward" | "reload") => {
    void fetch(`/api/agent/browser/${verb}`, { method: "POST" }).catch(() => undefined);
  }, []);
  const handleBack = () => {
    if (readingMode) return;
    if (isElectron) {
      webviewRef.current?.goBack();
      return;
    }
    postLiveVerb("back");
  };
  const handleForward = () => {
    if (readingMode) return;
    if (isElectron) {
      webviewRef.current?.goForward();
      return;
    }
    postLiveVerb("forward");
  };
  const handleReload = () => {
    if (showStartPage) {
      setLocalSites([]);
      setLocalSitesError(null);
      setLocalSitesLoading(true);
      void fetch("/api/agent/browser/localhosts", { cache: "no-store" })
        .then(async (response) => {
          const payload = (await response.json()) as { sites?: LocalhostSite[]; error?: string };
          if (!response.ok || payload.error) throw new Error(payload.error || "Failed to scan");
          setLocalSites(payload.sites ?? []);
        })
        .catch((error) =>
          setLocalSitesError(error instanceof Error ? error.message : "Failed to scan localhost"),
        )
        .finally(() => setLocalSitesLoading(false));
      return;
    }
    if (readingMode) {
      void fetchReadable(url);
      return;
    }
    if (isElectron) {
      webviewRef.current?.reload();
      return;
    }
    postLiveVerb("reload");
  };
  const navigateFromBrowser = (value: string) => {
    const clean = value.trim();
    if (!clean) return;
    setHasOpenedUrl(true);
    onNavigate(clean);
  };
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    navigateFromBrowser(addressValue);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <form
        onSubmit={handleSubmit}
        className="flex shrink-0 items-center gap-1 border-b border-(--border) px-2 py-1.5"
      >
        <button
          type="button"
          onClick={handleBack}
          disabled={readingMode || navState?.canGoBack === false}
          className="rounded p-1 text-(--dim) hover:bg-(--surface) hover:text-(--fg) disabled:opacity-30"
          title="Back"
          aria-label="Back"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleForward}
          disabled={readingMode || navState?.canGoForward === false}
          className="rounded p-1 text-(--dim) hover:bg-(--surface) hover:text-(--fg) disabled:opacity-30"
          title="Forward"
          aria-label="Forward"
        >
          <ArrowRightIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={handleReload}
          className="rounded p-1 text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
          title="Reload"
          aria-label="Reload"
        >
          <ReloadIcon className="h-3.5 w-3.5" />
        </button>
        <input
          value={addressValue}
          onChange={(event) => onInputChange(event.target.value)}
          spellCheck={false}
          placeholder="Enter a URL or search local apps"
          className="min-w-0 flex-1 rounded border border-(--border) bg-(--surface) px-2 py-1 font-mono text-[length:var(--fs-sm)] text-(--fg) outline-none placeholder:text-(--dim)"
          aria-label="Browser address"
        />
        <button
          type="button"
          onClick={() => {
            if (liveUnavailable && readingMode) return;
            setReadingMode((value) => !value);
          }}
          disabled={Boolean(liveUnavailable && readingMode)}
          className={`shrink-0 rounded border px-1.5 py-1 text-[length:var(--fs-xs)] uppercase tracking-wide disabled:opacity-40 ${
            readingMode
              ? "border-(--accent) bg-(--accent)/10 text-(--accent)"
              : "border-(--border) text-(--dim) hover:text-(--fg)"
          }`}
          title={
            liveUnavailable && readingMode
              ? `Live view unavailable: ${liveUnavailable}`
              : readingMode
                ? "Switch to live view"
                : "Switch to reading mode"
          }
        >
          {readingMode ? "Reader" : "Live"}
        </button>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={onClose}
          className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
          title="Close"
          aria-label="Close browser"
        >
          <CloseIcon className="h-3.5 w-3.5 pointer-events-none" />
        </button>
      </form>

      <div className="min-h-0 flex-1 bg-(--bg)">
        {showStartPage ? (
          <LocalhostStartPage
            sites={localSites}
            loading={localSitesLoading}
            error={localSitesError}
            query={addressValue}
            onQueryChange={onInputChange}
            onNavigate={navigateFromBrowser}
          />
        ) : readingMode ? (
          <ReadingView
            url={url}
            page={readable}
            error={readingError}
            loading={readingLoading}
            onLinkClick={onNavigate}
          />
        ) : isElectron ? (
          // Desktop: a real embedded Chromium webview. Loads file://, localhost,
          // and the public web directly — the same surface the agent drives.
          (() => {
            type AnyTag = "webview";
            const Tag = "webview" as AnyTag;
            return (
              <Tag
                ref={(node: WebviewElement | null) => {
                  webviewRef.current = node;
                }}
                src={url}
                // @ts-expect-error — Electron-specific attribute.
                allowpopups="true"
                className="size-full"
                style={{ width: "100%", height: "100%", display: "flex" }}
              />
            );
          })()
        ) : (
          <ScreencastSurface
            url={url}
            onState={(state) => {
              setNavState(state);
              if (state.url && state.url !== url) onLocationChange(state.url);
            }}
            onUnavailable={(error) => {
              setLiveUnavailable(error);
              setReadingMode(true);
            }}
          />
        )}
      </div>
    </section>
  );
});

function LocalhostStartPage({
  sites,
  loading,
  error,
  query,
  onQueryChange,
  onNavigate,
}: {
  sites: LocalhostSite[];
  loading: boolean;
  error: string | null;
  query: string;
  onQueryChange: (value: string) => void;
  onNavigate: (value: string) => void;
}) {
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSites = normalizedQuery
    ? sites.filter((site) =>
        `${site.title} ${site.displayUrl} ${site.process ?? ""}`
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : sites;
  const canOpenQuery = Boolean(query.trim());
  return (
    <div className="size-full overflow-y-auto bg-(--bg) px-5 py-8 text-(--fg)">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex items-end justify-between gap-3">
          <div>
            <div className="text-[length:var(--fs-lg)] font-medium text-(--dim)">Local</div>
            <div className="mt-1 text-[length:var(--fs-sm)] text-(--dim)">
              Pick a running localhost app, or type a URL/search above.
            </div>
          </div>
          <button
            type="button"
            onClick={() => onQueryChange("")}
            className="rounded-md px-2 py-1 text-[length:var(--fs-sm)] text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
          >
            Clear
          </button>
        </div>

        {canOpenQuery && filteredSites.length === 0 ? (
          <button
            type="button"
            onClick={() => onNavigate(query)}
            className="mb-3 flex w-full items-center justify-between rounded-xl border border-(--border) bg-(--surface)/70 px-4 py-3 text-left hover:bg-(--surface)"
          >
            <span className="min-w-0">
              <span className="block truncate text-[length:var(--fs-base)] font-medium">
                Open “{query.trim()}”
              </span>
              <span className="mt-1 block text-[length:var(--fs-sm)] text-(--dim)">
                Navigate in the browser
              </span>
            </span>
            <span className="text-lg text-(--dim)">↗</span>
          </button>
        ) : null}

        {loading ? (
          <div className="rounded-xl border border-(--border) bg-black/20 px-4 py-8 text-center text-xs text-(--dim)">
            Scanning localhost…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-(--err)/30 bg-(--err)/10 px-4 py-3 text-xs text-(--err)">
            {error}
          </div>
        ) : filteredSites.length === 0 ? (
          <div className="rounded-xl border border-(--border) bg-black/20 px-4 py-8 text-center text-xs text-(--dim)">
            No running localhost web apps found.
          </div>
        ) : (
          <div className="grid gap-3">
            {filteredSites.map((site) => (
              <LocalhostSiteRow
                key={`${site.port}:${site.url}`}
                site={site}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LocalhostSiteRow({
  site,
  onNavigate,
}: {
  site: LocalhostSite;
  onNavigate: (value: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onNavigate(site.url)}
      className="group flex w-full items-center gap-4 rounded-xl border border-(--border) bg-black/10 px-3 py-3 text-left transition-colors hover:bg-(--surface)"
    >
      <span className="flex h-[58px] w-[92px] shrink-0 flex-col justify-between rounded-lg border border-white/20 bg-[#f4f4f4] p-2 shadow-inner">
        <span className="flex gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[#ff6b5f]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#ffd166]" />
          <span className="h-1.5 w-1.5 rounded-full bg-[#3ddc84]" />
        </span>
        <span className="space-y-1">
          <span className="block h-1.5 w-16 rounded-full bg-black/15" />
          <span className="block h-1.5 w-11 rounded-full bg-black/15" />
        </span>
        <span className="truncate text-[length:var(--fs-2xs)] font-semibold text-black/70">
          {site.title}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[length:var(--fs-lg)] font-semibold tracking-tight text-(--fg)">
          {site.title}
        </span>
        <span className="mt-1 block truncate text-[length:var(--fs-base)] text-(--dim)">
          {site.displayUrl}
        </span>
      </span>
      {site.current ? (
        <span className="rounded-md border border-(--border) px-2 py-1 text-[length:var(--fs-sm)] text-(--dim)">
          This chat
        </span>
      ) : null}
      <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-(--ok)" />
    </button>
  );
}

function ReadingView({
  url,
  page,
  error,
  loading,
  onLinkClick,
}: {
  url: string;
  page: ReadablePage | null;
  error: string | null;
  loading: boolean;
  onLinkClick: (url: string) => void;
}) {
  if (loading && !page) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-(--dim)">Loading…</div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-(--dim)">
        <span className="font-medium text-(--err)">Could not read {url}</span>
        <span>{error}</span>
      </div>
    );
  }
  if (!page) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-(--dim)">
        Enter a URL to read.
      </div>
    );
  }
  return (
    <div className="size-full overflow-y-auto bg-(--bg) px-4 py-3 text-sm leading-6 text-(--fg)">
      <div className="mx-auto max-w-3xl">
        <div className="text-xs text-(--dim)">{page.url}</div>
        <h1 className="mt-1 text-base font-semibold tracking-tight text-(--fg)">{page.title}</h1>
        <MarkdownContent
          markdown={page.markdown ?? page.text}
          className="mt-3 text-[length:var(--fs-base)] text-(--fg)"
          components={{
            a: ({ children, href }) => (
              <button
                type="button"
                onClick={() => onLinkClick(resolveBrowserHref(href ?? "", page.url))}
                className="text-(--accent) underline-offset-2 hover:underline"
                title={href}
              >
                {children}
              </button>
            ),
          }}
        />
      </div>
    </div>
  );
}

function resolveBrowserHref(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

type UseLocalhostSitesEffectsParams = {
  enabled: boolean;
  onLoadingChange: Dispatch<SetStateAction<boolean>>;
  onSitesChange: Dispatch<SetStateAction<LocalhostSite[]>>;
  onErrorChange: Dispatch<SetStateAction<string | null>>;
};

function useLocalhostSitesEffects({
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

const getLocalhostSitesSnapshot = (): number => 0;

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

function useAgentBrowserEffects({
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

const getAgentBrowserSnapshot = (): number => 0;
