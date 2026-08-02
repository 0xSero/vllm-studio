#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: !0,
      configurable: !0,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

var exports_assert_release_main = {};
__export(exports_assert_release_main, {
  assertReleaseMain: () => assertReleaseMain
});
import { execFileSync } from "node:child_process";
function valueAfter(args, name) {
  let index = args.indexOf(name);
  return index === -1 ? void 0 : args[index + 1];
}
function assertReleaseMain(args = process.argv.slice(2)) {
  let expected = valueAfter(args, "--commit")?.trim().toLowerCase();
  if (!expected || !/^[0-9a-f]{40}$/.test(expected))
    throw Error("--commit must be a full Git commit SHA");
  let current = execFileSync("git", ["ls-remote", "origin", "refs/heads/main"], {
    encoding: "utf8"
  }).trim().split(/\s+/, 1)[0]?.toLowerCase();
  if (!current || !/^[0-9a-f]{40}$/.test(current))
    throw Error("Could not resolve origin/main");
  if (current !== expected)
    throw Error(`Refusing stale release: origin/main is ${current}, build is ${expected}`);
  return console.log(`Release source is current origin/main: ${expected}`), expected;
}
var init_assert_release_main = __esm(() => {
  assertReleaseMain();
});

var exports_assert_standalone_build = {};
import {
  existsSync as existsSync2,
  lstatSync,
  readFileSync as readFileSync2,
  readdirSync,
  readlinkSync,
  realpathSync
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
function filesUnder(directory) {
  return readdirSync(directory, { recursive: !0, withFileTypes: !0 }).filter((entry) => entry.isFile()).map((entry) => resolve(entry.parentPath, entry.name));
}
function symlinksUnder(directory) {
  return readdirSync(directory, { recursive: !0, withFileTypes: !0 }).filter((entry) => entry.isSymbolicLink()).map((entry) => resolve(entry.parentPath, entry.name));
}
function isRuntimeFile(file) {
  let path2 = relative(standaloneBase, file).replaceAll("\\", "/");
  return [
    "server.js",
    "package.json",
    ".next/",
    "public/",
    "node_modules/",
    "frontend/server.js",
    "frontend/package.json",
    "frontend/.next/",
    "frontend/public/",
    "frontend/node_modules/"
  ].some((prefix) => path2 === prefix || path2.startsWith(prefix));
}
var projectRoot, standaloneBase, candidates, runtimeRoots, requiredRuntimeFiles, runtimeRoot, unsafeRuntimeLinks, tracedPackageDirectory, danglingTracedPackages, piCodingAgentRoot, piAiRoot, piRuntimeEntries, piAiManifestPath, piAiManifest, requireFromPiAi, unexpected;
var init_assert_standalone_build = __esm(() => {
  projectRoot = resolve(import.meta.dirname, ".."), standaloneBase = resolve(projectRoot, ".next", "standalone"), candidates = [
    resolve(standaloneBase, "frontend", "server.js"),
    resolve(standaloneBase, "server.js")
  ], runtimeRoots = [resolve(standaloneBase, "frontend"), standaloneBase], requiredRuntimeFiles = [
    "node_modules/@earendil-works/pi-coding-agent/package.json",
    "node_modules/@earendil-works/pi-coding-agent/dist/index.js",
    "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/package.json",
    "node_modules/@earendil-works/pi-coding-agent/node_modules/typebox/build/value/shared/union_priority_sort.mjs"
  ];
  if (!candidates.some((candidate) => existsSync2(candidate)))
    throw Error(`Missing standalone server: ${candidates.join(", ")}`);
  for (let file of requiredRuntimeFiles)
    if (!runtimeRoots.some((root) => existsSync2(resolve(root, file))))
      throw Error(`Missing standalone runtime dependency: ${file}`);
  runtimeRoot = runtimeRoots.find((root) => existsSync2(resolve(root, "server.js"))), unsafeRuntimeLinks = runtimeRoot ? symlinksUnder(runtimeRoot).filter((link) => {
    if (isAbsolute(readlinkSync(link)) || !existsSync2(link))
      return !0;
    let resolvedLink = relative(runtimeRoot, realpathSync(link));
    return resolvedLink === ".." || resolvedLink.startsWith(`..${sep}`) || isAbsolute(resolvedLink);
  }) : [];
  if (unsafeRuntimeLinks.length > 0)
    throw Error(`Unsafe standalone runtime links: ${unsafeRuntimeLinks.join(", ")}`);
  tracedPackageDirectory = runtimeRoot ? resolve(runtimeRoot, ".next/node_modules/@earendil-works") : void 0, danglingTracedPackages = tracedPackageDirectory ? existsSync2(tracedPackageDirectory) ? readdirSync(tracedPackageDirectory).map((entry) => resolve(tracedPackageDirectory, entry)).filter((entry) => lstatSync(entry).isSymbolicLink() && !existsSync2(entry)) : [] : [];
  if (danglingTracedPackages.length > 0)
    throw Error(`Dangling traced runtime packages: ${danglingTracedPackages.join(", ")}`);
  piCodingAgentRoot = runtimeRoot ? resolve(runtimeRoot, "node_modules/@earendil-works/pi-coding-agent") : null, piAiRoot = piCodingAgentRoot ? resolve(piCodingAgentRoot, "node_modules/@earendil-works/pi-ai") : null, piRuntimeEntries = piCodingAgentRoot && piAiRoot ? [resolve(piCodingAgentRoot, "dist/index.js"), resolve(piAiRoot, "dist/index.js")] : [];
  if (piRuntimeEntries.length !== 2 || piRuntimeEntries.some((entry) => !existsSync2(entry)))
    throw Error("Missing packaged Pi runtime entrypoints");
  for (let entry of piRuntimeEntries) {
    let importCheck = spawnSync(process.execPath, ["--input-type=module", "--eval", `import(${JSON.stringify(pathToFileURL(entry).href)})`], { cwd: runtimeRoot, encoding: "utf8" });
    if (importCheck.status !== 0)
      throw Error(`Standalone Pi runtime entrypoint is not importable: ${importCheck.stderr || importCheck.stdout}`);
  }
  piAiManifestPath = resolve(realpathSync(piAiRoot), "package.json"), piAiManifest = JSON.parse(readFileSync2(piAiManifestPath, "utf8")), requireFromPiAi = createRequire(piAiManifestPath);
  for (let dependency of Object.keys(piAiManifest.dependencies ?? {})) {
    let resolvedDependency = realpathSync(requireFromPiAi.resolve(dependency)), runtimeRelativePath = relative(runtimeRoot, resolvedDependency);
    if (runtimeRelativePath === ".." || runtimeRelativePath.startsWith(`..${sep}`) || isAbsolute(runtimeRelativePath))
      throw Error(`Pi AI dependency escaped standalone runtime: ${dependency}`);
  }
  unexpected = filesUnder(standaloneBase).filter((file) => !isRuntimeFile(file));
  if (unexpected.length > 0)
    throw Error(`Standalone build contains non-runtime files:
${unexpected.map((file) => relative(standaloneBase, file)).join(`
`)}`);
  console.log("  standalone server build is minimal");
});

import { readdirSync as readdirSync2, statSync } from "node:fs";
import { dirname, join, relative as relative2, sep as sep2 } from "node:path";
import { fileURLToPath } from "node:url";
function routeFromPageFile(filePath) {
  let segments = relative2(appDir, filePath).split(sep2).slice(0, -1);
  if (segments.some((segment) => segment.startsWith("[") || segment.startsWith("@") || segment.startsWith("_")))
    return null;
  let routeSegments = segments.filter((segment) => !segment.startsWith("("));
  return routeSegments.length === 0 ? "/" : `/${routeSegments.join("/")}`;
}
function pageFiles(directory) {
  let out = [];
  for (let entry of readdirSync2(directory)) {
    let entryPath = join(directory, entry);
    if (statSync(entryPath).isDirectory())
      out.push(...pageFiles(entryPath));
    else if (/^page\.(t|j)sx?$/u.test(entry))
      out.push(entryPath);
  }
  return out;
}
function sortRoutes(left, right) {
  let leftIndex = preferredOrder.indexOf(left.path), rightIndex = preferredOrder.indexOf(right.path);
  if (leftIndex !== -1 || rightIndex !== -1) {
    if (leftIndex === -1)
      return 1;
    if (rightIndex === -1)
      return -1;
    return leftIndex - rightIndex;
  }
  return left.path.localeCompare(right.path);
}
function discoveredPaths() {
  return [...new Set(pageFiles(appDir).map(routeFromPageFile).filter(Boolean))];
}
function httpRoutes() {
  return discoveredPaths().map((path2) => ({ path: path2, ...defaultHttpBudget, ...httpBudgetOverrides.get(path2) || {} })).sort(sortRoutes);
}
function browserRoutes() {
  return discoveredPaths().map((path2) => ({ path: path2, ...defaultBrowserBudget })).sort(sortRoutes);
}
var scriptsDir, appDir, preferredOrder, httpBudgetOverrides, defaultHttpBudget, defaultBrowserBudget;
var init_perf_routes = __esm(() => {
  scriptsDir = dirname(fileURLToPath(import.meta.url)), appDir = join(scriptsDir, "..", "src", "app"), preferredOrder = [
    "/",
    "/agent",
    "/agent/sessions",
    "/settings",
    "/recipes",
    "/logs",
    "/server",
    "/usage",
    "/configure",
    "/discover",
    "/quick",
    "/setup"
  ], httpBudgetOverrides = new Map([
    ["/", { assetKiB: 1050 }],
    ["/agent", { assetKiB: 1250 }],
    ["/agent/sessions", { assetKiB: 1250 }],
    ["/quick", { assetKiB: 1250 }],
    ["/logs", { assetKiB: 1000 }],
    ["/server", { assetKiB: 1000 }],
    ["/usage", { assetKiB: 1025 }],
    ["/configure", { assetKiB: 1025 }],
    ["/discover", { assetKiB: 1000 }]
  ]), defaultHttpBudget = { medianMs: 50, p90Ms: 150, assetKiB: 1100 }, defaultBrowserBudget = { dclMs: 500, fcpMs: 700, taskMs: 250, nodes: 1200, heapMiB: 24, textChars: 8 };
});

var exports_browser_perf_audit = {};
import { existsSync as existsSync3, mkdtempSync, readFileSync as readFileSync3, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as join2 } from "node:path";
import { spawn } from "node:child_process";
function sleep(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
function timeoutAfter(ms, message) {
  return new Promise((_, reject) => setTimeout(() => reject(Error(message)), ms));
}
function connectToTarget(webSocketDebuggerUrl) {
  let websocket = new WebSocket(webSocketDebuggerUrl), id = 0, pending = new Map;
  return websocket.addEventListener("message", (message) => {
    let data = JSON.parse(message.data);
    if (!data.id || !pending.has(data.id))
      return;
    let { resolve: resolve2, reject } = pending.get(data.id);
    if (pending.delete(data.id), data.error)
      reject(Error(JSON.stringify(data.error)));
    else
      resolve2(data.result);
  }), new Promise((resolve2, reject) => {
    websocket.addEventListener("open", () => resolve2({
      send(method, params = {}) {
        let callId = id += 1;
        return websocket.send(JSON.stringify({ id: callId, method, params })), new Promise((callResolve, callReject) => pending.set(callId, { resolve: callResolve, reject: callReject }));
      },
      close() {
        websocket.close();
      }
    })), websocket.addEventListener("error", reject);
  });
}
async function debugPortFor(userDataDir) {
  let activePortPath = join2(userDataDir, "DevToolsActivePort");
  for (let attempt = 0;attempt < 100; attempt += 1) {
    try {
      let port = readFileSync3(activePortPath, "utf8").split(`
`)[0]?.trim();
      if (/^\d+$/u.test(port ?? ""))
        return port;
    } catch {}
    await sleep(50);
  }
  throw Error("Chrome DevToolsActivePort did not appear");
}
async function pageTarget(debugPort) {
  for (let attempt = 0;attempt < 100; attempt += 1) {
    let target = (await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json())).find((entry) => entry.type === "page" && entry.url.startsWith(baseUrl));
    if (target)
      return target;
    await sleep(50);
  }
  throw Error("Chrome page target did not appear");
}
async function waitForComplete(page) {
  for (let attempt = 0;attempt < 100; attempt += 1) {
    if ((await page.send("Runtime.evaluate", { returnByValue: !0, expression: "document.readyState" })).result.value === "complete")
      return;
    await sleep(50);
  }
  throw Error("Page did not reach readyState=complete");
}
async function pageMetrics(page) {
  let evaluated = await page.send("Runtime.evaluate", {
    returnByValue: !0,
    expression: `(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const paints = Object.fromEntries(performance.getEntriesByType("paint").map((entry) => [entry.name, entry.startTime]));
      const resources = performance.getEntriesByType("resource");
      return {
        nav: nav ? nav.toJSON() : null,
        paints,
        resources: resources.length,
        scripts: resources.filter((entry) => entry.initiatorType === "script").length,
        css: resources.filter((entry) => entry.initiatorType === "link" || entry.name.endsWith(".css")).length,
        nodes: document.getElementsByTagName("*").length,
        textChars: document.body ? document.body.innerText.trim().length : 0,
      };
    })()`
  }), performanceMetrics = await page.send("Performance.getMetrics"), metric = Object.fromEntries(performanceMetrics.metrics.map((entry) => [entry.name, entry.value])), value = evaluated.result.value;
  return {
    dclMs: value.nav.domContentLoadedEventEnd,
    loadMs: value.nav.loadEventEnd,
    fcpMs: value.paints["first-contentful-paint"] || 0,
    resources: value.resources,
    scripts: value.scripts,
    css: value.css,
    nodes: value.nodes,
    textChars: value.textChars,
    heapMiB: (metric.JSHeapUsedSize || 0) / 1024 / 1024,
    taskMs: (metric.TaskDuration || 0) * 1000
  };
}
async function routeResult(route) {
  let userDataDir = mkdtempSync(join2(tmpdir(), "local-studio-browser-perf-")), child = spawn(chromePath, [
    "--headless=new",
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-dev-shm-usage",
    "--window-size=1440,1000",
    `--user-data-dir=${userDataDir}`,
    `${baseUrl}${route.path}`
  ], { stdio: ["ignore", "ignore", "ignore"] });
  try {
    let debugPort = await debugPortFor(userDataDir), target = await pageTarget(debugPort), page = await connectToTarget(target.webSocketDebuggerUrl);
    try {
      return await page.send("Performance.enable"), await waitForComplete(page), await sleep(100), { path: route.path, ...await pageMetrics(page), budget: route };
    } finally {
      page.close();
    }
  } finally {
    child.kill("SIGTERM"), await sleep(100), rmSync(userDataDir, { recursive: !0, force: !0, maxRetries: 5, retryDelay: 50 });
  }
}
function formatNumber(value) {
  return value.toFixed(1).padStart(6, " ");
}
function violations(result) {
  let out = [];
  if (result.dclMs > result.budget.dclMs)
    out.push(`dcl ${result.dclMs.toFixed(1)}ms > ${result.budget.dclMs}ms`);
  if (result.fcpMs > result.budget.fcpMs)
    out.push(`fcp ${result.fcpMs.toFixed(1)}ms > ${result.budget.fcpMs}ms`);
  if (result.taskMs > result.budget.taskMs)
    out.push(`task ${result.taskMs.toFixed(1)}ms > ${result.budget.taskMs}ms`);
  if (result.nodes > result.budget.nodes)
    out.push(`nodes ${result.nodes} > ${result.budget.nodes}`);
  if (result.textChars < result.budget.textChars)
    out.push(`text ${result.textChars} < ${result.budget.textChars}`);
  if (result.heapMiB > result.budget.heapMiB)
    out.push(`heap ${result.heapMiB.toFixed(1)}MiB > ${result.budget.heapMiB}MiB`);
  return out;
}
var defaultChromePaths, chromePath, baseUrl, routeTimeoutMs, routes, failures;
var init_browser_perf_audit = __esm(async () => {
  init_perf_routes();
  defaultChromePaths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ], chromePath = process.env.LOCAL_STUDIO_PERF_CHROME || defaultChromePaths.find((candidate) => existsSync3(candidate));
  if (!chromePath)
    console.error("Chrome executable not found. Set LOCAL_STUDIO_PERF_CHROME."), process.exit(1);
  baseUrl = (process.env.LOCAL_STUDIO_PERF_URL || "http://127.0.0.1:3000").replace(/\/+$/, ""), routeTimeoutMs = Math.max(5000, Number.parseInt(process.env.LOCAL_STUDIO_PERF_BROWSER_TIMEOUT_MS || "15000", 10)), routes = browserRoutes();
  console.log(`Local Studio browser perf audit: ${baseUrl}`);
  console.log("route              dcl    load     fcp    task    heap nodes  text res scripts css");
  failures = [];
  for (let route of routes) {
    let result = await Promise.race([
      routeResult(route).catch((error) => {
        throw Error(`${route.path}: ${error instanceof Error ? error.message : String(error)}`);
      }),
      timeoutAfter(routeTimeoutMs, `${route.path} timed out after ${routeTimeoutMs}ms`)
    ]), bad = violations(result);
    if (console.log(`${result.path.padEnd(16)} ${formatNumber(result.dclMs)}ms ${formatNumber(result.loadMs)}ms ${formatNumber(result.fcpMs)}ms ${formatNumber(result.taskMs)}ms ${formatNumber(result.heapMiB)}MiB ${String(result.nodes).padStart(5, " ")} ${String(result.textChars).padStart(5, " ")} ${String(result.resources).padStart(3, " ")} ${String(result.scripts).padStart(7, " ")} ${String(result.css).padStart(3, " ")}`), bad.length > 0)
      failures.push(`${result.path}: ${bad.join(", ")}`);
  }
  if (failures.length > 0) {
    console.error("Browser perf budget violations:");
    for (let failure of failures)
      console.error(`- ${failure}`);
    process.exit(1);
  }
});

