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
    "build",
    "chore",
    "ci",
    "docs",
    "feat",
    "fix",
    "micro",
    "perf",
    "refactor",
    "release",
    "revert",
    "style",
    "test"
  ]), ignoredSubjects = [
    /^Merge /,
    /^Revert /,
    /^Initial commit$/,
    /^dependabot\//
  ], args = process.argv.slice(2), messageFileIndex = args.indexOf("--message-file"), rangeIndex = args.indexOf("--range");
  if (messageFileIndex !== -1) {
    let messageFile = args[messageFileIndex + 1], subject = readFileSync6(messageFile, "utf8").split(/\r?\n/, 1)[0] ?? "";
    validateSubject(subject, "commit message");
  } else {
    let range = rangeIndex === -1 ? args[0] : args[rangeIndex + 1];
    if (!range)
      fail("Usage: check-conventional-commits.mjs --message-file <path> | --range <base..head>");
    else {
      let output2 = execFileSync2("git", ["log", "--format=%s", range], { encoding: "utf8" }).trim();
      (output2 ? output2.split(/\r?\n/) : []).forEach((subject, index) => validateSubject(subject, `commit ${index + 1}`));
    }
  }
  if (process.exitCode)
    console.error(`
Allowed types: ` + [...allowedTypes].join(", "));
});

