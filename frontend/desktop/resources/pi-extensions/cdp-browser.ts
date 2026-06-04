// CDP browser tool extension for vLLM Studio.
//
// Drives the user's OWN Chrome over the Chrome DevTools Protocol — so the agent
// acts inside their real, logged-in session (cookies, history, open tabs). This
// is the legitimate alternative to Codex's trust-locked `@chrome` extension
// bridge, which only runs inside Codex's signed runtime.
//
// Prereq: Chrome launched with remote debugging, e.g.
//   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
//     --remote-debugging-port=9222 --user-data-dir="$HOME/Library/Application Support/Google/Chrome"
// Endpoint override: VLLM_STUDIO_CDP_ENDPOINT (default http://127.0.0.1:9222).
//
// Enable through VLLM_STUDIO_BROWSER_BACKEND=cdp while the browser tool is on
// (selecting @browser/@chrome, or browserToolEnabled).

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

const CDP_ENDPOINT = (process.env.VLLM_STUDIO_CDP_ENDPOINT ?? "http://127.0.0.1:9222").replace(
  /\/+$/,
  "",
);
const CDP_CALL_TIMEOUT_MS = 30_000;

type CdpTarget = {
  id: string;
  type: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
};

type CdpMessage = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message?: string };
};

// One reused connection bound to a single page target, so navigation/eval state
// persists across tool calls within a session.
class CdpConnection {
  private socket: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: CdpMessage) => void; reject: (e: Error) => void }
  >();
  private waiters = new Map<string, Array<(p: Record<string, unknown>) => void>>();
  targetId: string | null = null;

  get connected(): boolean {
    return this.socket !== null && this.socket.readyState === 1;
  }

  async open(wsUrl: string, targetId: string): Promise<void> {
    await this.close();
    const socket = new WebSocket(wsUrl);
    this.socket = socket;
    this.targetId = targetId;
    await new Promise<void>((resolve, reject) => {
      const onErr = () => reject(new Error(`failed to open CDP socket for ${targetId}`));
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", onErr, { once: true });
    });
    socket.addEventListener("message", (event) => this.onMessage(String(event.data)));
    socket.addEventListener("close", () => this.onClose());
  }

  private onMessage(raw: string): void {
    let msg: CdpMessage;
    try {
      msg = JSON.parse(raw) as CdpMessage;
    } catch {
      return;
    }
    if (typeof msg.id === "number") {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error.message ?? "CDP error"));
      else entry.resolve(msg);
      return;
    }
    if (msg.method) {
      const queue = this.waiters.get(msg.method);
      if (queue && queue.length) {
        this.waiters.set(msg.method, []);
        for (const fn of queue) fn(msg.params ?? {});
      }
    }
  }

  private onClose(): void {
    for (const entry of this.pending.values()) entry.reject(new Error("CDP socket closed"));
    this.pending.clear();
    this.waiters.clear();
    this.socket = null;
    this.targetId = null;
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return Promise.reject(new Error("CDP not connected"));
    const id = this.nextId++;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${CDP_CALL_TIMEOUT_MS}ms`));
      }, CDP_CALL_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg.result ?? {});
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  waitForEvent(method: string, timeoutMs: number): Promise<Record<string, unknown>> {
    return new Promise<Record<string, unknown>>((resolve) => {
      const timer = setTimeout(() => resolve({}), timeoutMs);
      const queue = this.waiters.get(method) ?? [];
      queue.push((params) => {
        clearTimeout(timer);
        resolve(params);
      });
      this.waiters.set(method, queue);
    });
  }

  async close(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    this.targetId = null;
    if (socket && socket.readyState <= 1) {
      try {
        socket.close();
      } catch {
        // ignore
      }
    }
  }
}

const connection = new CdpConnection();

async function fetchTargets(): Promise<CdpTarget[]> {
  const response = await fetch(`${CDP_ENDPOINT}/json/list`, { cache: "no-store" });
  if (!response.ok)
    throw new Error(`CDP endpoint ${CDP_ENDPOINT} returned HTTP ${response.status}`);
  return (await response.json()) as CdpTarget[];
}

function pickPageTarget(targets: CdpTarget[], preferId?: string): CdpTarget | null {
  const pages = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (preferId) {
    const match = pages.find((t) => t.id === preferId);
    if (match) return match;
  }
  const httpPage = pages.find((t) => /^https?:|^file:/.test(t.url ?? ""));
  return httpPage ?? pages[0] ?? null;
}

async function ensureConnected(): Promise<CdpTarget> {
  const targets = await fetchTargets();
  if (connection.connected && connection.targetId) {
    const still = targets.find((t) => t.id === connection.targetId);
    if (still) return still;
  }
  const target = pickPageTarget(targets, connection.targetId ?? undefined);
  if (!target?.webSocketDebuggerUrl) {
    throw new Error(
      `No debuggable Chrome tab found at ${CDP_ENDPOINT}. Launch Chrome with --remote-debugging-port=9222.`,
    );
  }
  await connection.open(target.webSocketDebuggerUrl, target.id);
  await connection.send("Page.enable");
  await connection.send("Runtime.enable");
  return target;
}

async function evaluate(expression: string): Promise<unknown> {
  await ensureConnected();
  const result = (await connection.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: CDP_CALL_TIMEOUT_MS,
  })) as { result?: { value?: unknown }; exceptionDetails?: { text?: string } };
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "JS evaluation failed");
  }
  return result.result?.value;
}

function ok(text: string, details: Record<string, unknown> = {}): ToolResult {
  return { content: [{ type: "text", text }], details };
}

function fail(verb: string, error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `cdp_${verb} failed: ${message}` }],
    details: { verb, error: message, failed: true, endpoint: CDP_ENDPOINT },
  };
}

export default function registerCdpBrowserExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "cdp_status",
    label: "Chrome (CDP): Status",
    description:
      "Check the connection to the user's real Chrome (via remote-debugging CDP) and list open tabs. Run this first.",
    parameters: Type.Object({}),
    async execute() {
      try {
        const targets = await fetchTargets();
        const pages = targets
          .filter((t) => t.type === "page")
          .map((t) => ({ id: t.id, title: t.title, url: t.url }));
        return ok(`Connected to Chrome at ${CDP_ENDPOINT}. ${pages.length} tab(s) open.`, {
          endpoint: CDP_ENDPOINT,
          tabs: pages,
        });
      } catch (error) {
        return fail("status", error);
      }
    },
  });

  pi.registerTool({
    name: "cdp_navigate",
    label: "Chrome (CDP): Navigate",
    description:
      "Navigate the active Chrome tab to an absolute http(s)/file URL and wait for load.",
    parameters: Type.Object({ url: Type.String({ description: "Absolute URL to load" }) }),
    async execute(_id, params) {
      try {
        await ensureConnected();
        const loaded = connection.waitForEvent("Page.loadEventFired", 30_000);
        await connection.send("Page.navigate", { url: params.url });
        await loaded;
        const url = await evaluate("location.href");
        const title = await evaluate("document.title");
        return ok(`Navigated to ${String(url)} (“${String(title)}”).`, { url, title });
      } catch (error) {
        return fail("navigate", error);
      }
    },
  });

  pi.registerTool({
    name: "cdp_get_text",
    label: "Chrome (CDP): Get Text",
    description:
      "Return visible text from the active Chrome tab (optionally scoped to a selector).",
    parameters: Type.Object({
      selector: Type.Optional(Type.String({ description: "Optional CSS selector" })),
      maxChars: Type.Optional(
        Type.Number({ description: "Cap on returned characters (default 8000)" }),
      ),
    }),
    async execute(_id, params) {
      try {
        const cap = typeof params.maxChars === "number" ? params.maxChars : 8000;
        const sel = typeof params.selector === "string" ? params.selector : null;
        const expr = sel
          ? `(document.querySelector(${JSON.stringify(sel)})?.innerText ?? "")`
          : `document.body.innerText`;
        const text = String((await evaluate(expr)) ?? "");
        return ok(text.slice(0, cap), { length: text.length, truncated: text.length > cap });
      } catch (error) {
        return fail("get_text", error);
      }
    },
  });

  pi.registerTool({
    name: "cdp_get_html",
    label: "Chrome (CDP): Get HTML",
    description:
      "Return rendered HTML from the active Chrome tab (optionally scoped to a selector).",
    parameters: Type.Object({
      selector: Type.Optional(Type.String({ description: "Optional CSS selector" })),
    }),
    async execute(_id, params) {
      try {
        const sel = typeof params.selector === "string" ? params.selector : null;
        const expr = sel
          ? `(document.querySelector(${JSON.stringify(sel)})?.outerHTML ?? "")`
          : `document.documentElement.outerHTML`;
        const html = String((await evaluate(expr)) ?? "");
        return ok(html.slice(0, 20000), { length: html.length });
      } catch (error) {
        return fail("get_html", error);
      }
    },
  });

  pi.registerTool({
    name: "cdp_eval",
    label: "Chrome (CDP): Evaluate JS",
    description:
      "Run JavaScript in the active Chrome tab and return the (JSON-serializable) result. Supports await.",
    parameters: Type.Object({
      expression: Type.String({ description: "JavaScript expression to evaluate" }),
    }),
    async execute(_id, params) {
      try {
        const value = await evaluate(params.expression);
        return ok(
          typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? "undefined"),
          {
            value,
          },
        );
      } catch (error) {
        return fail("eval", error);
      }
    },
  });

  pi.registerTool({
    name: "cdp_click",
    label: "Chrome (CDP): Click",
    description: "Click the first element matching a CSS selector in the active Chrome tab.",
    parameters: Type.Object({ selector: Type.String({ description: "CSS selector to click" }) }),
    async execute(_id, params) {
      try {
        const sel = JSON.stringify(params.selector);
        const clicked = await evaluate(
          `(() => { const el = document.querySelector(${sel}); if (!el) return false; el.click(); return true; })()`,
        );
        return clicked
          ? ok(`Clicked ${params.selector}.`, { selector: params.selector })
          : fail("click", new Error(`no element matched ${params.selector}`));
      } catch (error) {
        return fail("click", error);
      }
    },
  });

  pi.registerTool({
    name: "cdp_fill",
    label: "Chrome (CDP): Fill Field",
    description:
      "Set the value of an input/textarea matching a CSS selector and dispatch input events.",
    parameters: Type.Object({
      selector: Type.String({ description: "CSS selector of the field" }),
      value: Type.String({ description: "Value to set" }),
    }),
    async execute(_id, params) {
      try {
        const sel = JSON.stringify(params.selector);
        const val = JSON.stringify(params.value);
        const done = await evaluate(
          `(() => { const el = document.querySelector(${sel}); if (!el) return false;` +
            ` el.focus(); el.value = ${val};` +
            ` el.dispatchEvent(new Event("input", { bubbles: true }));` +
            ` el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`,
        );
        return done
          ? ok(`Filled ${params.selector}.`, { selector: params.selector })
          : fail("fill", new Error(`no element matched ${params.selector}`));
      } catch (error) {
        return fail("fill", error);
      }
    },
  });

  pi.registerTool({
    name: "cdp_screenshot",
    label: "Chrome (CDP): Screenshot",
    description: "Capture a PNG screenshot of the active Chrome tab; returns the saved file path.",
    parameters: Type.Object({}),
    async execute() {
      try {
        await ensureConnected();
        const result = (await connection.send("Page.captureScreenshot", { format: "png" })) as {
          data?: string;
        };
        if (!result.data) throw new Error("no screenshot data returned");
        const file = path.join(tmpdir(), `cdp-shot-${connection.targetId ?? "tab"}.png`);
        writeFileSync(file, Buffer.from(result.data, "base64"));
        return ok(`Saved screenshot to ${file}`, { path: file });
      } catch (error) {
        return fail("screenshot", error);
      }
    },
  });

  pi.registerTool({
    name: "cdp_new_tab",
    label: "Chrome (CDP): New Tab",
    description: "Open a new Chrome tab (optionally at a URL) and make it the active CDP target.",
    parameters: Type.Object({
      url: Type.Optional(Type.String({ description: "Optional absolute URL to open" })),
    }),
    async execute(_id, params) {
      try {
        const url = typeof params.url === "string" ? params.url : "about:blank";
        const response = await fetch(`${CDP_ENDPOINT}/json/new?${encodeURIComponent(url)}`, {
          method: "PUT",
        }).catch(() => fetch(`${CDP_ENDPOINT}/json/new?${encodeURIComponent(url)}`));
        const target = (await response.json()) as CdpTarget;
        if (target.webSocketDebuggerUrl) {
          await connection.open(target.webSocketDebuggerUrl, target.id);
          await connection.send("Page.enable");
          await connection.send("Runtime.enable");
        }
        return ok(`Opened new tab at ${url}.`, { id: target.id, url });
      } catch (error) {
        return fail("new_tab", error);
      }
    },
  });

  pi.registerTool({
    name: "cdp_list_tabs",
    label: "Chrome (CDP): List Tabs",
    description: "List the open Chrome tabs (id, title, url).",
    parameters: Type.Object({}),
    async execute() {
      try {
        const targets = await fetchTargets();
        const tabs = targets
          .filter((t) => t.type === "page")
          .map((t) => ({ id: t.id, title: t.title, url: t.url }));
        return ok(`${tabs.length} tab(s).`, { tabs });
      } catch (error) {
        return fail("list_tabs", error);
      }
    },
  });
}
