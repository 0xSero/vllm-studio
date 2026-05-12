"use client";

import type { FormEvent, ReactNode } from "react";
import { CloseIcon } from "@/components/icons";
import { normalizeBrowserInput } from "@/lib/agent/tools/browser-url";
import { useTools, type ToolsContextValue } from "@/lib/agent/tools/context";
import type { Project } from "@/lib/agent/projects/types";
import { sanitizePublicBrowserUrl } from "@/lib/sanitize-embedded-browser-url";
import { AgentBrowser, type AgentBrowserHandle } from "./agent-browser";
import { FilesystemPanel } from "./filesystem-panel";
import { GitDiffPanel } from "./git-diff-panel";
import type { WorkspaceHandles } from "./use-workspace";

const BROWSER_COMMAND_TIMEOUT_MS = 12_000;

export type BrowserCommandResult = { ok: boolean; data?: unknown; error?: string };

type BrowserCommandDeps = {
  browser: AgentBrowserHandle | null;
  currentUrl: string;
  setBrowserUrl: (url: string, input?: string) => void;
  isElectron: boolean;
};

type AgentBrowserPanelHandles = Pick<
  WorkspaceHandles,
  | "registerComputerAside"
  | "startComputerResize"
  | "registerBrowserHandle"
  | "runBrowserCommand"
>;

type AgentBrowserPanelProps = {
  handles: AgentBrowserPanelHandles;
  activeProject: Project | null;
  focusedTitle: string;
};

function withBrowserTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${BROWSER_COMMAND_TIMEOUT_MS / 1000}s`));
    }, BROWSER_COMMAND_TIMEOUT_MS);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function detectBotProtection(text: string): string | null {
  const normalized = text.toLowerCase();
  if (
    normalized.includes("our systems have detected unusual traffic") ||
    normalized.includes("/sorry/") ||
    normalized.includes("captcha") ||
    normalized.includes("not a robot")
  ) {
    return "Bot-protection page detected. Stop automated browser use for this page and ask the user to intervene or use a non-browser search source.";
  }
  return null;
}

function isSafeBrowserSelector(selector: string): boolean {
  return selector.length > 0 && selector.length <= 240 && !/[`;{}]/.test(selector);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function runBrowserPanelCommand(
  verb: string,
  payload: Record<string, unknown>,
  deps: BrowserCommandDeps,
): Promise<BrowserCommandResult> {
  const webview = deps.browser?.webview ?? null;
  if (deps.isElectron && webview && typeof webview.executeJavaScript === "function") {
    try {
      switch (verb) {
        case "navigate": {
          const url = sanitizePublicBrowserUrl(String(payload.url || ""));
          if (!url) return { ok: false, error: "valid public http(s) url required" };
          await withBrowserTimeout(webview.loadURL(url), "Browser navigation");
          deps.setBrowserUrl(url, url);
          return { ok: true, data: { url } };
        }
        case "get-url":
          return { ok: true, data: { url: webview.getURL(), title: webview.getTitle() } };
        case "get-text": {
          const value = await withBrowserTimeout(
            webview.executeJavaScript("document.body && document.body.innerText"),
            "Browser text read",
          );
          const text = typeof value === "string" ? value : "";
          const protectionError = detectBotProtection(text);
          return protectionError
            ? { ok: false, error: protectionError }
            : { ok: true, data: { text } };
        }
        case "get-html": {
          const value = await withBrowserTimeout(
            webview.executeJavaScript(
              "document.documentElement && document.documentElement.outerHTML",
            ),
            "Browser HTML read",
          );
          const html = typeof value === "string" ? value : "";
          const protectionError = detectBotProtection(html);
          return protectionError
            ? { ok: false, error: protectionError }
            : { ok: true, data: { html } };
        }
        case "screenshot": {
          const image = await withBrowserTimeout(webview.capturePage(), "Browser screenshot");
          return { ok: true, data: { dataUri: image.toDataURL() } };
        }
        case "click": {
          const selector = String(payload.selector || "");
          if (!selector) return { ok: false, error: "selector required" };
          if (!isSafeBrowserSelector(selector)) return { ok: false, error: "unsupported selector" };
          const script = `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return { found: false }; (el).click(); return { found: true }; })()`;
          const value = await withBrowserTimeout(
            webview.executeJavaScript(script, true),
            "Browser click",
          );
          const found = isRecord(value) && value.found === true;
          return { ok: found, data: { found }, error: found ? undefined : "selector not found" };
        }
        case "scroll": {
          const rawDeltaY = Number(payload.deltaY ?? 0);
          const deltaY = Number.isFinite(rawDeltaY)
            ? Math.max(-10_000, Math.min(10_000, Math.trunc(rawDeltaY)))
            : 0;
          await withBrowserTimeout(
            webview.executeJavaScript(`window.scrollBy(0, ${deltaY})`),
            "Browser scroll",
          );
          const scrollY = await withBrowserTimeout(
            webview.executeJavaScript("window.scrollY"),
            "Browser scroll position read",
          );
          return { ok: true, data: { deltaY, scrollY } };
        }
        case "fill": {
          const selector = String(payload.selector || "");
          const value = String(payload.value ?? "");
          if (!selector) return { ok: false, error: "selector required" };
          if (!isSafeBrowserSelector(selector)) return { ok: false, error: "unsupported selector" };
          const script = `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return { found: false }; el.focus(); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return { found: true }; })()`;
          const result = await withBrowserTimeout(
            webview.executeJavaScript(script, true),
            "Browser fill",
          );
          const found = isRecord(result) && result.found === true;
          return { ok: found, data: { found }, error: found ? undefined : "selector not found" };
        }
        default:
          return { ok: false, error: `Unsupported browser verb: ${verb}` };
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  const iframe = deps.browser?.iframe ?? null;
  if (!iframe && verb === "get-url") return { ok: true, data: { url: deps.currentUrl, title: "" } };
  if (!iframe) return { ok: false, error: "Browser panel not mounted" };
  switch (verb) {
    case "navigate": {
      const url = sanitizePublicBrowserUrl(String(payload.url || ""));
      if (!url) return { ok: false, error: "valid public http(s) url required" };
      iframe.src = url;
      deps.setBrowserUrl(url, url);
      return { ok: true, data: { url } };
    }
    case "get-url":
      return { ok: true, data: { url: iframe.src, title: "" } };
    default:
      return {
        ok: false,
        error: `Browser tool '${verb}' is only available in the desktop app (cross-origin iframe restriction in dev).`,
      };
  }
}

export function AgentBrowserPanel({
  handles,
  activeProject,
  focusedTitle,
}: AgentBrowserPanelProps) {
  const tools = useTools();
  if (!tools.computer.open) return null;

  const { registerComputerAside, startComputerResize, registerBrowserHandle, runBrowserCommand } =
    handles;
  const isElectron = typeof navigator !== "undefined" && /electron/i.test(navigator.userAgent);
  const submitBrowserUrl = (event: FormEvent) => {
    event.preventDefault();
    const next = normalizeBrowserInput(tools.browser.input, activeProject?.path ?? "");
    if (!next) return;
    tools.setBrowserUrl(next, next);
    void runBrowserCommand("navigate", { url: next });
  };

  return (
    <aside
      className="relative flex shrink-0 flex-col border-l border-(--border) bg-(--bg)"
      ref={registerComputerAside}
      style={{ width: `min(${tools.computer.width}px, 48vw)` }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        title="Resize computer"
        onMouseDown={startComputerResize}
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-(--accent)/20"
      />
      <div className="flex h-9 shrink-0 items-center gap-3 px-3 text-xs text-(--dim)">
        <span
          className="min-w-0 flex-1 truncate px-1 text-[10px] uppercase tracking-wide"
          title={`Computer follows focused session: ${focusedTitle}`}
        >
          {focusedTitle}
        </span>
        <ComputerTabButton
          active={tools.computer.tab === "browser"}
          onClick={() => tools.setComputerTab("browser")}
        >
          Browser
        </ComputerTabButton>
        <ComputerTabButton
          active={tools.computer.tab === "files"}
          onClick={() => tools.setComputerTab("files")}
        >
          Files
        </ComputerTabButton>
        <ComputerTabButton
          active={tools.computer.tab === "diff"}
          onClick={() => tools.setComputerTab("diff")}
        >
          Diff
        </ComputerTabButton>
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => tools.setComputerOpen(false)}
          className="ml-1 inline-flex h-7 w-7 items-center justify-center hover:text-(--fg)"
          title="Close"
          aria-label="Close computer"
        >
          <CloseIcon className="h-3.5 w-3.5 pointer-events-none" />
        </button>
      </div>

      {tools.computer.tab === "browser" ? (
        <AgentBrowser
          ref={registerBrowserHandle}
          url={tools.browser.url}
          inputValue={tools.browser.input}
          onInputChange={tools.setBrowserInput}
          onSubmit={submitBrowserUrl}
          onClose={() => tools.setComputerOpen(false)}
          isElectron={isElectron}
        />
      ) : tools.computer.tab === "files" ? (
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <FilesystemPanel cwd={activeProject?.path ?? null} />
          </div>
        </section>
      ) : (
        <GitDiffPanel cwd={activeProject?.path ?? null} />
      )}
    </aside>
  );
}

function ComputerTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-6 shrink-0 font-medium uppercase tracking-wide ${
        active ? "text-(--fg)" : "hover:text-(--fg)"
      }`}
    >
      {children}
    </button>
  );
}