var exports_complete_standalone_build = {};
import {
  cpSync as cpSync2,
  existsSync as existsSync5,
  lstatSync as lstatSync2,
  readdirSync as readdirSync4,
  readFileSync as readFileSync7,
  rmdirSync,
  rmSync as rmSync3,
  statSync as statSync2,
  symlinkSync,
  unlinkSync
} from "node:fs";
import { dirname as dirname2, relative as relative3, resolve as resolve2 } from "node:path";
function isRuntimeFile2(file2) {
  let path3 = relative3(standaloneBase2, file2).replaceAll("\\", "/");
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
  ].some((prefix) => path3 === prefix || path3.startsWith(prefix));
}
function filesUnder2(directory) {
  return readdirSync4(directory, { recursive: !0, withFileTypes: !0 }).filter((entry) => entry.isFile()).map((entry) => resolve2(entry.parentPath, entry.name));
}
function isVerifiedCopy(file2, repoRelativePath) {
  let source = resolve2(repoRoot, repoRelativePath);
  if (!existsSync5(source))
    return !1;
  let sourceStat = statSync2(source), copyStat = statSync2(file2);
  if (!sourceStat.isFile() || sourceStat.size !== copyStat.size)
    return !1;
  if (!(repoRelativePath === "data" || /(^|\/)data\//.test(repoRelativePath)))
    return !0;
  return readFileSync7(source).equals(readFileSync7(file2));
}
function removeEmptyDirectories(directory) {
  for (let entry of readdirSync4(directory, { withFileTypes: !0 }))
    if (entry.isDirectory())
      removeEmptyDirectories(resolve2(directory, entry.name));
  if (directory !== standaloneBase2 && readdirSync4(directory).length === 0)
    rmdirSync(directory);
}
var projectRoot2, repoRoot, standaloneBase2, standaloneRoots, standaloneRoot, runtimeDependencyPaths, tracedPiPackageDirectory, unverified, pruned = 0;
var init_complete_standalone_build = __esm(() => {
  projectRoot2 = resolve2(import.meta.dirname, ".."), repoRoot = resolve2(projectRoot2, ".."), standaloneBase2 = resolve2(projectRoot2, ".next", "standalone"), standaloneRoots = [resolve2(standaloneBase2, "frontend"), standaloneBase2], standaloneRoot = standaloneRoots.find((root) => existsSync5(resolve2(root, "server.js")));
  if (!standaloneRoot)
    throw Error(`Missing standalone server under: ${standaloneBase2}`);
  runtimeDependencyPaths = [
    "node_modules/typebox",
    "node_modules/@earendil-works/pi-coding-agent"
  ];
  for (let dependencyPath of runtimeDependencyPaths) {
    let source = resolve2(projectRoot2, dependencyPath);
    if (!existsSync5(source))
      throw Error(`Missing runtime dependency source: ${dependencyPath}`);
    let destination = resolve2(standaloneRoot, dependencyPath);
    cpSync2(source, destination, { recursive: !0 });
    let executableShimDirectories = readdirSync4(destination, {
      recursive: !0,
      withFileTypes: !0
    }).filter((entry) => entry.isDirectory() && entry.name === ".bin").map((entry) => resolve2(entry.parentPath, entry.name));
    for (let directory of executableShimDirectories)
      rmSync3(directory, { recursive: !0, force: !0 });
  }
  tracedPiPackageDirectory = resolve2(standaloneRoot, ".next/node_modules/@earendil-works");
  if (existsSync5(tracedPiPackageDirectory)) {
    let packageTargets = new Map([
      [
        "pi-ai-",
        resolve2(standaloneRoot, "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai")
      ],
      ["pi-coding-agent-", resolve2(standaloneRoot, "node_modules/@earendil-works/pi-coding-agent")]
    ]);
    for (let entry of readdirSync4(tracedPiPackageDirectory)) {
      let target = [...packageTargets].find(([prefix]) => entry.startsWith(prefix))?.[1];
      if (!target)
        continue;
      let link = resolve2(tracedPiPackageDirectory, entry);
      if (!lstatSync2(link).isSymbolicLink())
        throw Error(`Expected traced Pi package alias to be a symlink: ${link}`);
      unlinkSync(link), symlinkSync(relative3(dirname2(link), target), link, "dir");
    }
  }
  unverified = [];
  for (let file2 of filesUnder2(standaloneBase2)) {
    if (isRuntimeFile2(file2))
      continue;
    let repoRelativePath = relative3(standaloneBase2, file2).replaceAll("\\", "/");
    if (!isVerifiedCopy(file2, repoRelativePath)) {
      unverified.push(repoRelativePath);
      continue;
    }
    unlinkSync(file2), pruned += 1;
  }
  if (unverified.length > 0)
    throw Error(`Standalone output contains non-runtime files with no matching repo source; refusing to prune them (move them aside manually if expected):
${unverified.join(`
`)}`);
  removeEmptyDirectories(standaloneBase2);
  console.log(`  standalone repaired: +${runtimeDependencyPaths.length} runtime dependency trees, -${pruned} traced non-runtime files`);
});

var exports_controller_standards_audit = {};
import fs from "node:fs";
import { createRequire as createRequire2 } from "node:module";
import path3 from "node:path";
function addSourceFinding(rule, filePath, node, detail) {
  let sourceFile = node.getSourceFile(), { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  findings.push({
    level: "error",
    rule,
    path: filePath,
    detail: `${line + 1}:${character + 1} ${detail}`
  });
}
function identifierText(node) {
  return ts.isIdentifier(node) ? node.text : null;
}
function isEffectCompositionCatch(node) {
  return ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "catch" && ["Effect", "Stream"].includes(identifierText(node.expression.expression) ?? "");
}
function isInsideEffectTryPromise(node) {
  let parent = node.parent;
  while (parent) {
    if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression) && identifierText(parent.expression.expression) === "Effect" && parent.expression.name.text === "tryPromise")
      return !0;
    parent = parent.parent;
  }
  return !1;
}
function scanEffectStandards(filePath) {
  if (!filePath.endsWith(".ts") || filePath.endsWith(".d.ts"))
    return;
  let source = fs.readFileSync(filePath, "utf8"), sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, !0), relativePath = path3.relative(SRC_DIR, filePath), isRuntimeBoundary = runtimeBoundaryFiles.has(relativePath), visit = (node) => {
    if (ts.canHaveModifiers(node)) {
      if (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) && !isInsideEffectTryPromise(node))
        addSourceFinding("effect-async-boundary", filePath, node, "Use Effect for controller async work");
    }
    if (!isRuntimeBoundary && ts.isTypeReferenceNode(node) && ["Promise", "PromiseLike"].includes(identifierText(node.typeName) ?? ""))
      addSourceFinding("effect-promise-type", filePath, node, "Promise types are restricted to runtime adapters");
    if (!isRuntimeBoundary && ts.isNewExpression(node) && identifierText(node.expression) === "Promise")
      addSourceFinding("effect-promise-constructor", filePath, node, "Use Effect.async or Effect.callback");
    if (ts.isIdentifier(node) && ["AsyncLock", "AsyncQueue"].includes(node.text))
      addSourceFinding("effect-legacy-concurrency", filePath, node, "Use Effect concurrency primitives");
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression) && identifierText(node.expression.expression) === "ManagedRuntime" && node.expression.name.text === "make")
        managedRuntimeCount += 1;
      if (!isRuntimeBoundary && ts.isPropertyAccessExpression(node.expression) && ["runPromise", "runPromiseExit", "runSync", "runFork"].includes(node.expression.name.text) && (identifierText(node.expression.expression) === "Effect" || /runtime/i.test(node.expression.expression.getText(sourceFile))))
        addSourceFinding("effect-runner-boundary", filePath, node, "Effect runners are restricted to runtime adapters");
      if (!isRuntimeBoundary && ts.isPropertyAccessExpression(node.expression) && ["then", "finally"].includes(node.expression.name.text))
        addSourceFinding("effect-promise-chain", filePath, node, "Use Effect composition");
      if (!isRuntimeBoundary && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "catch" && !isEffectCompositionCatch(node))
        addSourceFinding("effect-promise-catch", filePath, node, "Use Effect.catch or Effect.catchTag");
      if (!isRuntimeBoundary && ts.isPropertyAccessExpression(node.expression) && identifierText(node.expression.expression) === "Promise")
        addSourceFinding("effect-promise-static", filePath, node, "Use Effect concurrency and coordination APIs");
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}
function scanDirectory(dir) {
  let entries2 = fs.readdirSync(dir, { withFileTypes: !0 }), directFiles = entries2.filter((entry) => entry.isFile()), directDirectories = entries2.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !STRUCTURE_COUNT_EXCLUDED_DIRS.has(entry.name));
  if (stats.directories += 1, stats.files += directFiles.length, directFiles.length > MAX_FILES_PER_DIR)
    findings.push({
      level: "error",
      rule: "directory-file-limit",
      path: dir,
      detail: `${directFiles.length} files (limit ${MAX_FILES_PER_DIR})`
    });
  if (dir !== modulesRoot && directDirectories.length > MAX_SUBDIRS_PER_DIR)
    findings.push({
      level: "error",
      rule: "directory-subdir-limit",
      path: dir,
      detail: `${directDirectories.length} subdirectories (limit ${MAX_SUBDIRS_PER_DIR})`
    });
  for (let entry of entries2) {
    let fullPath = path3.join(dir, entry.name);
    if (entry.name.startsWith("."))
      continue;
    if (entry.isDirectory() && !kebabCase.test(entry.name))
      findings.push({
        level: "warning",
        rule: "kebab-case",
        path: fullPath,
        detail: `Name "${entry.name}" is not kebab-case`
      });
    if (entry.isDirectory())
      scanDirectory(fullPath);
    else if (entry.isFile())
      scanEffectStandards(fullPath);
  }
}
function printSummary() {
  let errors = findings.filter((f) => f.level === "error"), warnings = findings.filter((f) => f.level === "warning");
  console.log("=== Controller Standards Audit ==="), console.log(`Directories scanned: ${stats.directories}`), console.log(`Direct file entries scanned: ${stats.files}`), console.log(`Errors: ${errors.length}`), console.log(`Warnings: ${warnings.length}`), console.log("");
  let sortedFindings = findings.sort((a, b) => {
    if (a.level !== b.level)
      return a.level === "error" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
  for (let finding of sortedFindings) {
    let emoji = finding.level === "error" ? "[ERR]" : "[WARN]";
    console.log(`${emoji} ${finding.rule} | ${finding.path}`), console.log(`      ${finding.detail}`);
  }
}
function run() {
  if (!fs.existsSync(SRC_DIR))
    return console.error("ERROR: src directory not found"), 1;
  if (scanDirectory(SRC_DIR), managedRuntimeCount !== 1)
    findings.push({
      level: "error",
      rule: "effect-single-runtime",
      path: SRC_DIR,
      detail: `${managedRuntimeCount} ManagedRuntime.make calls (expected exactly 1)`
    });
  return printSummary(), findings.some((finding) => finding.level === "error") ? 1 : 0;
}
var require2, ts, SRC_DIR, MAX_FILES_PER_DIR, MAX_SUBDIRS_PER_DIR, STRUCTURE_COUNT_EXCLUDED_DIRS, findings, stats, modulesRoot, runtimeBoundaryFiles, managedRuntimeCount = 0, kebabCase;
var init_controller_standards_audit = __esm(() => {
  require2 = createRequire2(path3.resolve(process.cwd(), "package.json")), ts = require2("typescript"), SRC_DIR = path3.resolve(process.cwd(), "src"), MAX_FILES_PER_DIR = Number.parseInt(process.env.MAX_FILES_PER_DIR ?? "20", 10), MAX_SUBDIRS_PER_DIR = Number.parseInt(process.env.MAX_SUBDIRS_PER_DIR ?? "8", 10), STRUCTURE_COUNT_EXCLUDED_DIRS = new Set(["tests"]), findings = [], stats = {
    directories: 0,
    files: 0
  }, modulesRoot = path3.join(SRC_DIR, "modules"), runtimeBoundaryFiles = new Set(["http/bounded-body.ts", "http/effect-handler.ts", "main.ts"]), kebabCase = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;
  process.exit(run());
});

var exports_desktop_package_smoke = {};
__export(exports_desktop_package_smoke, {
  runDesktopPackageSmoke: () => runDesktopPackageSmoke
});
import { spawn as spawn2 } from "node:child_process";
import {
  existsSync as existsSync6,
  mkdtempSync as mkdtempSync2,
  mkdirSync as mkdirSync2,
  readFileSync as readFileSync8,
  rmSync as rmSync4,
  writeFileSync as writeFileSync2
} from "node:fs";
import net from "node:net";
import { createRequire as createRequire3 } from "node:module";
import os from "node:os";
import path4 from "node:path";
import process2 from "node:process";
import { fileURLToPath as fileURLToPath3 } from "node:url";
function valueAfter2(args2, name) {
  let index = args2.indexOf(name);
  return index === -1 ? void 0 : args2[index + 1];
}
function delay(ms) {
  return new Promise((resolve3) => setTimeout(resolve3, ms));
}
async function reservePort() {
  let server = net.createServer();
  await new Promise((resolve3, reject) => {
    server.once("error", reject), server.listen(0, "127.0.0.1", resolve3);
  });
  let address = server.address(), port = typeof address === "object" && address ? address.port : 0;
  if (await new Promise((resolve3, reject) => server.close((error) => error ? reject(error) : resolve3())), !port)
    throw Error("Could not reserve a debugging port");
  return port;
}
async function waitForFile(file2, timeoutMs) {
  let started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync6(file2)) {
      let value = readFileSync8(file2, "utf8").trim();
      if (value)
        return value;
    }
    await delay(200);
  }
  throw Error(`Timed out waiting for ${file2}`);
}
async function waitForJson(url, timeoutMs) {
  let started = Date.now(), lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      let response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok)
        return await response.json();
      lastError = Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw Error(`Timed out waiting for ${url}: ${String(lastError)}`);
}
async function postJson(url, body2) {
  let response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body2),
    signal: AbortSignal.timeout(30000)
  }), payload = await response.json();
  if (!response.ok || payload.ok !== !0)
    throw Error(`${url} failed: ${response.status} ${JSON.stringify(payload)}`);
  return payload;
}
async function waitForAgentRuntime(logFile, timeoutMs) {
  let started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync6(logFile)) {
      let url = [
        ...readFileSync8(logFile, "utf8").matchAll(/agent-runtime: (?:\[agent-runtime\] )?listening on (http:\/\/127\.0\.0\.1:\d+)/g)
      ].at(-1)?.[1];
      if (url) {
        let payload = await waitForJson(`${url}/health`, 1e4);
        return { url, payload };
      }
    }
    await delay(250);
  }
  throw Error(`Timed out waiting for agent runtime in ${logFile}`);
}
async function waitForPage(browser, origin, timeoutMs) {
  let started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (let context of browser.contexts())
      for (let page of context.pages())
        if (page.url().startsWith(origin))
          return page;
    await delay(200);
  }
  throw Error(`Timed out waiting for Electron page at ${origin}`);
}
async function smokeTerminal(page) {
  return page.evaluate(async () => {
    let bridge = globalThis.localStudioDesktop;
    if (!bridge)
      throw Error("Desktop bridge is unavailable");
    let status = await bridge.terminal.status();
    if (!status.available)
      throw Error(status.reason || "PTY is unavailable");
    let session = await bridge.terminal.open({
      cwd: "/tmp",
      cols: 80,
      rows: 24,
      ownerKey: "desktop-package-smoke"
    });
    return new Promise((resolve3, reject) => {
      let output2 = session.replay || "", timer = setTimeout(() => {
        disposeData(), disposeExit(), reject(Error(`PTY smoke timed out: ${output2}`));
      }, 1e4), finish = () => {
        if (!output2.includes("LOCAL_STUDIO_PTY_OK"))
          return;
        clearTimeout(timer), disposeData(), disposeExit(), resolve3({ available: !0, output: "LOCAL_STUDIO_PTY_OK" });
      }, disposeData = bridge.terminal.onData((id, chunk) => {
        if (id !== session.id)
          return;
        output2 += chunk, finish();
      }), disposeExit = bridge.terminal.onExit((id) => {
        if (id !== session.id)
          return;
        finish();
      });
      bridge.terminal.write(session.id, "printf 'LOCAL_STUDIO_PTY_OK\\n'; exit\\n"), finish();
    });
  });
}
async function terminate(child) {
  if (!child?.pid)
    return;
  try {
    process2.kill(-child.pid, "SIGTERM");
  } catch {}
  await Promise.race([
    child.exitCode === null && child.signalCode === null ? new Promise((resolve3) => child.once("exit", resolve3)) : Promise.resolve(),
    delay(5000)
  ]);
  try {
    process2.kill(-child.pid, "SIGKILL");
  } catch {}
}
async function runDesktopPackageSmoke(args2 = process2.argv.slice(2)) {
  let frontend = path4.resolve(path4.dirname(fileURLToPath3(import.meta.url)), ".."), requestedApp = valueAfter2(args2, "--app"), appPath = requestedApp ? path4.resolve(requestedApp) : path4.join(frontend, "dist-desktop", "mac-arm64", "Local Studio.app"), expectedVersion = valueAfter2(args2, "--expected-version"), executable = path4.join(appPath, "Contents", "MacOS", "Local Studio");
  if (!existsSync6(executable))
    throw Error(`Missing packaged executable: ${executable}`);
  let temp = mkdtempSync2(path4.join(os.tmpdir(), "local-studio-package-smoke-")), userData = path4.join(temp, "user-data"), logFile = path4.join(userData, "logs", "desktop.log"), frontendPortFile = path4.join(userData, "embedded-frontend.port"), debugPort = await reservePort(), stdout = [], stderr = [];
  mkdirSync2(userData, { recursive: !0 }), writeFileSync2(path4.join(userData, "api-settings.json"), `${JSON.stringify({
    backendUrl: "http://127.0.0.1:65534",
    apiKey: "",
    voiceUrl: "",
    voiceModel: "whisper-large-v3-turbo"
  })}
`, { mode: 384 });
  let env = { ...process2.env };
  delete env.ELECTRON_RUN_AS_NODE, Object.assign(env, {
    LOCAL_STUDIO_AGENT_CWD: temp,
    LOCAL_STUDIO_DESKTOP_APP_NAME: `Local Studio Smoke ${process2.pid}`,
    LOCAL_STUDIO_DESKTOP_DISABLE_AUTO_UPDATE: "true",
    LOCAL_STUDIO_DESKTOP_USER_DATA_DIR: userData
  });
  let child, browser;
  try {
    child = spawn2(executable, [`--remote-debugging-port=${debugPort}`], {
      cwd: temp,
      detached: !0,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    }), child.stdout.on("data", (chunk) => stdout.push(String(chunk))), child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
    let frontendPort = Number(await waitForFile(frontendPortFile, 60000));
    if (!Number.isInteger(frontendPort) || frontendPort <= 0)
      throw Error(`Invalid embedded frontend port: ${frontendPort}`);
    let origin = `http://127.0.0.1:${frontendPort}`, desktopHealth = await waitForJson(`${origin}/api/desktop-health`, 30000), agentRuntime = await waitForAgentRuntime(logFile, 30000), embeddedBrowser = await postJson(`${agentRuntime.url}/api/agent/browser/navigate`, { url: `${origin}/agent` });
    if (!String(embeddedBrowser.data?.url ?? "").startsWith(origin))
      throw Error(`Packaged browser navigated to an unexpected URL: ${JSON.stringify(embeddedBrowser)}`);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
    let page = await waitForPage(browser, origin, 30000);
    await page.waitForLoadState("domcontentloaded");
    let agentResponse = await page.goto(`${origin}/agent`, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });
    if (!agentResponse?.ok())
      throw Error(`Agent route returned ${agentResponse?.status() ?? "no response"}`);
    let runtime = await page.evaluate(async () => {
      if (!globalThis.localStudioDesktop)
        throw Error("Desktop bridge is unavailable");
      return globalThis.localStudioDesktop.getRuntime();
    });
    if (expectedVersion && runtime.appVersion !== expectedVersion)
      throw Error(`Packaged app version ${runtime.appVersion} does not match ${expectedVersion}`);
    let terminal = await smokeTerminal(page), result = {
      appPath,
      agentStatus: agentResponse.status(),
      desktopHealth,
      agentRuntime: agentRuntime.payload,
      embeddedBrowser: embeddedBrowser.data,
      runtime,
      terminal
    };
    return console.log(JSON.stringify(result, null, 2)), result;
  } catch (error) {
    let diagnostics = [
      existsSync6(logFile) ? readFileSync8(logFile, "utf8").slice(-12000) : "",
      stdout.join("").slice(-4000),
      stderr.join("").slice(-4000)
    ].filter(Boolean).join(`
`);
    throw Error(`${error instanceof Error ? error.message : String(error)}
${diagnostics}`);
  } finally {
    if (browser)
      await browser.close().catch(() => {
        return;
      });
    await terminate(child), rmSync4(temp, { recursive: !0, force: !0 });
  }
}
var require3, chromium;
var init_desktop_package_smoke = __esm(async () => {
  require3 = createRequire3(path4.resolve(path4.dirname(fileURLToPath3(import.meta.url)), "../package.json")), { chromium } = require3("playwright-core");
  await runDesktopPackageSmoke();
});

