#!/usr/bin/env node
// vLLM Studio Computer Use — our own macOS desktop-control MCP server.
//
// Original implementation (no OpenAI binaries). Speaks MCP over stdio
// (newline-delimited JSON-RPC) and exposes the same 9-tool surface the Codex
// computer-use plugin does, so the model drives it identically:
//   list_apps · get_app_state · click · perform_secondary_action · scroll ·
//   drag · type_text · press_key · set_value
//
// Backends (all native macOS): screencapture+sips (screenshots), cliclick
// (mouse), osascript/System Events (keyboard, app activation, accessibility
// tree), python3+Quartz (scroll wheel). Every action returns a fresh screenshot
// + a short accessibility snapshot, mirroring computer-use result shape.
//
// Requires (System Settings → Privacy & Security): Screen Recording +
// Accessibility for the process that launches this (the vLLM Studio app / node).

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const TMP = mkdtempSync(path.join(tmpdir(), "vllm-cu-"));
const SCREENSHOT_MAX_WIDTH = Number(process.env.VLLM_STUDIO_CU_SHOT_WIDTH ?? 1366);
const A11Y_MAX_CHARS = 6000;

function run(cmd, args, { input, timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out: out.trim(), err: err.trim() });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out: "", err: String(e.message || e) });
    });
    if (input != null) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

const osa = (script) => run("osascript", ["-e", script]);

async function activateApp(app) {
  if (!app) return;
  // `app` may be a bundle id or a name; try both forms.
  await osa(`tell application id "${app}" to activate`).then((r) =>
    r.code === 0 ? r : osa(`tell application "${app}" to activate`),
  );
}

