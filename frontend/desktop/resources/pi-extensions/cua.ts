// cua — Local Studio's computer-use tool surface.
//
// One extension, one `browser_*` vocabulary, two transports:
//
//   embedded (default) — POSTs to the agent runtime, which drives a headless
//     Chromium-family browser on this machine (Chromium, Chrome, or Brave,
//     whichever the user picked). The user can watch it in the Browser panel.
//     Throwaway profile: no logins, no extensions.
//   sitegeist          — JSON-RPC to a local relay that forwards to the
//     sitegeist browser extension, driving the user's REAL browser window with
//     their real profile and logins. Adds page eval and tab management.
//
// This replaced the split browser.ts / sitegeist-browser.ts extensions, which
// exposed two different tool names for the same actions: a model that had
// learned one was helpless on the other, and the skill had to be swapped along
// with the extension. The transport is now an implementation detail — the names
// are identical either way, and only the genuinely backend-specific extras
// (eval, tabs) appear or disappear.
//
// Configuration is read when the extension is REGISTERED, not when the module
// is imported. The runtime loads this module once per process but registers it
// per session, and the backend, session id, and relay address all change from
// one session to the next; module-scope caching would pin the first session's
// answers onto every later one.
//
// Every description states the limits as well as the capability. A model that
// believes this drives the user's logged-in browser (it does not, on the
// embedded backend) will confidently do the wrong thing.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static, type TSchema } from "typebox";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

type Backend = "embedded" | "sitegeist";

type CuaEnv = {
  backend: Backend;
  frontendBase: string;
  browserSessionId: string;
  relayUrl: string;
  relayToken: string;
  relaySessionId: string;
  timeoutMs: number;
};

// Capability discovery runs at registration, which is session startup. The tool
// timeout is minutes long; a relay that accepts the connection and then hangs
// would stall every session behind it for that whole window.
const DISCOVERY_TIMEOUT_MS = 3_000;

function readTimeoutMs(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function readEnv(): CuaEnv {
  const backend: Backend =
    process.env.LOCAL_STUDIO_BROWSER_BACKEND === "sitegeist" ? "sitegeist" : "embedded";
  const browserSessionId = process.env.LOCAL_STUDIO_BROWSER_SESSION_ID ?? "";
  return {
    backend,
    frontendBase: process.env.LOCAL_STUDIO_FRONTEND_BASE ?? "http://127.0.0.1:3000",
    browserSessionId,
    relayUrl: (process.env.SITEGEIST_RELAY_URL || "http://127.0.0.1:7717").replace(/\/+$/, ""),
    relayToken: process.env.SITEGEIST_RELAY_TOKEN ?? "",
    relaySessionId: process.env.SITEGEIST_RELAY_SESSION_ID || browserSessionId || "default",
    timeoutMs:
      backend === "sitegeist"
        ? readTimeoutMs("SITEGEIST_RELAY_TOOL_TIMEOUT_MS", 120_000)
        : readTimeoutMs("LOCAL_STUDIO_BROWSER_TOOL_TIMEOUT_MS", 60_000),
  };
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    },
  };
}

// ─── transports ───────────────────────────────────────────────────────────

async function callEmbedded(
  env: CuaEnv,
  verb: string,
  payload: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const bounded = withTimeout(signal, env.timeoutMs);
  const response = await fetch(`${env.frontendBase}/api/agent/browser/${verb}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      env.browserSessionId ? { ...payload, sessionId: env.browserSessionId } : payload,
    ),
    signal: bounded.signal,
  }).finally(bounded.done);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${await response.text().catch(() => "")}`);
  }
  return unwrap(await response.json());
}

async function getEmbedded(
  env: CuaEnv,
  pathAndQuery: string,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const bounded = withTimeout(signal, env.timeoutMs);
  const response = await fetch(`${env.frontendBase}${pathAndQuery}`, {
    signal: bounded.signal,
  }).finally(bounded.done);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return unwrap(await response.json());
}

function unwrap(body: unknown): unknown {
  const result = body as { ok?: boolean; data?: unknown; error?: string };
  if (!result?.ok) throw new Error(result?.error || "browser bridge returned ok=false");
  return result.data;
}

async function callRelay(
  env: CuaEnv,
  method: string,
  params: Record<string, unknown>,
  signal: AbortSignal | undefined,
  timeoutMs = env.timeoutMs,
): Promise<unknown> {
  const bounded = withTimeout(signal, timeoutMs);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Sitegeist-Session": env.relaySessionId,
  };
  if (env.relayToken) headers.Authorization = `Bearer ${env.relayToken}`;
  const response = await fetch(`${env.relayUrl}/rpc`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    signal: bounded.signal,
  }).finally(bounded.done);
  const body = (await response.json().catch(() => ({}))) as {
    result?: unknown;
    error?: { message?: string };
  };
  if (!response.ok || body.error) {
    throw new Error(body.error?.message || `sitegeist relay HTTP ${response.status}`);
  }
  return body.result;
}

