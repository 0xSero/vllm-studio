#!/usr/bin/env node
// Health check + activation guide for vLLM Studio's own first-party plugins:
// computer-use (macOS desktop control) and chrome (real logged-in browser).
// All black-box checks — no TypeScript import needed.
//
//   node frontend/desktop/resources/plugins-doctor.mjs

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ok = (s) => `  ✅ ${s}`;
const bad = (s) => `  ❌ ${s}`;
const warn = (s) => `  ⚠️  ${s}`;
const head = (s) => `\n${s}`;
const BRIDGE_DIR = path.join(HERE, "brave-bridge");
const BRAVE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";

function checkScreenRecording() {
  const out = "/tmp/cu-doctor-shot.png";
  const r = spawnSync("screencapture", ["-x", "-t", "png", out]);
  return r.status === 0 && existsSync(out);
}

function checkAccessibility() {
  // Reading another process's UI elements needs the SAME Accessibility "control"
  // permission that *sending input* does (and has no side effects). Reading a
  // process NAME does not require it — so probe UI elements, not the name.
  const r = spawnSync("osascript", [
    "-e",
    'tell application "System Events" to count windows of (first application process whose frontmost is true)',
  ]);
  const err = r.stderr ? r.stderr.toString() : "";
  if (/not allowed|assistive access/i.test(err)) return false;
  return r.status === 0;
}

function checkComputerUseMcp() {
  const server = path.join(HERE, "computer-use", "server.mjs");
  if (!existsSync(server)) return Promise.resolve({ ok: false, msg: "server.mjs missing" });
  return new Promise((resolve) => {
    const proc = spawn("node", [server], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    const req = (o) => proc.stdin.write(JSON.stringify(o) + "\n");
    req({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "doctor", version: "1" } } });
    req({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    setTimeout(() => {
      proc.kill();
      try {
        const lines = out.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
        const init = lines.find((l) => l.id === 1);
        const tools = lines.find((l) => l.id === 2)?.result?.tools || [];
        resolve({ ok: Boolean(init?.result) && tools.length === 9, msg: `${tools.length}/9 tools`, tools: tools.map((t) => t.name) });
      } catch (e) {
        resolve({ ok: false, msg: String(e.message || e) });
      }
    }, 4000);
  });
}

async function checkBridge() {
  try {
    const res = await fetch("http://127.0.0.1:9222/", { signal: AbortSignal.timeout(1500) });
    const text = await res.text();
    return { running: true, extension: /extension:\s*connected/.test(text) };
  } catch {
    return { running: false, extension: false };
  }
}

async function main() {
  console.log("=== vLLM Studio /plugins doctor — computer-use + chrome (our own copies) ===");

  console.log(head("Computer Use  (macOS desktop control · our MCP)"));
  console.log(checkScreenRecording() ? ok("Screen Recording permission") : bad("Screen Recording — grant the vLLM Studio app/node in System Settings → Privacy & Security"));
  console.log(checkAccessibility() ? ok("Accessibility permission") : bad("Accessibility — grant the vLLM Studio app/node in System Settings → Privacy & Security"));
  const cu = await checkComputerUseMcp();
  console.log(cu.ok ? ok(`computer-use MCP (${cu.msg})`) : bad(`computer-use MCP: ${cu.msg}`));
  if (cu.ok) console.log(`       tools: ${cu.tools.join(", ")}`);

  console.log(head("Chrome  (your real logged-in Brave · our extension + bridge)"));
  console.log(existsSync(BRAVE) ? ok("Brave installed") : warn("Brave not at the default path"));
  console.log(existsSync(path.join(BRIDGE_DIR, "extension", "manifest.json")) ? ok("bridge extension files present") : bad("extension folder missing"));
  const b = await checkBridge();
  console.log(b.running ? ok("bridge running on :9222") : bad(`bridge NOT running — start it:  node ${path.join(BRIDGE_DIR, "bridge.mjs")}`));
  if (b.running) console.log(b.extension ? ok("extension connected to bridge") : warn(`extension NOT loaded — brave://extensions → Developer mode → Load unpacked → ${path.join(BRIDGE_DIR, "extension")}`));

  console.log(head("Activate"));
  console.log(`  1. brave://extensions → Developer mode → Load unpacked → ${path.join(BRIDGE_DIR, "extension")}`);
  console.log(`  2. node ${path.join(BRIDGE_DIR, "bridge.mjs")}        (keep running)`);
  console.log("  3. In the agent, select @computer-use and/or @chrome (the browser backend auto-routes to cdp).");
  console.log("  Re-run this doctor until every line is green.\n");
}

void main();
