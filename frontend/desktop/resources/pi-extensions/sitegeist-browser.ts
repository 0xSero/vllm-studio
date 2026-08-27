// Sitegeist browser tool extension for Local Studio.
//
// Registers Pi `sitegeist_*` tools that each make one HTTP JSON-RPC 2.0 call to
// the local sitegeist relay (`${SITEGEIST_RELAY_URL}/rpc`), which forwards to the
// sitegeist Chrome extension over WebSocket. Enable through
// LOCAL_STUDIO_BROWSER_BACKEND=sitegeist while the browser tool toggle is on.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Schema } from "effect";
import { Type, type TSchema } from "typebox";

interface ToolParams {
  [key: string]: Schema.Json;
}

type ToolDetails =
  | {
      method: string;
      params: ToolParams;
      data: Schema.Json;
      relaySessionId: string;
    }
  | {
      method: string;
      params: ToolParams;
      error: string;
      failed: true;
    };

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: ToolDetails;
};

const RelayResponseSchema = Schema.Struct({
  result: Schema.optional(Schema.Json),
  error: Schema.optional(
    Schema.Struct({
      code: Schema.optional(Schema.Number),
      message: Schema.optional(Schema.String),
    }),
  ),
});

const RelayCapabilitiesSchema = Schema.Struct({ methods: Schema.Array(Schema.String) });
const ToolParamsSchema = Schema.Record(Schema.String, Schema.Json);
const isString = Schema.is(Schema.String);

const DEFAULT_RELAY_URL = "http://127.0.0.1:7717";
const DEFAULT_TIMEOUT_MS = 120_000;

const RELAY_URL = (process.env.SITEGEIST_RELAY_URL || DEFAULT_RELAY_URL).replace(/\/+$/, "");
const RELAY_TOKEN = process.env.SITEGEIST_RELAY_TOKEN ?? "";
const RELAY_SESSION_ID =
  process.env.SITEGEIST_RELAY_SESSION_ID ||
  process.env.LOCAL_STUDIO_BROWSER_SESSION_ID ||
  "default";
const TIMEOUT_MS = (() => {
  const value = Number(process.env.SITEGEIST_RELAY_TOOL_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : DEFAULT_TIMEOUT_MS;
})();

async function callRelay(
  method: string,
  params: ToolParams,
  signal?: AbortSignal,
): Promise<Schema.Json> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();

  const headers = new Headers({
    "Content-Type": "application/json",
    "X-Sitegeist-Session": RELAY_SESSION_ID,
  });
  if (RELAY_TOKEN) headers.set("Authorization", `Bearer ${RELAY_TOKEN}`);

  const response = await fetch(`${RELAY_URL}/rpc`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  });

  const payload = await response.json().catch(() => null);
  const body = Schema.decodeUnknownSync(RelayResponseSchema)(payload);
  if (!response.ok || body.error) {
    throw new Error(body.error?.message || `sitegeist relay HTTP ${response.status}`);
  }
  return body.result ?? null;
}

// Tool definitions: each maps a `sitegeist_*` tool to one relay method.
// `paramNames` projects validated params into the JSON-RPC payload.
type ToolDef = {
  name: string;
  method: string;
  label: string;
  description: string;
  parameters: TSchema;
  paramNames: ReadonlyArray<string>;
};

function pickParams(params: ToolParams, paramNames: ReadonlyArray<string>): ToolParams {
  const selected: ToolParams = {};
  for (const name of paramNames) {
    const value = params[name];
    if (value !== undefined) selected[name] = value;
  }
  return selected;
}

const url = Type.String({ description: "Absolute http(s) URL" });
const optionalSelector = Type.Optional(Type.String({ description: "Optional CSS selector" }));
const tabId = Type.Union([Type.String(), Type.Number()], { description: "Tab id" });