var exports_link_services_node_modules = {};
import { lstatSync as lstatSync3, mkdirSync as mkdirSync3, rmSync as rmSync5, symlinkSync as symlinkSync2 } from "node:fs";
import path5 from "node:path";
import { fileURLToPath as fileURLToPath4 } from "node:url";
var frontendDir, servicesDir, linkPath, existingEntryKind = () => {
  try {
    let stat = lstatSync3(linkPath);
    if (stat.isSymbolicLink())
      return "link";
    return stat.isDirectory() ? "directory" : "file";
  } catch {
    return "missing";
  }
}, removeExistingEntry = () => {
  rmSync5(linkPath, { recursive: !0, force: !0 });
}, createLink = () => {
  if (process.platform === "win32") {
    symlinkSync2(path5.join(frontendDir, "node_modules"), linkPath, "junction");
    return;
  }
  symlinkSync2(path5.join("..", "frontend", "node_modules"), linkPath, "dir");
}, kind;
var init_link_services_node_modules = __esm(() => {
  frontendDir = path5.resolve(path5.dirname(fileURLToPath4(import.meta.url)), ".."), servicesDir = path5.join(path5.dirname(frontendDir), "services"), linkPath = path5.join(servicesDir, "node_modules");
  mkdirSync3(servicesDir, { recursive: !0 });
  kind = existingEntryKind();
  if (kind === "directory")
    console.error(`[link-services-node-modules] ${linkPath} is a real directory; leaving it alone.`), process.exit(0);
  if (kind !== "missing")
    removeExistingEntry();
  createLink();
});

