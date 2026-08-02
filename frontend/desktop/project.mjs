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
    label: displayName ?? key,
    minMemoryGb: (memoryGb ?? fallbackMemory) * count,
    gpuCount: count,
    unifiedMemory: unified,
    tested
  };
}
function inferQuant(declared, hfRepo, engine) {
  if (declared && declared !== "unknown") {
    let normalized = declared.toLowerCase().replaceAll("-", "");
    for (let [, kind] of QUANT_PATTERNS)
      if (normalized === kind.replaceAll("-", ""))
        return kind;
    for (let [pattern, kind] of QUANT_PATTERNS)
      if (pattern.test(declared))
        return kind;
  }
  for (let [pattern, kind] of QUANT_PATTERNS)
    if (pattern.test(hfRepo))
      return kind;
  if (engine === "mlx")
    return "mlx";
  if (engine === "llamacpp")
    return "gguf";
  return "bf16";
}
function runArgv(run) {
  let serve = run.inferenceEngineConfig?.runnable_serve?.serve_argv;
  if (Array.isArray(serve) && serve.length > 0)
    return { argv: serve, complete: !0 };
  let recipe = run.inferenceEngineConfig?.recipe_args;
  if (Array.isArray(recipe) && recipe.length > 0)
    return { argv: recipe, complete: !1 };
  return { argv: [], complete: !1 };
}
function withoutFlag(argv, flag) {
  let output = [];
  for (let index = 0;index < argv.length; index += 1) {
    if (argv[index] === flag) {
      index += 1;
      continue;
    }
    output.push(argv[index]);
  }
  return output;
}
function shellToken(token) {
  return /^[A-Za-z0-9@%_+=:,./-]+$/.test(token) ? token : `'${token.replaceAll("'", "'\\''")}'`;
}
function commandFor(engine, hfRepo, run) {
  let { argv: rawArgv } = runArgv(run), argv = rawArgv.map(shellToken);
  switch (engine) {
    case "vllm": {
      let rest = withoutFlag(argv, "--model").join(" ");
      return `vllm serve ${hfRepo}${rest ? ` ${rest}` : ""}`.trim();
    }
    case "sglang": {
      let rest = withoutFlag(withoutFlag(argv, "--model-path"), "--model").join(" ");
      return `python -m sglang.launch_server --model-path ${hfRepo}${rest ? ` ${rest}` : ""}`.trim();
    }
    case "llamacpp": {
      let rest = withoutFlag(withoutFlag(argv, "-m"), "--model").join(" ");
      return `llama-server -m ${hfRepo}${rest ? ` ${rest}` : ""}`.trim();
    }
    case "mlx": {
      let rest = withoutFlag(argv, "--model").join(" ");
      return `mlx_lm.server --model ${hfRepo}${rest ? ` ${rest}` : ""}`.trim();
    }
    default:
      return null;
  }
}
function qualityOf(evalRuns) {
  let best = new Map;
  for (let run of evalRuns ?? []) {
    if (!EVAL_FAMILIES.includes(run.evalFamily))
      continue;
    if (typeof run.meanTaskScore !== "number")
      continue;
    let current = best.get(run.evalFamily);
    if (current === void 0 || run.meanTaskScore > current)
      best.set(run.evalFamily, run.meanTaskScore);
  }
  if (best.size === 0)
    return null;
  return [...best.values()].reduce((sum, value) => sum + value, 0) / best.size;
}
function estimateSizeGb(paramsB, quant) {
  if (!paramsB)
    return null;
  let perParam = BYTES_PER_PARAM[quant] ?? 1;
  return Math.round(paramsB * perParam * 1.08);
}
async function hfRepoSizeGb(hfRepo) {
  try {
    let response = await fetch(`https://huggingface.co/api/models/${hfRepo}?blobs=true`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!response.ok)
      return null;
    let bytes = ((await response.json()).siblings ?? []).filter((sibling) => WEIGHT_FILE.test(sibling.rfilename ?? "")).reduce((sum, sibling) => sum + (sibling.size ?? 0), 0);
    return bytes > 0 ? bytes / 1073741824 : null;
  } catch {
    return null;
  }
}
function paramsFromName(name) {
  let match = /(\d+(?:\.\d+)?)\s*B/i.exec(name ?? "");
  return match ? Number(match[1]) : null;
}
var CONVEX_URL, DISK_SIZES_PATH, OUT_PATH, DETAIL_CONCURRENCY = 8, HARDWARE_STEMS, QUANT_PATTERNS, median = (values) => {
  if (values.length === 0)
    return null;
  let sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}, decodeAt = (points, contextTokens) => median((points ?? []).filter((point) => typeof point.generationTps === "number" && (point.completionTokens ?? 0) >= 8 && Math.abs(point.promptTokens - contextTokens) <= contextTokens * 0.5).map((point) => point.generationTps)), runSpeeds = (run) => {
  let points = run.points ?? [], maxContext = null, prefillSamples = [];
  for (let point of points) {
    if (typeof point.promptTokens === "number")
      maxContext = Math.max(maxContext ?? 0, point.promptTokens);
    if ((point.cachedPromptTokens ?? 0) === 0 && typeof point.promptTps === "number" && point.promptTokens >= 2048)
      prefillSamples.push(point.promptTps);
  }
  return {
    decode8k: decodeAt(points, 8192),
    decode32k: decodeAt(points, 32768),
    prefill: median(prefillSamples),
    maxContext
  };
}, decodeOf = (run) => {
  let speeds = runSpeeds(run);
  return speeds.decode8k ?? speeds.decode32k;
}, EVAL_FAMILIES, BYTES_PER_PARAM, WEIGHT_FILE, snapshot, models, hardwareRows, hardwareNames, diskSizes, sizeByRepo, withRuns, details, entries, ranked, scored, layers, pool, unscored, output, file, body, measured;
var init_build_model_recommendations = __esm(async () => {
  CONVEX_URL = process.env.LOCALAI_CONVEX_URL ?? "https://small-spoonbill-302.convex.cloud", DISK_SIZES_PATH = process.env.LOCALAI_DISK_SIZES ?? join3(homedir(), "ai/local-ai-web/public/data/v1/model-disk-sizes.json"), OUT_PATH = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "shared/model-recommendations.json";
  HARDWARE_STEMS = {
    gb10: { unified: !0, defaultMemoryGb: 121 },
    gb300: { unified: !0, defaultMemoryGb: 288 },
    rtxpro6000: { unified: !1 },
    rtx6000ada: { unified: !1 },
    rtx5090: { unified: !1 },
    rtx4090: { unified: !1 }
  };
  QUANT_PATTERNS = [
    [/nvfp4/i, "nvfp4"],
    [/fp8/i, "fp8"],
    [/awq/i, "awq"],
    [/gptq/i, "gptq"],
    [/gguf|q[2-8]_[a-z0-9_]+|iq[1-4]/i, "gguf"],
    [/exl3/i, "exl3"],
    [/mlx|[-_](\d)bit/i, "mlx"],
    [/mixed/i, "mixed-bit"],
    [/bf16|fp16/i, "bf16"]
  ];
  EVAL_FAMILIES = ["tau2", "gaia", "gdpval"];
  BYTES_PER_PARAM = {
    bf16: 2,
    fp8: 1.05,
    nvfp4: 0.58,
    awq: 0.6,
    gptq: 0.6,
    gguf: 0.65,
    exl3: 0.55,
    mlx: 0.6,
    "mixed-bit": 0.7
  };
  WEIGHT_FILE = /\.(safetensors|gguf|bin|pt|npz)$/;
  snapshot = await convexQuery("pgCatalog:snapshot", {}), models = snapshot.models ?? [], hardwareRows = snapshot.hardware ?? [];
  console.log(`snapshot: publication=${snapshot.publicationId} models=${models.length} hardware=${hardwareRows.length}`);
  hardwareNames = new Map(hardwareRows.map((row) => [row.hardwareKey, row.displayName])), diskSizes = [];
  try {
    let parsed = JSON.parse(readFileSync4(DISK_SIZES_PATH, "utf8"));
    diskSizes = Array.isArray(parsed) ? parsed : parsed.sizes ?? [];
  } catch {
    console.warn(`disk sizes not found at ${DISK_SIZES_PATH}; sizes will be estimated`);
  }
  sizeByRepo = new Map;
  for (let entry of diskSizes) {
    let key = (entry.hfRepo ?? entry.modelId ?? "").toLowerCase();
    if (key && entry.diskBytes > 0)
      sizeByRepo.set(key, entry.diskBytes / 1073741824);
  }
  withRuns = models.filter((model) => (model.speedSweepCount ?? 0) > 0);
  console.log(`models with speed runs: ${withRuns.length}`);
  details = new Map;
  for (let index = 0;index < withRuns.length; index += DETAIL_CONCURRENCY) {
    let batch = withRuns.slice(index, index + DETAIL_CONCURRENCY), resolved = await Promise.all(batch.map(async (model) => {
      try {
        return [model, await convexQuery("pgCatalog:modelDetail", { routeSlug: model.routeSlug })];
      } catch (error) {
        return console.warn(`detail failed for ${model.routeSlug}: ${error.message}`), [model, null];
      }
    }));
    for (let [model, detail] of resolved)
      if (detail)
        details.set(model.routeSlug, detail);
    process.stdout.write(`\rdetails: ${Math.min(index + DETAIL_CONCURRENCY, withRuns.length)}/${withRuns.length}`);
  }
  console.log();
  entries = new Map;
  for (let model of withRuns) {
    let detail = details.get(model.routeSlug);
    if (!detail)
      continue;
    let speedRuns = detail.speedRuns ?? [];
    if (speedRuns.length === 0)
      continue;
    let hfRepo = model.hfRepo ?? model.modelId;
    if (!hfRepo || !hfRepo.includes("/"))
      continue;
    let bestByEngineHardware = new Map;
    for (let run of speedRuns) {
      let engine = run.inferenceEngine;
      if (!engine)
        continue;
      let key = `${engine} ${run.hardwareKey}`, current = bestByEngineHardware.get(key), currentSingle = current ? (current.concurrency ?? 1) === 1 : !1, runSingle = (run.concurrency ?? 1) === 1;
      if (!current || runSingle && !currentSingle || runSingle === currentSingle && (decodeOf(run) ?? 0) > (decodeOf(current) ?? 0))
        bestByEngineHardware.set(key, run);
    }
    let commands = {}, testedHardware = new Map, benchmarks = [], bestDecode = null, bestPrefill = null;
    for (let [key, run] of bestByEngineHardware) {
      let [engine, hardwareKey] = key.split(" ");
      testedHardware.set(hardwareKey, hardwareTarget(hardwareKey, hardwareNames.get(hardwareKey), !0));
      let speeds = runSpeeds(run), decode = speeds.decode8k ?? speeds.decode32k;
      if (decode !== null && (bestDecode === null || decode > bestDecode))
        bestDecode = decode;
      if (speeds.prefill !== null && (bestPrefill === null || speeds.prefill > bestPrefill))
        bestPrefill = speeds.prefill;
      benchmarks.push({
        hardwareId: hardwareKey,
        engine,
        decodeTps: decode === null ? null : Math.round(decode * 10) / 10,
        decodeTps32k: speeds.decode32k === null ? null : Math.round(speeds.decode32k * 10) / 10,
        prefillTps: speeds.prefill === null ? null : Math.round(speeds.prefill * 10) / 10,
        ttftMs: null,
        contextTokens: speeds.maxContext,
        measuredAt: run.points?.[0]?.createdAt?.slice(0, 10) ?? null,
        notes: run.inferenceEngineVersion ? `${engine} ${run.inferenceEngineVersion}` : null
      });
      let { complete } = runArgv(run);
      if (!commands[engine] || complete) {
        let command = commandFor(engine, hfRepo, run);
        if (command)
          commands[engine] = command;
      }
    }
    let quant = inferQuant(model.quantization, hfRepo, benchmarks[0]?.engine ?? null), measuredSize = sizeByRepo.get(hfRepo.toLowerCase()) ?? sizeByRepo.get((model.modelId ?? "").toLowerCase()) ?? await hfRepoSizeGb(hfRepo), paramsB = paramsFromName(model.displayName ?? hfRepo), sizeGb = measuredSize ?? estimateSizeGb(paramsB, quant);
    if (!sizeGb)
      continue;
    let quality = qualityOf(detail.evalRuns);
    entries.set(hfRepo, {
      name: model.displayName ?? hfRepo.split("/").pop(),
      quant,
      filesize: `${Math.round(sizeGb)}gb`,
      filesizeGb: Math.round(sizeGb * 10) / 10,
      hardware: [...testedHardware.values()].sort((a, b) => a.minMemoryGb - b.minMemoryGb),
      commands,
      rank: 0,
      benchmarks: benchmarks.sort((a, b) => (b.decodeTps ?? 0) - (a.decodeTps ?? 0)),
      expectSpeed: {
        decodeTps: bestDecode === null ? null : Math.round(bestDecode * 10) / 10,
        prefillTps: bestPrefill === null ? null : Math.round(bestPrefill * 10) / 10,
        source: "measured"
      },
      params: paramsFromName(model.displayName ?? hfRepo) ? (model.displayName ?? hfRepo).match(/(\d+(?:\.\d+)?B(?:-A\d+(?:\.\d+)?B)?)/)?.[1] ?? null : null,
      notes: [],
      _quality: quality,
      _sizeEstimated: !measuredSize
    });
  }
  ranked = [...entries.values()], scored = ranked.filter((entry) => entry._quality !== null && entry.expectSpeed.decodeTps !== null), layers = [], pool = [...scored];
  while (pool.length > 0) {
    let layer = pool.filter((candidate) => !pool.some((other) => other !== candidate && other.expectSpeed.decodeTps >= candidate.expectSpeed.decodeTps && other._quality >= candidate._quality && (other.expectSpeed.decodeTps > candidate.expectSpeed.decodeTps || other._quality > candidate._quality)));
    layers.push(layer), pool = pool.filter((entry) => !layer.includes(entry));
  }
  layers.forEach((layer, index) => {
    for (let entry of layer)
      entry.rank = index + 1;
  });
  unscored = ranked.filter((entry) => !scored.includes(entry)).sort((a, b) => (b.expectSpeed.decodeTps ?? 0) - (a.expectSpeed.decodeTps ?? 0));
  unscored.forEach((entry) => {
    entry.rank = layers.length + 1;
  });
  output = {};
  for (let [hfRepo, entry] of [...entries.entries()].sort((a, b) => a[1].rank - b[1].rank)) {
    let { _quality, _sizeEstimated, ...clean } = entry;
    if (_quality !== null)
      clean.notes = [...clean.notes, `quality ${Math.round(_quality * 1000) / 10}% (tau2/gaia/gdpval mean)`];
    if (_sizeEstimated)
      clean.notes = [...clean.notes, "size estimated from parameter count"];
    output[hfRepo] = clean;
  }
  file = {
    version: 1,
    updated: (new Date()).toISOString().slice(0, 10),
    source: `local.ai publication ${snapshot.publicationId}`,
    models: output
  }, body = Object.entries(output).map(([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(`,
`);
  writeFileSync(OUT_PATH, `{
  "version": ${file.version},
  "updated": ${JSON.stringify(file.updated)},
  "source": ${JSON.stringify(file.source)},
  "models": {
${body}
  }
}
`);
  console.log(`wrote ${Object.keys(output).length} entries -> ${OUT_PATH}`);
  measured = [...entries.values()].filter((entry) => !entry._sizeEstimated).length;
  console.log(`sizes: ${measured} measured, ${entries.size - measured} estimated`);
});

var exports_bundle = {};
import {
  cpSync,
  existsSync as existsSync4,
  readdirSync as readdirSync3,
  mkdirSync,
  readFileSync as readFileSync5,
  realpathSync as realpathSync2,
  rmSync as rmSync2
} from "node:fs";
import path2 from "node:path";
import { spawnSync as spawnSync2 } from "node:child_process";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var packageDir, distDir, bundlePath, runtimePackages, build, lydellDir, bundle, sourceRoot;
var init_bundle = __esm(() => {
  packageDir = path2.resolve(path2.dirname(fileURLToPath2(import.meta.url)), "../../services/agent-runtime"), distDir = path2.join(packageDir, "dist"), bundlePath = path2.join(distDir, "standalone.mjs"), runtimePackages = [
    "playwright-core",
    "chromium-bidi",
    "mitt",
    "devtools-protocol",
    "@silvia-odwyer/photon-node",
    "undici",
    "@lydell/node-pty"
  ];
  rmSync2(distDir, { recursive: !0, force: !0 });
  mkdirSync(distDir, { recursive: !0 });
  build = spawnSync2("bun", [
    "build",
    "src/server.ts",
    "--target=node",
    "--external",
    "fsevents",
    "--external",
    "playwright-core",
    "--external",
    "@silvia-odwyer/photon-node",
    "--external",
    "undici",
    "--outfile=dist/standalone.mjs"
  ], { cwd: packageDir, stdio: "inherit" });
  if (build.status !== 0)
    throw Error(`Agent runtime bundle failed with status ${build.status ?? "unknown"}`);
  lydellDir = path2.join(packageDir, "node_modules", "@lydell");
  if (existsSync4(lydellDir)) {
    for (let entry of readdirSync3(lydellDir))
      if (entry.startsWith("node-pty-"))
        runtimePackages.push(`@lydell/${entry}`);
  }
  for (let packageName of runtimePackages) {
    let segments = packageName.split("/"), source = path2.join(packageDir, "node_modules", ...segments), destination = path2.join(distDir, "node_modules", ...segments);
    if (!existsSync4(path2.join(source, "package.json")))
      throw Error(`Missing browser runtime package: ${packageName}`);
    mkdirSync(path2.dirname(destination), { recursive: !0 }), cpSync(source, destination, { recursive: !0 });
  }
  bundle = readFileSync5(bundlePath, "utf8"), sourceRoot = realpathSync2(path2.join(packageDir, "..", ".."));
  if (bundle.includes(sourceRoot))
    throw Error(`Agent runtime bundle contains the build-machine root: ${sourceRoot}`);
  console.log(`Packaged portable browser runtime: ${runtimePackages.join(", ")}`);
});

var exports_check_conventional_commits = {};
import { execFileSync as execFileSync2 } from "node:child_process";
import { readFileSync as readFileSync6 } from "node:fs";
var allowedTypes, ignoredSubjects, args, messageFileIndex, rangeIndex, fail = (message) => {
  console.error(message), process.exitCode = 1;
}, validateSubject = (subject, label) => {
  if (!subject.trim()) {
    fail(`${label}: empty commit subject`);
    return;
  }
  if (ignoredSubjects.some((pattern) => pattern.test(subject)))
    return;
  let match = /^(?<type>[a-z]+)(?:\([a-z0-9._/-]+\))?(?<breaking>!)?: (?<summary>.+)$/.exec(subject);
  if (!match?.groups) {
    fail(`${label}: "${subject}" must follow "type(scope): summary"`);
    return;
  }
  let { type, summary } = match.groups;
  if (!allowedTypes.has(type))
    fail(`${label}: "${type}" is not an allowed commit type`);
  if (summary.length < 8)
    fail(`${label}: summary must be at least 8 characters`);
  if (/^[A-Z]/.test(summary))
    fail(`${label}: summary should start lowercase`);
  if (/[.]$/.test(summary))
    fail(`${label}: summary should not end with a period`);
};
var init_check_conventional_commits = __esm(() => {
  allowedTypes = new Set([
