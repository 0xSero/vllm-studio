// vLLM Studio Browser Bridge — extension service worker.
//
// Connects out to the local bridge over WebSocket and relays the DevTools
// protocol to/from tabs using the extension's `chrome.debugger` permission.
// Because this uses the debugger permission (not --remote-debugging-port), it
// works on your normal, logged-in default profile.
//
// Protocol (bridge -> here): { t:"req", rid, op, args }
//   ops: listTabs | attach{tabId} | detach{tabId} | send{tabId,method,params} | newTab{url}
// Replies (here -> bridge):  { t:"res", rid, ok, result|error }
// CDP events (here -> bridge): { t:"event", tabId, method, params }

const BRIDGE_URL = "ws://127.0.0.1:9222/__extension";
const RECONNECT_MS = 2000;
const KEEPALIVE_MS = 20000;

let socket = null;
let reconnectTimer = null;
const attachedTabs = new Set();

function connect() {
  reconnectTimer = null;
  try {
    socket = new WebSocket(BRIDGE_URL);
  } catch {
    scheduleReconnect();
    return;
  }
  socket.onopen = () => console.log("[vllm-bridge] connected to", BRIDGE_URL);
  socket.onclose = () => {
    socket = null;
    scheduleReconnect();
  };
  socket.onerror = () => {
    try {
      socket && socket.close();
    } catch {
      /* ignore */
    }
  };
  socket.onmessage = (event) => handleMessage(event.data);
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(connect, RECONNECT_MS);
}

function send(obj) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(obj));
}

async function handleMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (msg.t !== "req") return;
  try {
    const result = await runOp(msg.op, msg.args || {});
    send({ t: "res", rid: msg.rid, ok: true, result });
  } catch (error) {
    send({ t: "res", rid: msg.rid, ok: false, error: String((error && error.message) || error) });
  }
}

function runOp(op, args) {
  switch (op) {
    case "listTabs":
      return queryTabs();
    case "attach":
      return attach(args.tabId);
    case "detach":
      return detach(args.tabId);
    case "send":
      return sendCommand(args.tabId, args.method, args.params);
    case "newTab":
      return createTab(args.url);
    default:
      return Promise.reject(new Error("unknown op: " + op));
  }
}

function queryTabs() {
  return new Promise((resolve) => {
    chrome.tabs.query({}, (tabs) =>
      resolve(
        tabs.map((t) => ({
          tabId: t.id,
          url: t.url,
          title: t.title,
          active: t.active,
          windowId: t.windowId,
        })),
      ),
    );
  });
}

function attach(tabId) {
  return new Promise((resolve, reject) => {
    if (attachedTabs.has(tabId)) {
      resolve({ attached: true });
      return;
    }
    chrome.debugger.attach({ tabId }, "1.3", () => {
      const err = chrome.runtime.lastError;
      if (err) {
        if ((err.message || "").includes("Already attached")) {
          attachedTabs.add(tabId);
          resolve({ attached: true });
          return;
        }
        reject(new Error(err.message || "attach failed"));
        return;
      }
      attachedTabs.add(tabId);
      resolve({ attached: true });
    });
  });
}

function detach(tabId) {
  return new Promise((resolve) => {
    if (!attachedTabs.has(tabId)) {
      resolve({ detached: true });
      return;
    }
    chrome.debugger.detach({ tabId }, () => {
      attachedTabs.delete(tabId);
      void chrome.runtime.lastError;
      resolve({ detached: true });
    });
  });
}

function sendCommand(tabId, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params || {}, (result) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || "debugger command failed"));
        return;
      }
      resolve(result || {});
    });
  });
}

function createTab(url) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url: url || "about:blank" }, (tab) => resolve({ tabId: tab.id }));
  });
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId != null) send({ t: "event", tabId: source.tabId, method, params });
});
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId != null) attachedTabs.delete(source.tabId);
});

// Keep the MV3 service worker (and the bridge socket) alive.
setInterval(() => {
  if (socket && socket.readyState === WebSocket.OPEN) send({ t: "ping" });
  else connect();
}, KEEPALIVE_MS);
try {
  chrome.alarms.create("vllm-bridge-keepalive", { periodInMinutes: 0.4 });
  chrome.alarms.onAlarm.addListener(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) connect();
  });
} catch {
  /* alarms optional */
}

connect();