const TOOLS = [
  {
    name: "sitegeist_navigate",
    method: "browser.navigate",
    label: "Sitegeist: Navigate",
    description: "Navigate the sitegeist browser to an absolute http(s) URL.",
    parameters: Type.Object({ url }),
    paramNames: ["url"],
  },
  {
    name: "sitegeist_get_url",
    method: "browser.url",
    label: "Sitegeist: Current URL",
    description: "Return the current URL and title from the sitegeist browser.",
    parameters: Type.Object({}),
    paramNames: [],
  },
  {
    name: "sitegeist_get_text",
    method: "browser.text",
    label: "Sitegeist: Get Text",
    description: "Return visible page text, optionally scoped to a selector.",
    parameters: Type.Object({ selector: optionalSelector }),
    paramNames: ["selector"],
  },
  {
    name: "sitegeist_get_html",
    method: "browser.html",
    label: "Sitegeist: Get HTML",
    description: "Return rendered HTML, optionally scoped to a selector.",
    parameters: Type.Object({ selector: optionalSelector }),
    paramNames: ["selector"],
  },
  {
    name: "sitegeist_screenshot",
    method: "browser.screenshot",
    label: "Sitegeist: Screenshot",
    description: "Capture a PNG screenshot of the page or an element.",
    parameters: Type.Object({
      fullPage: Type.Optional(Type.Boolean({ description: "Capture the full scrollable page" })),
      selector: optionalSelector,
    }),
    paramNames: ["fullPage", "selector"],
  },
  {
    name: "sitegeist_click",
    method: "browser.click",
    label: "Sitegeist: Click",
    description: "Click a selector, or a viewport coordinate when no selector is given.",
    parameters: Type.Object({
      selector: optionalSelector,
      x: Type.Optional(Type.Number({ description: "Viewport x coordinate" })),
      y: Type.Optional(Type.Number({ description: "Viewport y coordinate" })),
    }),
    paramNames: ["selector", "x", "y"],
  },
  {
    name: "sitegeist_fill",
    method: "browser.fill",
    label: "Sitegeist: Fill Field",
    description: "Set a form field value, optionally submitting the form afterward.",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector of the field" }),
      value: Type.String({ description: "Value to set" }),
      submit: Type.Optional(Type.Boolean({ description: "Submit the form after filling" })),
    }),
    paramNames: ["selector", "value", "submit"],
  },
  {
    name: "sitegeist_scroll",
    method: "browser.scroll",
    label: "Sitegeist: Scroll",
    description: "Scroll the page or an element by a pixel delta.",
    parameters: Type.Object({
      dx: Type.Optional(Type.Number({ description: "Horizontal pixels" })),
      dy: Type.Optional(Type.Number({ description: "Vertical pixels" })),
      selector: optionalSelector,
    }),
    paramNames: ["dx", "dy", "selector"],
  },
  {
    name: "sitegeist_eval",
    method: "browser.eval",
    label: "Sitegeist: Evaluate",
    description: "Evaluate a JavaScript expression in the page context and return the value.",
    parameters: Type.Object({
      expression: Type.String({ description: "JavaScript expression to evaluate" }),
    }),
    paramNames: ["expression"],
  },
  {
    name: "sitegeist_tabs_list",
    method: "browser.tabs.list",
    label: "Sitegeist: List Tabs",
    description: "List open tabs in the sitegeist browser session.",
    parameters: Type.Object({}),
    paramNames: [],
  },
  {
    name: "sitegeist_tabs_new",
    method: "browser.tabs.new",
    label: "Sitegeist: New Tab",
    description: "Open a new tab, optionally loading a URL.",
    parameters: Type.Object({ url: Type.Optional(url) }),
    paramNames: ["url"],
  },
  {
    name: "sitegeist_tabs_switch",
    method: "browser.tabs.switch",
    label: "Sitegeist: Switch Tab",
    description: "Switch the active tab by id.",
    parameters: Type.Object({ id: tabId }),
    paramNames: ["id"],
  },
  {
    name: "sitegeist_tabs_close",
    method: "browser.tabs.close",
    label: "Sitegeist: Close Tab",
    description: "Close a tab by id.",
    parameters: Type.Object({ id: tabId }),
    paramNames: ["id"],
  },
] as const;

async function runTool(
  name: string,
  method: string,
  params: ToolParams,
  rpcParams: ToolParams,
  signal?: AbortSignal,
): Promise<ToolResult> {
  try {
    const result = await callRelay(method, rpcParams, signal);
    const text = isString(result) ? result : JSON.stringify(result, null, 2);
    return {
      content: [{ type: "text", text }],
      details: { method, params, data: result, relaySessionId: RELAY_SESSION_ID },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `${name} failed: ${message}` }],
      details: { method, params, error: message, failed: true },
    };
  }
}

async function relayCapabilities(): Promise<Set<string> | null> {
  try {
    const controller = new AbortController();
    const result = await callRelay("relay.capabilities", {}, controller.signal);
    const capabilities = Schema.decodeUnknownSync(RelayCapabilitiesSchema)(result);
    return new Set(capabilities.methods);
  } catch {
    return null;
  }
}

function registerTool(pi: ExtensionAPI, tool: ToolDef): void {
  pi.registerTool({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    execute(_id, params, signal) {
      const parsedParams = Schema.decodeUnknownSync(ToolParamsSchema)(params);
      const rpcParams = pickParams(parsedParams, tool.paramNames);
      return runTool(tool.name, tool.method, parsedParams, rpcParams, signal);
    },
  });
}

export default async function registerSitegeistBrowserExtension(pi: ExtensionAPI) {
  // Capability discovery: register only the tools the connected extension
  // implements. If discovery fails (relay down), register everything and let
  // each call surface the relay error.
  const supported = await relayCapabilities();

  for (const tool of TOOLS) {
    if (supported && !supported.has(tool.method)) continue;
    registerTool(pi, tool);
  }
}
