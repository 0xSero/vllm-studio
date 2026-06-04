#!/usr/bin/env node
// vLLM Studio Brave bridge.
//
// Presents a standard Chrome-DevTools-Protocol endpoint (HTTP /json/list +
// per-page WebSockets) on 127.0.0.1:9222, but backs it with the companion
// browser extension's `chrome.debugger` permission instead of
// --remote-debugging-port. That makes the agent's existing CDP backend
// (cdp-browser.ts) drive your real, logged-in default Brave profile — which raw
// remote-debugging can't do on the default data dir (Chromium 136+).
//
// Topology:
//   cdp-browser.ts  <--CDP over WS-->  THIS bridge  <--WS-->  extension  --chrome.debugger-->  tabs
//
// Run (from anywhere; `ws` resolves via frontend/node_modules):
//   node frontend/desktop/resources/brave-bridge/bridge.mjs
// Then point the agent at it: VLLM_STUDIO_BROWSER_BACKEND=cdp (endpoint default :9222).

import http from "node:http";
import { WebSocketServer } from "ws";

const HOST = "127.0.0.1";
const PORT = Number(process.env.VLLM_STUDIO_BRAVE_BRIDGE_PORT ?? 9222);

let extensionSocket = null;
let ridSeq = 1;
const pending = new Map(); // rid -> { resolve, reject, timer }
const cdpClients = new Set(); // { socket, tabId }

function log(...args) {
  console.log(new Date().toISOString(), "[brave-bridge]", ...args);
}

function extRequest(op, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (!extensionSocket || extensionSocket.readyState !== extensionSocket.OPEN) {
      reject(new Error("extension not connected — load the vLLM Studio Browser Bridge in Brave"));
      return;
    }
    const rid = ridSeq++;
    const timer = setTimeout(() => {
      pending.delete(rid);
      reject(new Error(`extension '${op}' timed out`));
    }, timeoutMs);
    pending.set(rid, { resolve, reject, timer });
    extensionSocket.send(JSON.stringify({ t: "req", rid, op, args }));
  });
}

function handleExtensionMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (msg.t === "res") {
    const entry = pending.get(msg.rid);
    if (!entry) return;
    pending.delete(msg.rid);
    clearTimeout(entry.timer);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new Error(msg.error || "extension error"));
  } else if (msg.t === "event") {
    const tab = String(msg.tabId);
    for (const client of cdpClients) {
      if (client.tabId === tab && client.socket.readyState === client.socket.OPEN) {
        client.socket.send(JSON.stringify({ method: msg.method, params: msg.params }));
      }
    }
  }
  // {t:"ping"} and anything else is ignored (keepalive).
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (req.method === "GET" && (url.pathname === "/json" || url.pathname === "/json/list")) {
    let tabs = [];
    try {
      tabs = await extRequest("listTabs", {});
    } catch (error) {
      log("listTabs failed:", error.message);
    }
    const list = (tabs || [])
      .filter((t) => /^https?:|^file:/.test(t.url || ""))
      .map((t) => ({
        id: String(t.tabId),
        type: "page",
        title: t.title || "",
        url: t.url || "",
        webSocketDebuggerUrl: `ws://${HOST}:${PORT}/devtools/page/${t.tabId}`,
      }));
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(list));
    return;
  }
  if (req.method === "GET" && url.pathname === "/json/version") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        Browser: "Brave (via vLLM Studio bridge)",
        "Protocol-Version": "1.3",
        webSocketDebuggerUrl: `ws://${HOST}:${PORT}/devtools/browser`,
      }),
    );
    return;
  }
  if (req.method === "GET" && url.pathname === "/") {
    res.setHeader("Content-Type", "text/plain");
    res.end(
      `vLLM Studio Brave bridge\n` +
        `extension: ${extensionSocket ? "connected" : "NOT connected"}\n` +
        `cdp clients: ${cdpClients.size}\n`,
    );
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});

const extWss = new WebSocketServer({ noServer: true });
const cdpWss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (url.pathname === "/__extension") {
    extWss.handleUpgrade(req, socket, head, (ws) => {
      if (extensionSocket && extensionSocket.readyState === extensionSocket.OPEN) {
        log("replacing previous extension connection");
        try {
          extensionSocket.close();
        } catch {
          /* ignore */
        }
      }
      extensionSocket = ws;
      log("extension connected");
      ws.on("message", (data) => handleExtensionMessage(data.toString()));
      ws.on("close", () => {
        if (extensionSocket === ws) extensionSocket = null;
        log("extension disconnected");
      });
      ws.on("error", () => {});
    });
  } else if (url.pathname.startsWith("/devtools/page/")) {
    const tabId = url.pathname.slice("/devtools/page/".length);
    cdpWss.handleUpgrade(req, socket, head, (ws) => handleCdpClient(ws, tabId));
  } else {
    socket.destroy();
  }
});

function handleCdpClient(ws, tabId) {
  const client = { socket: ws, tabId: String(tabId) };
  cdpClients.add(client);
  log("CDP client connected for tab", tabId);
  // Attach in the background, but register the message/close listeners
  // SYNCHRONOUSLY — a CDP client typically sends its first command immediately
  // on open, and awaiting here would drop messages that arrive before the
  // listener exists. Each command waits on `attached` before it's forwarded.
  const attached = extRequest("attach", { tabId: Number(tabId) }).catch((error) =>
    log("attach failed:", error.message),
  );
  ws.on("message", async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    const { id, method, params } = msg;
    try {
      await attached;
      const result = await extRequest("send", { tabId: Number(tabId), method, params: params || {} });
      ws.send(JSON.stringify({ id, result: result || {} }));
    } catch (error) {
      ws.send(JSON.stringify({ id, error: { message: String(error.message || error) } }));
    }
  });
  ws.on("close", async () => {
    cdpClients.delete(client);
    if (![...cdpClients].some((c) => c.tabId === String(tabId))) {
      try {
        await extRequest("detach", { tabId: Number(tabId) });
      } catch {
        /* ignore */
      }
    }
  });
  ws.on("error", () => {});
}

server.listen(PORT, HOST, () => {
  log(`listening on http://${HOST}:${PORT} (CDP endpoint backed by the Brave extension)`);
  log(`status: http://${HOST}:${PORT}/  ·  set VLLM_STUDIO_BROWSER_BACKEND=cdp for the agent`);
});