// ─── tool table ───────────────────────────────────────────────────────────

type ToolSpec<S extends TSchema> = {
  name: string;
  label: string;
  description: string;
  parameters: S;
  /** Embedded verb + body builder; omitted when that backend cannot do it. */
  embedded?: { verb: string; body: (params: Static<S>) => Record<string, unknown> };
  /** Relay method + params builder; omitted when that backend cannot do it. */
  sitegeist?: { method: string; params: (params: Static<S>) => Record<string, unknown> };
};

function define<S extends TSchema>(spec: ToolSpec<S>): ToolSpec<S> {
  return spec;
}

function compact(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

const urlParam = Type.String({ description: "Absolute http(s) URL" });
const optionalSelector = Type.Optional(
  Type.String({ description: "CSS selector; ignored by the embedded backend" }),
);
const tabIdParam = Type.Union([Type.String(), Type.Number()], { description: "Tab id" });

// Stated once, then folded into the descriptions the model actually reads —
// a tool list is often all it gets.
const EMBEDDED_LIMITS =
  "Runs a headless browser on this machine with a throwaway profile: no saved logins, no extensions, no downloads, one page at a time. Only public http(s) URLs and localhost are reachable.";
const SITEGEIST_LIMITS =
  "Drives the user's own visible browser window through the sitegeist relay, using their real profile and logins — actions are visible to the user and can affect signed-in accounts. Fails if the relay or extension is not running.";

function buildTools(backend: Backend) {
  const limits = backend === "sitegeist" ? SITEGEIST_LIMITS : EMBEDDED_LIMITS;
  return [
    define({
      name: "browser_navigate",
      label: "Browser: Navigate",
      description: `Open an absolute http(s) URL and wait for it to load. Call this before reading or interacting with a page. ${limits} Returns the final URL and title; a redirect means the final URL differs from the one requested.`,
      parameters: Type.Object({ url: urlParam }),
      embedded: { verb: "navigate", body: (p) => ({ url: p.url }) },
      sitegeist: { method: "browser.navigate", params: (p) => ({ url: p.url }) },
    }),
    define({
      name: "browser_get_url",
      label: "Browser: Current URL",
      description:
        "Return the URL and title of the page currently open. Cheap; use it to confirm where the browser is instead of assuming, especially when the user says a page is already open.",
      parameters: Type.Object({}),
      embedded: { verb: "get-url", body: () => ({}) },
      sitegeist: { method: "browser.url", params: () => ({}) },
    }),
    define({
      name: "browser_get_text",
      label: "Browser: Get Text",
      description:
        "Return the visible text of the current page. The cheapest way to read a page and the one to reach for by default. Text only — no layout, no images, and nothing hidden behind interaction; long pages are truncated. The embedded backend always returns the whole body and ignores `selector`.",
      parameters: Type.Object({ selector: optionalSelector }),
      embedded: { verb: "get-text", body: () => ({}) },
      sitegeist: { method: "browser.text", params: (p) => compact({ selector: p.selector }) },
    }),
    define({
      name: "browser_get_html",
      label: "Browser: Get HTML",
      description:
        "Return the rendered HTML of the current page. Use only when text is not enough — to find selectors, attributes, or markup structure. Much larger than `browser_get_text` and truncated on big pages.",
      parameters: Type.Object({ selector: optionalSelector }),
      embedded: { verb: "get-html", body: () => ({}) },
      sitegeist: { method: "browser.html", params: (p) => compact({ selector: p.selector }) },
    }),
    define({
      name: "browser_screenshot",
      label: "Browser: Screenshot",
      description:
        "Capture a PNG of the current page as a base64 data URI. Use it when visual layout matters; prefer `browser_get_text` for reading, and skip it entirely on a model without vision. Captures the viewport, not the full scrollable page, unless the backend supports `fullPage`.",
      parameters: Type.Object({
        fullPage: Type.Optional(
          Type.Boolean({ description: "Capture the full scrollable page (sitegeist only)" }),
        ),
        selector: optionalSelector,
      }),
      embedded: { verb: "screenshot", body: () => ({}) },
      sitegeist: {
        method: "browser.screenshot",
        params: (p) => compact({ fullPage: p.fullPage, selector: p.selector }),
      },
    }),
    define({
      name: "browser_click",
      label: "Browser: Click",
      description:
        "Click the first element matching a CSS selector. Returns whether an element matched — `found: false` means the selector was wrong, not that the click silently failed, so re-read the page instead of retrying the same selector. The embedded backend has no coordinate clicking.",
      parameters: Type.Object({
        selector: Type.String({ description: "CSS selector for the element to click" }),
      }),
      embedded: { verb: "click", body: (p) => ({ selector: p.selector }) },
      sitegeist: { method: "browser.click", params: (p) => ({ selector: p.selector }) },
    }),
    define({
      name: "browser_fill",
      label: "Browser: Fill Field",
      description:
        "Set the value of an input or textarea matching a CSS selector and fire input/change events. Does not submit the form on the embedded backend — click the submit control afterwards. Never put credentials, payment details, or other secrets here unless the user supplied them for this exact site in the current turn.",
      parameters: Type.Object({
        selector: Type.String({ description: "CSS selector for the input/textarea" }),
        value: Type.String({ description: "Value to set" }),
        submit: Type.Optional(
          Type.Boolean({ description: "Submit the form after filling (sitegeist only)" }),
        ),
      }),
      embedded: { verb: "fill", body: (p) => ({ selector: p.selector, value: p.value }) },
      sitegeist: {
        method: "browser.fill",
        params: (p) => compact({ selector: p.selector, value: p.value, submit: p.submit }),
      },
    }),
    define({
      name: "browser_scroll",
      label: "Browser: Scroll",
      description:
        "Scroll the page by a pixel delta (positive `deltaY` scrolls down). Use it to reach lazy-loaded content; for plain reading, `browser_get_text` already returns text below the fold.",
      parameters: Type.Object({
        deltaY: Type.Number({ description: "Pixels to scroll vertically" }),
        selector: optionalSelector,
      }),
      embedded: { verb: "scroll", body: (p) => ({ deltaY: p.deltaY }) },
      sitegeist: {
        method: "browser.scroll",
        params: (p) => compact({ dy: p.deltaY, selector: p.selector }),
      },
    }),
    define({
      name: "browser_back",
      label: "Browser: Back",
      description:
        "Go back one entry in the page's history and return the new page state. Does nothing when there is nothing to go back to. Embedded backend only.",
      parameters: Type.Object({}),
      embedded: { verb: "back", body: () => ({}) },
    }),
    define({
      name: "browser_forward",
      label: "Browser: Forward",
      description:
        "Go forward one entry in the page's history and return the new page state. Embedded backend only.",
      parameters: Type.Object({}),
      embedded: { verb: "forward", body: () => ({}) },
    }),
    define({
      name: "browser_reload",
      label: "Browser: Reload",
      description:
        "Reload the current page and return its state. Use after an action that should have changed server-side state. Embedded backend only.",
      parameters: Type.Object({}),
      embedded: { verb: "reload", body: () => ({}) },
    }),
    define({
      name: "browser_eval",
      label: "Browser: Evaluate",
      description:
        "Evaluate a JavaScript expression in the page and return its value. Sitegeist backend only — it runs inside the user's real browser session, so treat it as privileged: read and inspect, do not mutate account state. Values that cannot be serialized come back as null.",
      parameters: Type.Object({
        expression: Type.String({ description: "JavaScript expression to evaluate" }),
      }),
      sitegeist: { method: "browser.eval", params: (p) => ({ expression: p.expression }) },
    }),
    define({
      name: "browser_tabs_list",
      label: "Browser: List Tabs",
      description:
        "List the open tabs with their ids, URLs, and titles. Sitegeist backend only; the embedded browser has a single page and no tabs.",
      parameters: Type.Object({}),
      sitegeist: { method: "browser.tabs.list", params: () => ({}) },
    }),
    define({
      name: "browser_tabs_new",
      label: "Browser: New Tab",
      description: "Open a new tab, optionally at a URL, and return its id. Sitegeist backend only.",
      parameters: Type.Object({ url: Type.Optional(urlParam) }),
      sitegeist: { method: "browser.tabs.new", params: (p) => compact({ url: p.url }) },
    }),
    define({
      name: "browser_tabs_switch",
      label: "Browser: Switch Tab",
      description: "Make a tab active by id; later tool calls act on it. Sitegeist backend only.",
      parameters: Type.Object({ id: tabIdParam }),
      sitegeist: { method: "browser.tabs.switch", params: (p) => ({ id: p.id }) },
    }),
    define({
      name: "browser_tabs_close",
      label: "Browser: Close Tab",
      description:
        "Close a tab by id. Sitegeist backend only — this closes a real tab in the user's browser, so only close tabs you opened or the user asked you to close.",
      parameters: Type.Object({ id: tabIdParam }),
      sitegeist: { method: "browser.tabs.close", params: (p) => ({ id: p.id }) },
    }),
  ];
}

type ToolEntry = ReturnType<typeof buildTools>[number];

function historyDescription(backend: Backend): string {
  return backend === "sitegeist"
    ? "Return this session's log of browser actions taken by these tools, oldest first, with timestamps and whether each succeeded. Covers only calls this agent made — what the user does in their own browser is not visible here."
    : "Return the computer-use history: every action performed in the embedded browser this session — by you or by the user in the Browser panel — oldest first, with timestamps, URLs, and success. Use it to recover what has already been visited or tried instead of repeating work. Held in memory for the current runtime; it is not the user's personal browsing history and does not survive a restart.";
}

// ─── registration ─────────────────────────────────────────────────────────

type Invoker = (params: never, signal: AbortSignal | undefined) => Promise<unknown>;

/** The transport call for this tool, or null when this backend cannot do it. */
function resolveInvoker(
  env: CuaEnv,
  tool: ToolEntry,
  supported: Set<string> | null,
): Invoker | null {
  if (env.backend === "sitegeist") {
    const route = tool.sitegeist;
    if (!route) return null;
    if (supported && !supported.has(route.method)) return null;
    return (params, signal) => callRelay(env, route.method, route.params(params), signal);
  }
  const route = tool.embedded;
  if (!route) return null;
  return (params, signal) => callEmbedded(env, route.verb, route.body(params), signal);
}

async function relayCapabilities(env: CuaEnv): Promise<Set<string> | null> {
  try {
    const result = await callRelay(env, "relay.capabilities", {}, undefined, DISCOVERY_TIMEOUT_MS);
    const methods = (result as { methods?: unknown })?.methods;
    return Array.isArray(methods)
      ? new Set(methods.filter((method): method is string => typeof method === "string"))
      : null;
  } catch {
    return null;
  }
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  // JSON.stringify(undefined) is undefined, not a string — a tool that returned
  // an empty relay result would hand the SDK a content block with no text.
  return JSON.stringify(value ?? null, null, 2);
}

function failed(name: string, detailBase: Record<string, unknown>, error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `${name} failed: ${message}` }],
    details: { ...detailBase, error: message, failed: true },
  };
}