var exports_build_model_recommendations = {};
import { readFileSync as readFileSync4, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join as join3 } from "node:path";
async function convexQuery(path2, args) {
  let response = await fetch(`${CONVEX_URL}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: path2, args, format: "json" })
  });
  if (!response.ok)
    throw Error(`${path2}: HTTP ${response.status}`);
  let payload = await response.json();
  if (payload.status !== "success")
    throw Error(`${path2}: ${JSON.stringify(payload)}`);
  return payload.value;
}
function parseHardwareKey(key) {
  let appleLike = /^m\d/.test(key), working = key, count = 1, multiplied = /^(.*)x(\d+)$/.exec(working);
  if (multiplied && !/\d+c$/.test(working))
    working = multiplied[1], count = Number(multiplied[2]);
  let segments = working.split("_"), memoryGb = null;
  for (let index = segments.length - 1;index > 0; index -= 1)
    if (/^\d+$/.test(segments[index])) {
      memoryGb = Number(segments[index]);
      break;
    }
  let stem = appleLike ? segments.slice(0, 2).join("_") : segments[0];
  return { stem, memoryGb, count, unified: appleLike || (HARDWARE_STEMS[stem]?.unified ?? !1) };
}
function hardwareTarget(key, displayName, tested) {
  let { stem, memoryGb, count, unified } = parseHardwareKey(key), fallbackMemory = HARDWARE_STEMS[stem]?.defaultMemoryGb ?? 0;
  return {
    id: key,