async function screenshot() {
  const raw = path.join(TMP, "shot.png");
  const cap = await run("screencapture", ["-x", "-t", "png", raw]);
  if (cap.code !== 0) return { error: cap.err || "screencapture failed" };
  await run("sips", ["-Z", String(SCREENSHOT_MAX_WIDTH), raw]).catch(() => ({}));
  try {
    const data = readFileSync(raw);
    return { base64: data.toString("base64") };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

async function frontmostApp() {
  const r = await osa('tell application "System Events" to return name of first process whose frontmost is true');
  return r.code === 0 ? r.out : "";
}

async function accessibilitySnapshot(app) {
  const target = app || (await frontmostApp());
  if (!target) return "";
  // Keep it bounded — entire contents can be enormous.
  const script =
    `tell application "System Events"\n` +
    `  set out to ""\n` +
    `  try\n` +
    `    set proc to first process whose name is "${target}"\n` +
    `  on error\n` +
    `    try\n` +
    `      set proc to first process whose bundle identifier is "${target}"\n` +
    `    on error\n` +
    `      return "App not found: ${target}"\n` +
    `    end try\n` +
    `  end try\n` +
    `  set out to "App=" & (name of proc) & " (pid " & (unix id of proc) & ")\\n"\n` +
    `  try\n` +
    `    set els to entire contents of proc\n` +
    `    set i to 0\n` +
    `    repeat with el in els\n` +
    `      if i > 200 then exit repeat\n` +
    `      try\n` +
    `        set r to (role of el as string)\n` +
    `      on error\n` +
    `        set r to "?"\n` +
    `      end try\n` +
    `      set t to ""\n` +
    `      try\n` +
    `        set t to (title of el as string)\n` +
    `      end try\n` +
    `      if t is "" then\n` +
    `        try\n` +
    `          set t to (value of el as string)\n` +
    `        end try\n` +
    `      end if\n` +
    `      set out to out & "[" & i & "] " & r & " " & t & "\\n"\n` +
    `      set i to i + 1\n` +
    `    end repeat\n` +
    `  end try\n` +
    `  return out\n` +
    `end tell`;
  const r = await osa(script);
  return (r.code === 0 ? r.out : r.err || "").slice(0, A11Y_MAX_CHARS);
}

// ---- input backends ----------------------------------------------------------

const cliclick = (...args) => run("cliclick", args);

async function mouseClick(x, y, button) {
  const verb = button === "right" ? "rc" : button === "middle" ? "mc" : "c";
  return cliclick(`${verb}:${Math.round(x)},${Math.round(y)}`);
}

async function mouseDrag(fromX, fromY, toX, toY) {
  return cliclick(
    `dd:${Math.round(fromX)},${Math.round(fromY)}`,
    `du:${Math.round(toX)},${Math.round(toY)}`,
  );
}

async function scrollWheel(direction, amount) {
  // Quartz scroll wheel: +y scrolls up, -y down; +x right, -x left.
  const lines = Math.max(1, Math.round(amount));
  const dy = direction === "up" ? lines : direction === "down" ? -lines : 0;
  const dx = direction === "right" ? lines : direction === "left" ? -lines : 0;
  const py =
    "import Quartz,sys\n" +
    "dy=int(sys.argv[1]); dx=int(sys.argv[2])\n" +
    "e=Quartz.CGEventCreateScrollWheelEvent(None,Quartz.kCGScrollEventUnitLine,2,dy,dx)\n" +
    "Quartz.CGEventPost(Quartz.kCGHIDEventTap,e)\n";
  return run("python3", ["-c", py, String(dy), String(dx)]);
}

function escapeForAppleScript(text) {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function typeText(text) {
  return osa(`tell application "System Events" to keystroke "${escapeForAppleScript(text)}"`);
}

const KEY_CODES = {
  return: 36, enter: 36, tab: 48, space: 49, delete: 51, backspace: 51,
  escape: 53, esc: 53, left: 123, right: 124, down: 125, up: 126,
  home: 115, end: 119, pageup: 116, pagedown: 121, forwarddelete: 117,
};
const MODIFIERS = {
  cmd: "command down", command: "command down", ctrl: "control down",
  control: "control down", opt: "option down", option: "option down",
  alt: "option down", shift: "shift down", fn: "function down",
};

async function pressKey(combo) {
  const parts = String(combo)
    .split(/[+\-\s]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const mods = parts.filter((p) => MODIFIERS[p]).map((p) => MODIFIERS[p]);
  const keys = parts.filter((p) => !MODIFIERS[p]);
  const key = keys[keys.length - 1] ?? "";
  const using = mods.length ? ` using {${mods.join(", ")}}` : "";
  if (key in KEY_CODES) {
    return osa(`tell application "System Events" to key code ${KEY_CODES[key]}${using}`);
  }
  return osa(`tell application "System Events" to keystroke "${escapeForAppleScript(key)}"${using}`);
}

async function clickElement(app, index, secondary, namedAction) {
  const target = app || (await frontmostApp());
  const action = secondary ? (namedAction || "AXShowMenu") : "AXPress";
  const script =
    `tell application "System Events"\n` +
    `  set proc to first process whose name is "${target}"\n` +
    `  set els to entire contents of proc\n` +
    `  set el to item ${Number(index) + 1} of els\n` +
    `  perform action "${action}" of el\n` +
    `end tell`;
  return osa(script);
}

async function setElementValue(app, index, value) {
  const target = app || (await frontmostApp());
  const script =
    `tell application "System Events"\n` +
    `  set proc to first process whose name is "${target}"\n` +
    `  set els to entire contents of proc\n` +
    `  set value of (item ${Number(index) + 1} of els) to "${escapeForAppleScript(String(value))}"\n` +
    `end tell`;
  return osa(script);
}

// ---- tool definitions --------------------------------------------------------

const APP = { type: "string", description: "Target app name or bundle id" };
const TOOLS = [
  { name: "list_apps", description: "List running applications.", inputSchema: { type: "object", properties: {} } },
  { name: "get_app_state", description: "Return the accessibility tree (indexed UI elements) of an app.", inputSchema: { type: "object", properties: { app: APP }, required: ["app"] } },
  { name: "click", description: "Click at pixel {x,y} (or an element_index). button: left|right|middle.", inputSchema: { type: "object", properties: { app: APP, x: { type: "number" }, y: { type: "number" }, element_index: { type: "number" }, button: { type: "string" } } } },
  { name: "perform_secondary_action", description: "Context/secondary action on an element (default right-click menu).", inputSchema: { type: "object", properties: { app: APP, element_index: { type: "number" }, action: { type: "string" } } } },
  { name: "scroll", description: "Scroll the active window. direction: up|down|left|right, pages: number.", inputSchema: { type: "object", properties: { app: APP, direction: { type: "string" }, pages: { type: "number" } } } },
  { name: "drag", description: "Drag from {from_x,from_y} to {to_x,to_y} in pixels.", inputSchema: { type: "object", properties: { app: APP, from_x: { type: "number" }, from_y: { type: "number" }, to_x: { type: "number" }, to_y: { type: "number" } }, required: ["from_x", "from_y", "to_x", "to_y"] } },
  { name: "type_text", description: "Type text into the focused field.", inputSchema: { type: "object", properties: { app: APP, text: { type: "string" } }, required: ["text"] } },
  { name: "press_key", description: "Press a key or combo, e.g. 'return', 'cmd+a', 'ctrl+shift+t'.", inputSchema: { type: "object", properties: { app: APP, key: { type: "string" } }, required: ["key"] } },
  { name: "set_value", description: "Set an element's value directly by element_index.", inputSchema: { type: "object", properties: { app: APP, element_index: { type: "number" }, value: { type: "string" } } } },
];

const ACTION_TOOLS = new Set(["click", "perform_secondary_action", "scroll", "drag", "type_text", "press_key", "set_value"]);

// Surface real failures instead of reporting silent success. The most common is
// the macOS Accessibility "control" permission, which osascript/cliclick need to
// send input — without it keystrokes fail with "not allowed to send keystrokes".
function checkExec(result, label) {
  if (result && typeof result.code === "number" && result.code !== 0) {
    const err = (result.err || "").trim();
    if (/not allowed|assistive access|1002|accessibility/i.test(err)) {
      throw new Error(
        `${label}: macOS Accessibility permission required to control input. Grant it to the app that launches this MCP (System Settings → Privacy & Security → Accessibility), then retry. [${err}]`,
      );
    }
    throw new Error(`${label} failed: ${err || `exit ${result.code}`}`);
  }
  return result;
}

// Settle delay so a freshly-activated app is actually frontmost before we send
// input to it (activate returns before the app finishes coming forward).
const ACTIVATE_SETTLE_MS = Number(process.env.VLLM_STUDIO_CU_ACTIVATE_SETTLE_MS ?? 350);
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

async function callTool(name, args = {}) {
  if (args.app) {
    await activateApp(args.app);
    await settle(ACTIVATE_SETTLE_MS);
  }
  let summary = "";
  switch (name) {
    case "list_apps": {
      const r = await osa('tell application "System Events" to return name of every process whose background only is false');
      return { textOnly: r.out.split(", ").map((s) => `- ${s}`).join("\n") || "(none)" };
    }
    case "get_app_state":
      return { textOnly: await accessibilitySnapshot(args.app) };
    case "click":
      if (typeof args.element_index === "number") {
        checkExec(await clickElement(args.app, args.element_index, false), "click");
        summary = `click element [${args.element_index}]`;
      } else {
        checkExec(await mouseClick(args.x, args.y, args.button), "click");
        summary = `click (${Math.round(args.x)}, ${Math.round(args.y)})${args.button ? " " + args.button : ""}`;
      }
      break;
    case "perform_secondary_action":
      checkExec(await clickElement(args.app, args.element_index, true, args.action), "perform_secondary_action");
      summary = `secondary action${args.action ? " " + args.action : ""} on [${args.element_index}]`;
      break;
    case "scroll":
      checkExec(await scrollWheel(args.direction || "down", args.pages ?? 3), "scroll");
      summary = `scroll ${args.direction || "down"} ${args.pages ?? 3}`;
      break;
    case "drag":
      checkExec(await mouseDrag(args.from_x, args.from_y, args.to_x, args.to_y), "drag");
      summary = `drag (${Math.round(args.from_x)},${Math.round(args.from_y)})→(${Math.round(args.to_x)},${Math.round(args.to_y)})`;
      break;
    case "type_text":
      checkExec(await typeText(args.text ?? ""), "type_text");
      summary = `type ${JSON.stringify((args.text ?? "").slice(0, 40))}`;
      break;
    case "press_key":
      checkExec(await pressKey(args.key ?? ""), "press_key");
      summary = `key ${args.key}`;
      break;
    case "set_value":
      checkExec(await setElementValue(args.app, args.element_index, args.value), "set_value");
      summary = `set [${args.element_index}] = ${JSON.stringify(String(args.value).slice(0, 40))}`;
      break;
    default:
      throw new Error(`unknown tool: ${name}`);
  }
  return { summary, action: true };
}

function content(result) {
  if (result.textOnly != null) return [{ type: "text", text: result.textOnly }];
  return null; // action: filled in by caller (needs async screenshot)
}

// ---- MCP stdio loop ----------------------------------------------------------

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handleRequest(req) {
  const { id, method, params } = req;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "vLLM Studio Computer Use", version: "0.1.0" },
      },
    });
    return;
  }
  if (method === "notifications/initialized" || method === "initialized") return;
  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }
  if (method === "tools/call") {
    const toolName = params?.name;
    const args = params?.arguments || {};
    try {
      const r = await callTool(toolName, args);
      let parts = content(r);
      if (r.action) {
        const shot = await screenshot();
        const a11y = await accessibilitySnapshot(args.app);
        parts = [{ type: "text", text: `${r.summary}\n\n${a11y}` }];
        if (shot.base64) parts.push({ type: "image", data: shot.base64, mimeType: "image/png" });
      }
      send({ jsonrpc: "2.0", id, result: { content: parts || [{ type: "text", text: "(no output)" }] } });
    } catch (e) {
      send({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: String(e.message || e) }] } });
    }
    return;
  }
  if (id != null) send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      continue;
    }
    void handleRequest(req);
  }
});
process.stdin.on("end", () => process.exit(0));

// Advertise readiness on stderr (stdout is reserved for JSON-RPC).
process.stderr.write(`vLLM Studio Computer Use MCP ready (tmp=${TMP})\n`);