export default async function registerCuaExtension(pi: ExtensionAPI) {
  const env = readEnv();
  // Register only what the connected relay implements. When discovery fails
  // (relay down, or it does not advertise), register everything and let each
  // call surface its own error — more useful than a silently empty toolset the
  // model cannot explain to the user.
  const supported = env.backend === "sitegeist" ? await relayCapabilities(env) : null;

  // The sitegeist relay has no history store of its own, so this session's own
  // calls are all `browser_history` can report there.
  const localLog: Array<{ at: string; action: string; detail?: string; ok: boolean }> = [];
  const recordLocal = (action: string, detail: string | undefined, ok: boolean) => {
    if (env.backend !== "sitegeist") return;
    localLog.push({ at: new Date().toISOString(), action, detail, ok });
    if (localLog.length > 250) localLog.shift();
  };

  for (const tool of buildTools(env.backend)) {
    const invoke = resolveInvoker(env, tool, supported);
    if (!invoke) continue;

    pi.registerTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      async execute(_id, params, signal) {
        const args = params as Record<string, unknown>;
        const detailBase: Record<string, unknown> = {
          backend: env.backend,
          tool: tool.name,
          params: args,
        };
        try {
          const data = await invoke(params as never, signal);
          recordLocal(tool.name, describeArgs(args), true);
          return {
            content: [{ type: "text", text: asText(data) }],
            details: { ...detailBase, data },
          };
        } catch (error) {
          recordLocal(tool.name, describeArgs(args), false);
          return failed(tool.name, detailBase, error);
        }
      },
    });
  }

  pi.registerTool({
    name: "browser_history",
    label: "Browser: History",
    description: historyDescription(env.backend),
    parameters: Type.Object({
      limit: Type.Optional(
        Type.Number({ description: "Maximum entries to return (default 50, max 250)" }),
      ),
      visitedOnly: Type.Optional(
        Type.Boolean({ description: "Return only the distinct pages visited, in order" }),
      ),
    }),
    async execute(_id, params, signal) {
      const limit = Number.isFinite(params.limit) ? Math.max(1, Math.trunc(Number(params.limit))) : 50;
      const detailBase: Record<string, unknown> = {
        backend: env.backend,
        tool: "browser_history",
        params,
      };
      if (env.backend === "sitegeist") {
        const entries = localLog.slice(-limit);
        return {
          content: [{ type: "text", text: asText({ entries }) }],
          details: { ...detailBase, data: { entries } },
        };
      }
      try {
        const query = `limit=${limit}${params.visitedOnly ? "&visited=1" : ""}`;
        const data = await getEmbedded(env, `/api/agent/browser/history?${query}`, signal);
        return {
          content: [{ type: "text", text: asText(data) }],
          details: { ...detailBase, data },
        };
      } catch (error) {
        return failed("browser_history", detailBase, error);
      }
    },
  });
}

function describeArgs(args: Record<string, unknown>): string | undefined {
  const url = typeof args.url === "string" ? args.url : undefined;
  const selector = typeof args.selector === "string" ? args.selector : undefined;
  return url ?? selector;
}
