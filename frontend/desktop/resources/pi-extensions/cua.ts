import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Schema } from "effect";
import { Type } from "typebox";
import {
  decodeJson,
  present,
  requestJson,
  type Json,
  type JsonObject,
} from "./first-party-tool.ts";

const BridgeResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
  data: Schema.optional(Schema.Unknown),
  error: Schema.optional(Schema.String),
});
const LIMITS =
  "Uses a headless throwaway browser with no profile, logins, cookies, extensions, or downloads. Use chrome_* for the user's visible signed-in browser.";

type CuaEnv = { frontendBase: string; browserSessionId: string; timeoutMs: number };
function readEnv(): CuaEnv {
  const configured = Number(process.env.LOCAL_STUDIO_BROWSER_TOOL_TIMEOUT_MS);
  return {
    frontendBase: process.env.LOCAL_STUDIO_FRONTEND_BASE ?? "http://127.0.0.1:3000",
    browserSessionId: process.env.LOCAL_STUDIO_BROWSER_SESSION_ID ?? "",
    timeoutMs: Number.isFinite(configured) && configured > 0 ? Math.trunc(configured) : 60_000,
  };
}

async function request(
  env: CuaEnv,
  path: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
): Promise<Json> {
  const response = await requestJson(`${env.frontendBase}${path}`, init, signal, env.timeoutMs);
  const body = Schema.decodeUnknownSync(BridgeResponseSchema)(response.body);
  if (!response.ok || !body.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return decodeJson(body.data ?? null);
}

function call(
  env: CuaEnv,
  verb: string,
  payload: JsonObject,
  signal: AbortSignal | undefined,
): Promise<Json> {
  const body: JsonObject = { ...payload };
  if (env.browserSessionId) body.sessionId = env.browserSessionId;
  return request(
    env,
    `/api/agent/browser/${verb}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    signal,
  );
}

export default function registerCuaExtension(pi: ExtensionAPI): void {
  const env = readEnv();
  const run = (tool: string, verb: string, payload: JsonObject, signal?: AbortSignal) =>
    present("cua", tool, call(env, verb, payload, signal));
  pi.registerTool({
    name: "browser_navigate",
    label: "Browser: Navigate",
    description: `Open an absolute http(s) URL and wait for load. ${LIMITS}`,
    parameters: Type.Object({ url: Type.String() }),
    execute: (_id, params, signal) =>
      run("browser_navigate", "navigate", { url: params.url }, signal),
  });
  pi.registerTool({
    name: "browser_get_url",
    label: "Browser: Current URL",
    description: `Return the current URL and title. ${LIMITS}`,
    parameters: Type.Object({}),
    execute: (_id, _params, signal) => run("browser_get_url", "get-url", {}, signal),
  });
  pi.registerTool({
    name: "browser_get_text",
    label: "Browser: Get Text",
    description: `Return visible page text. ${LIMITS}`,
    parameters: Type.Object({ selector: Type.Optional(Type.String()) }),
    execute: (_id, _params, signal) => run("browser_get_text", "get-text", {}, signal),
  });
  pi.registerTool({
    name: "browser_get_html",
    label: "Browser: Get HTML",
    description: `Return rendered HTML for selectors or structure. ${LIMITS}`,
    parameters: Type.Object({ selector: Type.Optional(Type.String()) }),
    execute: (_id, _params, signal) => run("browser_get_html", "get-html", {}, signal),
  });
  pi.registerTool({
    name: "browser_screenshot",
    label: "Browser: Screenshot",
    description: `Capture the viewport as a PNG data URI. ${LIMITS}`,
    parameters: Type.Object({}),
    execute: (_id, _params, signal) => run("browser_screenshot", "screenshot", {}, signal),
  });
  pi.registerTool({
    name: "browser_click",
    label: "Browser: Click",
    description: `Click a CSS selector in the signed-out browser. ${LIMITS}`,
    parameters: Type.Object({ selector: Type.String() }),
    execute: (_id, params, signal) =>
      run("browser_click", "click", { selector: params.selector }, signal),
  });
  pi.registerTool({
    name: "browser_fill",
    label: "Browser: Fill Field",
    description: `Fill a field without submitting. Never enter secrets. ${LIMITS}`,
    parameters: Type.Object({ selector: Type.String(), value: Type.String() }),
    execute: (_id, params, signal) =>
      run("browser_fill", "fill", { selector: params.selector, value: params.value }, signal),
  });
  pi.registerTool({
    name: "browser_scroll",
    label: "Browser: Scroll",
    description: `Scroll by a vertical pixel delta. ${LIMITS}`,
    parameters: Type.Object({ deltaY: Type.Number(), selector: Type.Optional(Type.String()) }),
    execute: (_id, params, signal) =>
      run("browser_scroll", "scroll", { deltaY: params.deltaY }, signal),
  });
  for (const navigation of ["back", "forward", "reload"] as const) {
    pi.registerTool({
      name: `browser_${navigation}`,
      label: `Browser: ${navigation}`,
      description: `${navigation} in the headless browser. ${LIMITS}`,
      parameters: Type.Object({}),
      execute: (_id, _params, signal) => run(`browser_${navigation}`, navigation, {}, signal),
    });
  }
  pi.registerTool({
    name: "browser_history",
    label: "Browser: History",
    description:
      "Return actions and visited pages from this runtime, not the user's personal history.",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number()),
      visitedOnly: Type.Optional(Type.Boolean()),
    }),
    execute: (_id, params, signal) => {
      const requested = Number(params.limit);
      const limit = Number.isFinite(requested) ? Math.max(1, Math.trunc(requested)) : 50;
      const query = `limit=${limit}${params.visitedOnly ? "&visited=1" : ""}`;
      return present(
        "cua",
        "browser_history",
        request(env, `/api/agent/browser/history?${query}`, {}, signal),
      );
    },
  });
}