var exports_patch_pi_ai_openai_text_boundaries = {};
import { existsSync as existsSync7, readFileSync as readFileSync9, writeFileSync as writeFileSync3 } from "node:fs";
import path6 from "node:path";
import { fileURLToPath as fileURLToPath5 } from "node:url";
var frontendRoot, targetFiles, helperMarker = "function localStudioJoinTextParts", helper, injectionPoint = `function isTextContentBlock(block) {
    return block.type === "text";
}
`, helperStartMarker = "function localStudioTextPartBoundary", helperEndMarker = "function isThinkingContentBlock", originalJoin = 'const assistantText = assistantTextParts.map((part) => part.text).join("");', patchedJoin = "const assistantText = localStudioJoinTextParts(assistantTextParts);", found = 0, patched = 0;
var init_patch_pi_ai_openai_text_boundaries = __esm(() => {
  frontendRoot = path6.resolve(path6.dirname(fileURLToPath5(import.meta.url)), ".."), targetFiles = [
    path6.join(frontendRoot, "node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js"),
    path6.join(frontendRoot, "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js")
  ], helper = [
    "function localStudioTextPartBoundary(left, right) {",
    "    if (!left || !right || /\\s$/.test(left) || /^\\s/.test(right))",
    '        return "";',
    `    if (/^[-*+]$/.test(right) && /[.:;!?]["')\\]]?$/.test(left))`,
    '        return "\\n";',
    '    if (/^(?:[-*+](?:\\s+|[A-Z0-9"`*_])|\\d+[.)]\\s+)/.test(right))',
    '        return "\\n";',
    `    if (/[.!?]["')\\]\\u201d]?$/.test(left) && /^[A-Z0-9"\\u201c'\`*_]/.test(right))`,
    '        return "\\n\\n";',
    `    if (/[:;]["')\\]\\u201d]?$/.test(left) && /^(?:[-*+]|\\d+[.)]|[A-Z0-9"\\u201c'\`*_])/.test(right))`,
    '        return "\\n";',
    '    return "";',
    "}",
    "function localStudioLineEndsWithBareListMarker(text) {",
    "    return /(?:^|\\n)[ \\t]*[-*+]$/.test(text);",
    "}",
    "function localStudioJoinTextPart(left, right) {",
    "    const boundary = localStudioTextPartBoundary(left, right);",
    '    const nextRight = boundary.includes("\\n") && /^[-*+](?=\\S)/.test(right)',
    "        ? `${right.slice(0, 1)} ${right.slice(1)}`",
    "        : right;",
    '    const prefix = localStudioLineEndsWithBareListMarker(left) && /^\\S/.test(nextRight) ? " " : "";',
    "    return left + boundary + prefix + nextRight;",
    "}",
    "function localStudioJoinTextParts(parts) {",
    "    return parts",
    "        .map((part) => part.text)",
    '        .reduce((text, partText) => localStudioJoinTextPart(text, partText), "");',
    "}"
  ].join(`
`) + `
`;
  for (let file2 of targetFiles) {
    if (!existsSync7(file2))
      continue;
    found += 1;
    let source = readFileSync9(file2, "utf8"), next = source.replaceAll("vllmStudio", "localStudio");
    if (!next.includes(helperMarker)) {
      if (!next.includes(injectionPoint))
        throw Error(`Could not find pi-ai text block helper injection point in ${file2}`);
      next = next.replace(injectionPoint, `${injectionPoint}${helper}`);
    } else {
      let helperStart = next.indexOf(helperStartMarker), helperEnd = next.indexOf(helperEndMarker, helperStart);
      if (helperStart === -1 || helperEnd === -1)
        throw Error(`Could not find existing pi-ai text boundary helper block in ${file2}`);
      next = next.slice(0, helperStart) + helper + next.slice(helperEnd);
    }
    if (next.includes(originalJoin))
      next = next.replace(originalJoin, patchedJoin);
    else if (!next.includes(patchedJoin))
      throw Error(`Could not find pi-ai assistant text join in ${file2}`);
    if (next !== source)
      writeFileSync3(file2, next, "utf8"), patched += 1;
  }
  if (found === 0)
    console.warn([
      "WARNING: patch-pi-ai-openai-text-boundaries.mjs found no pi-ai openai-completions.js to patch.",
      "Checked:",
      ...targetFiles.map((file2) => `  - ${file2}`),
      "The @earendil-works/pi-ai package layout may have changed. Agent streaming may misrender",
      "assistant text (missing paragraph/list boundaries) until this patch script is updated."
    ].join(`
`));
  else if (patched > 0)
    console.log(`Patched pi-ai OpenAI assistant text boundaries in ${patched} file(s).`);
});

