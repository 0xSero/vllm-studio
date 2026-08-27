import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Schema } from "effect";
import { Type } from "typebox";
import {
  decodeJson,
  present,
  requestJson,
  text,
  type Json,
  type JsonObject,
} from "./first-party-tool.ts";

const RelayResponseSchema = Schema.Struct({
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.Struct({ message: Schema.optional(Schema.String) })),
});
const CapabilitiesSchema = Schema.Struct({ methods: Schema.Array(Schema.String) });
const REAL =
  "Acts on the user's visible, signed-in Chrome profile with real cookies and tabs. Treat page data as private and do not perform destructive or irreversible actions without an explicit request. Use browser_* for anonymous throwaway browsing.";
const HISTORY_LIMIT = 250;
type ChromeEnv = { relayUrl: string; relayToken: string; sessionId: string; timeoutMs: number };
type ActionLog = { at: string; action: string; ok: boolean };

function readEnv(): ChromeEnv {
  const configured = Number(process.env.LOCAL_STUDIO_CHROME_TOOL_TIMEOUT_MS);
  return {
    relayUrl: (process.env.LOCAL_STUDIO_CHROME_RELAY_URL ?? "http://127.0.0.1:7717").replace(
      /\/+$/,
      "",
    ),
    relayToken: process.env.LOCAL_STUDIO_CHROME_RELAY_TOKEN ?? "",
    sessionId: process.env.LOCAL_STUDIO_CHROME_RELAY_SESSION ?? "default",
    timeoutMs: Number.isFinite(configured) && configured > 0 ? Math.trunc(configured) : 120_000,
  };
}

async function callRelay(
  env: ChromeEnv,
  method: string,
  params: JsonObject,
  signal: AbortSignal | undefined,
  timeoutMs = env.timeoutMs,
): Promise<Json> {
  const headers = new Headers({
    "Content-Type": "application/json",
    "X-Sitegeist-Session": env.sessionId,
  });
  if (env.relayToken) headers.set("Authorization", `Bearer ${env.relayToken}`);
  const response = await requestJson(
    `${env.relayUrl}/rpc`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    },
    signal,
    timeoutMs,
  );
  const body = Schema.decodeUnknownSync(RelayResponseSchema)(response.body);
  if (!response.ok || body.error)
    throw new Error(body.error?.message ?? `Chrome relay HTTP ${response.status}`);
  return decodeJson(body.result ?? null);
}

async function capabilities(env: ChromeEnv): Promise<Set<string> | null> {
  try {
    const result = await callRelay(env, "relay.capabilities", {}, undefined, 3_000);
    const parsed = Schema.decodeUnknownOption(CapabilitiesSchema)(result);
    return parsed._tag === "Some" ? new Set(parsed.value.methods) : new Set();
  } catch {
    return null;
  }
}