var exports_perf_audit = {};
import { performance } from "node:perf_hooks";
function percentile(values, ratio) {
  let index = Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1);
  return values[index] ?? 0;
}
function assetUrls(html) {
  let scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]), css = [...html.matchAll(/<link[^>]+href="([^"]+\.css[^"]*)"/g)].map((match) => match[1]);
  return [...new Set([...scripts, ...css])];
}
async function assetSize(url) {
  let absolute = new URL(url, baseUrl2).toString(), cached = assetSizeCache.get(absolute);
  if (cached !== void 0)
    return cached;
  let response = await fetch(absolute);
  if (!response.ok)
    throw Error(`Asset ${absolute} returned ${response.status}`);
  let bytes = (await response.arrayBuffer()).byteLength;
  return assetSizeCache.set(absolute, bytes), bytes;
}
async function routeResult2(route) {
  let timings = [], html = "";
  for (let index = 0;index < runs; index += 1) {
    let started = performance.now(), response = await fetch(`${baseUrl2}${route.path}`, { cache: "no-store" });
    if (html = await response.text(), !response.ok)
      throw Error(`${route.path} returned ${response.status}`);
    timings.push(performance.now() - started);
  }
  timings.sort((a, b) => a - b);
  let assets = assetUrls(html), bytes = (await Promise.all(assets.map((url) => assetSize(url)))).reduce((total, value) => total + value, 0);
  return {
    path: route.path,
    medianMs: percentile(timings, 0.5),
    p90Ms: percentile(timings, 0.9),
    assetKiB: bytes / 1024,
    scripts: [...html.matchAll(/<script[^>]+src="/g)].length,
    css: [...html.matchAll(/<link[^>]+href="[^"]+\.css[^"]*"/g)].length,
    budget: route
  };
}
function formatNumber2(value) {
  return value.toFixed(1).padStart(6, " ");
}
function violations2(result) {
  let out = [];
  if (result.medianMs > result.budget.medianMs)
    out.push(`median ${result.medianMs.toFixed(1)}ms > ${result.budget.medianMs}ms`);
  if (result.p90Ms > result.budget.p90Ms)
    out.push(`p90 ${result.p90Ms.toFixed(1)}ms > ${result.budget.p90Ms}ms`);
  if (result.assetKiB > result.budget.assetKiB)
    out.push(`assets ${result.assetKiB.toFixed(1)}KiB > ${result.budget.assetKiB}KiB`);
  return out;
}
var baseUrl2, runs, routes2, assetSizeCache, results, failures2;
var init_perf_audit = __esm(async () => {
  init_perf_routes();
  baseUrl2 = (process.env.LOCAL_STUDIO_PERF_URL || "http://127.0.0.1:3000").replace(/\/+$/, ""), runs = Math.max(3, Number.parseInt(process.env.LOCAL_STUDIO_PERF_RUNS || "8", 10)), routes2 = httpRoutes(), assetSizeCache = new Map;
  results = [];
  for (let route of routes2)
    results.push(await routeResult2(route));
  console.log(`Local Studio perf audit: ${baseUrl2} (${runs} runs per route)`);
  console.log("route            median     p90  assets scripts css");
  failures2 = [];
  for (let result of results) {
    let bad = violations2(result);
    if (console.log(`${result.path.padEnd(16)} ${formatNumber2(result.medianMs)}ms ${formatNumber2(result.p90Ms)}ms ${formatNumber2(result.assetKiB)}KiB ${String(result.scripts).padStart(7, " ")} ${String(result.css).padStart(3, " ")}`), bad.length > 0)
      failures2.push(`${result.path}: ${bad.join(", ")}`);
  }
  if (failures2.length > 0) {
    console.error("Perf budget violations:");
    for (let failure of failures2)
      console.error(`- ${failure}`);
    process.exit(1);
  }
});

var exports_postbuild = {};
import { readdirSync as readdirSync5, readFileSync as readFileSync10, statSync as statSync3, writeFileSync as writeFileSync4, existsSync as existsSync8 } from "node:fs";
import path7 from "node:path";
import { fileURLToPath as fileURLToPath6 } from "node:url";
function* jsFiles(dir) {
  for (let entry of readdirSync5(dir, { withFileTypes: !0 })) {
    let full = path7.join(dir, entry.name);
    if (entry.isDirectory())
      yield* jsFiles(full);
    else if (entry.isFile() && entry.name.endsWith(".js"))
      yield full;
  }
}
function resolveSpecifier(fromFile, spec) {
  if (/\.(js|mjs|cjs|json|node)$/.test(spec))
    return spec;
  let base = path7.resolve(path7.dirname(fromFile), spec);
  if (existsSync8(`${base}.js`))
    return `${spec}.js`;
  if (existsSync8(base) && statSync3(base).isDirectory() && existsSync8(path7.join(base, "index.js")))
    return `${spec}/index.js`;
  return spec;
}
var packageDir2, distDir2, realEntry, SPECIFIER_RE, rewrites = 0, shim = `// Generated by scripts/postbuild.mjs — stable entry for "node dist/server.js".
import "./services/agent-runtime/src/server.js";
`;
var init_postbuild = __esm(() => {
  packageDir2 = path7.resolve(path7.dirname(fileURLToPath6(import.meta.url)), "../../services/agent-runtime"), distDir2 = path7.join(packageDir2, "dist"), realEntry = path7.join(distDir2, "services", "agent-runtime", "src", "server.js");
  if (!existsSync8(realEntry))
    console.error(`[postbuild] expected tsc output missing: ${realEntry}`), process.exit(1);
  SPECIFIER_RE = /(from\s+|import\s*\(\s*|export\s+\*\s+from\s+|import\s+)("(\.{1,2}\/[^"]+)"|'(\.{1,2}\/[^']+)')/g;
  for (let file2 of jsFiles(distDir2)) {
    let source = readFileSync10(file2, "utf8"), next = source.replace(SPECIFIER_RE, (match, lead, quoted, dq, sq) => {
      let spec = dq ?? sq, fixed = resolveSpecifier(file2, spec);
      if (fixed === spec)
        return match;
      rewrites += 1;
      let quote = quoted[0];
      return `${lead}${quote}${fixed}${quote}`;
    });
    if (next !== source)
      writeFileSync4(file2, next);
  }
  writeFileSync4(path7.join(distDir2, "server.js"), shim);
  console.log(`[postbuild] rewrote ${rewrites} relative specifiers; wrote dist/server.js shim`);
});

var exports_prepare_next_build = {};
import { rmSync as rmSync6 } from "node:fs";
import { resolve as resolve3 } from "node:path";
var init_prepare_next_build = __esm(() => {
  rmSync6(resolve3(import.meta.dirname, "../.next"), { recursive: !0, force: !0 });
});

var exports_release_statement = {};
import { execFileSync as execFileSync3 } from "node:child_process";
var args2, sinceIndex, rangeIndex2, maxIndex, maxItems, range, logArgs, output2, subjects, groups, grouped, emitted = 0;
var init_release_statement = __esm(() => {
  args2 = process.argv.slice(2), sinceIndex = args2.indexOf("--since"), rangeIndex2 = args2.indexOf("--range"), maxIndex = args2.indexOf("--max"), maxItems = Number(maxIndex === -1 ? 20 : args2[maxIndex + 1]), range = rangeIndex2 === -1 ? `--since=${sinceIndex === -1 ? "1 week ago" : args2[sinceIndex + 1]}` : args2[rangeIndex2 + 1], logArgs = rangeIndex2 === -1 ? ["log", "origin/main", range, "--pretty=format:%s"] : ["log", range, "--pretty=format:%s"], output2 = execFileSync3("git", logArgs, { encoding: "utf8" }).trim(), subjects = output2 ? output2.split(/\r?\n/) : [], groups = [
    ["Features", /^(feat)(?:\(.+\))?!?: (.+)$/],
    ["Fixes", /^(fix)(?:\(.+\))?!?: (.+)$/],
    ["Performance", /^(perf)(?:\(.+\))?!?: (.+)$/],
    ["Refactors", /^(refactor)(?:\(.+\))?!?: (.+)$/],
    ["Tests", /^(test)(?:\(.+\))?!?: (.+)$/],
    ["Infrastructure", /^(build|ci|chore|release)(?:\(.+\))?!?: (.+)$/],
    ["Polish", /^(micro|style)(?:\(.+\))?!?: (.+)$/],
    ["Documentation", /^(docs)(?:\(.+\))?!?: (.+)$/]
  ], grouped = new Map(groups.map(([name]) => [name, []]));
  for (let subject of subjects)
    for (let [name, pattern] of groups) {
      let match = pattern.exec(subject);
      if (match) {
        grouped.get(name).push(match[2]);
        break;
      }
    }
  console.log(`# Release Statement
`);
  for (let [name, items] of grouped) {
    if (!items.length || emitted >= maxItems)
      continue;
    console.log(`## ${name}
`);
    for (let item of items.slice(0, maxItems - emitted))
      console.log(`- ${item}`), emitted += 1;
    console.log("");
  }
  if (emitted === 0)
    console.log("- No conventional release changes found for the selected range.");
});

var exports_install_desktop_app_test = {};
import assert from "node:assert/strict";
import { execFileSync as execFileSync4, spawnSync as spawnSync3 } from "node:child_process";
import {
  chmodSync,
  existsSync as existsSync9,
  mkdirSync as mkdirSync4,
  mkdtempSync as mkdtempSync3,
  readFileSync as readFileSync11,
  readdirSync as readdirSync6,
  rmSync as rmSync7,
  statSync as statSync4,
  writeFileSync as writeFileSync5
} from "node:fs";
import os2 from "node:os";
import path8 from "node:path";
import test from "node:test";
import { fileURLToPath as fileURLToPath7 } from "node:url";