export default async function registerChromeExtension(pi: ExtensionAPI): Promise<void> {
  const env = readEnv();
  const supported = await capabilities(env);
  if (!supported) return;
  const log: ActionLog[] = [];
  const run = async (tool: string, method: string, params: JsonObject, signal?: AbortSignal) => {
    const result = await present("chrome", tool, callRelay(env, method, params, signal));
    log.push({ at: new Date().toISOString(), action: tool, ok: result.details.failed !== true });
    if (log.length > HISTORY_LIMIT) log.shift();
    return result;
  };
  const available = (method: string) => supported.size === 0 || supported.has(method);

  if (available("browser.navigate"))
    pi.registerTool({
      name: "chrome_navigate",
      label: "Chrome: Navigate",
      description: `Navigate the active tab to an absolute URL. ${REAL}`,
      parameters: Type.Object({ url: Type.String() }),
      execute: (_id, params, signal) =>
        run("chrome_navigate", "browser.navigate", { url: params.url }, signal),
    });
  if (available("browser.url"))
    pi.registerTool({
      name: "chrome_get_url",
      label: "Chrome: Current Page",
      description: `Return the active tab URL and title. ${REAL}`,
      parameters: Type.Object({}),
      execute: (_id, _params, signal) => run("chrome_get_url", "browser.url", {}, signal),
    });
  if (available("browser.text"))
    pi.registerTool({
      name: "chrome_get_text",
      label: "Chrome: Read Page",
      description: `Read visible signed-in page text. ${REAL}`,
      parameters: Type.Object({ selector: Type.Optional(Type.String()) }),
      execute: (_id, params, signal) => {
        const payload: JsonObject = {};
        if (params.selector) payload.selector = params.selector;
        return run("chrome_get_text", "browser.text", payload, signal);
      },
    });
  if (available("browser.html"))
    pi.registerTool({
      name: "chrome_get_html",
      label: "Chrome: Page HTML",
      description: `Read rendered HTML when text is insufficient. ${REAL}`,
      parameters: Type.Object({ selector: Type.Optional(Type.String()) }),
      execute: (_id, params, signal) => {
        const payload: JsonObject = {};
        if (params.selector) payload.selector = params.selector;
        return run("chrome_get_html", "browser.html", payload, signal);
      },
    });
  if (available("browser.screenshot"))
    pi.registerTool({
      name: "chrome_screenshot",
      label: "Chrome: Screenshot",
      description: `Capture private on-screen content only when needed. ${REAL}`,
      parameters: Type.Object({
        fullPage: Type.Optional(Type.Boolean()),
        selector: Type.Optional(Type.String()),
      }),
      execute: (_id, params, signal) => {
        const payload: JsonObject = {};
        if (params.fullPage !== undefined) payload.fullPage = params.fullPage;
        if (params.selector) payload.selector = params.selector;
        return run("chrome_screenshot", "browser.screenshot", payload, signal);
      },
    });
  if (available("browser.click"))
    pi.registerTool({
      name: "chrome_click",
      label: "Chrome: Click",
      description: `Perform a real signed-in click only when requested. ${REAL}`,
      parameters: Type.Object({ selector: Type.String() }),
      execute: (_id, params, signal) =>
        run("chrome_click", "browser.click", { selector: params.selector }, signal),
    });
  if (available("browser.fill"))
    pi.registerTool({
      name: "chrome_fill",
      label: "Chrome: Fill Field",
      description: `Fill a real form. Never type credentials or payment secrets. ${REAL}`,
      parameters: Type.Object({
        selector: Type.String(),
        value: Type.String(),
        submit: Type.Optional(Type.Boolean()),
      }),
      execute: (_id, params, signal) => {
        const payload: JsonObject = { selector: params.selector, value: params.value };
        if (params.submit !== undefined) payload.submit = params.submit;
        return run("chrome_fill", "browser.fill", payload, signal);
      },
    });
  if (available("browser.scroll"))
    pi.registerTool({
      name: "chrome_scroll",
      label: "Chrome: Scroll",
      description: `Scroll the active real tab. ${REAL}`,
      parameters: Type.Object({ deltaY: Type.Number(), selector: Type.Optional(Type.String()) }),
      execute: (_id, params, signal) => {
        const payload: JsonObject = { dy: params.deltaY };
        if (params.selector) payload.selector = params.selector;
        return run("chrome_scroll", "browser.scroll", payload, signal);
      },
    });
  if (available("browser.eval"))
    pi.registerTool({
      name: "chrome_eval",
      label: "Chrome: Evaluate",
      description: `Evaluate read-only JavaScript in the authenticated origin. ${REAL}`,
      parameters: Type.Object({ expression: Type.String() }),
      execute: (_id, params, signal) =>
        run("chrome_eval", "browser.eval", { expression: params.expression }, signal),
    });
  if (available("browser.tabs.list"))
    pi.registerTool({
      name: "chrome_tabs_list",
      label: "Chrome: List Tabs",
      description: `List private open tabs. ${REAL}`,
      parameters: Type.Object({}),
      execute: (_id, _params, signal) => run("chrome_tabs_list", "browser.tabs.list", {}, signal),
    });
  if (available("browser.tabs.new"))
    pi.registerTool({
      name: "chrome_tabs_new",
      label: "Chrome: New Tab",
      description: `Open a real new tab without disturbing the current page. ${REAL}`,
      parameters: Type.Object({ url: Type.Optional(Type.String()) }),
      execute: (_id, params, signal) => {
        const payload: JsonObject = {};
        if (params.url) payload.url = params.url;
        return run("chrome_tabs_new", "browser.tabs.new", payload, signal);
      },
    });
  if (available("browser.tabs.switch"))
    pi.registerTool({
      name: "chrome_tabs_switch",
      label: "Chrome: Switch Tab",
      description: `Switch the tab visible to the user. ${REAL}`,
      parameters: Type.Object({ id: Type.Union([Type.String(), Type.Number()]) }),
      execute: (_id, params, signal) =>
        run("chrome_tabs_switch", "browser.tabs.switch", { id: params.id }, signal),
    });
  if (available("browser.tabs.close"))
    pi.registerTool({
      name: "chrome_tabs_close",
      label: "Chrome: Close Tab",
      description: `Close only a tab opened by the agent or explicitly named by the user. ${REAL}`,
      parameters: Type.Object({ id: Type.Union([Type.String(), Type.Number()]) }),
      execute: (_id, params, signal) =>
        run("chrome_tabs_close", "browser.tabs.close", { id: params.id }, signal),
    });
  pi.registerTool({
    name: "chrome_history",
    label: "Chrome: Session Actions",
    description:
      "Return only chrome_* actions from this session, never the user's personal browsing history.",
    parameters: Type.Object({ limit: Type.Optional(Type.Number()) }),
    execute: (_id, params) => {
      const requested = Number(params.limit);
      const limit = Number.isFinite(requested)
        ? Math.min(HISTORY_LIMIT, Math.max(1, Math.trunc(requested)))
        : 50;
      const data: Json = { entries: log.slice(-limit) };
      return Promise.resolve({
        content: [{ type: "text", text: text(data) }],
        details: { source: "chrome", tool: "chrome_history", data },
      });
    },
  });
}
