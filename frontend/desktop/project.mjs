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
    "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/data/amazon-bedrock.json",
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
    "--minify",
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
var allowedTypes, ignoredSubjects, args, messageFileIndex, rangeIndex, excludedRefIndex, fail = (message) => {
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
    "style"
  ]), ignoredSubjects = [
    /^Merge /,
    /^Revert /,
    /^Initial commit$/,
    /^dependabot\//
  ], args = process.argv.slice(2), messageFileIndex = args.indexOf("--message-file"), rangeIndex = args.indexOf("--range"), excludedRefIndex = args.indexOf("--exclude");
  if (messageFileIndex !== -1) {
    let messageFile = args[messageFileIndex + 1], subject = readFileSync6(messageFile, "utf8").split(/\r?\n/, 1)[0] ?? "";
    validateSubject(subject, "commit message");
  } else {
    let range = rangeIndex === -1 ? args[0] : args[rangeIndex + 1];
    if (!range)
      fail("Usage: check-conventional-commits.mjs --message-file <path> | --range <base..head>");
    else {
      let excludedRef = excludedRefIndex === -1 ? void 0 : args[excludedRefIndex + 1], logArgs = excludedRef ? ["log", "--format=%s", range, "--not", excludedRef] : ["log", "--format=%s", range], output2 = execFileSync2("git", logArgs, { encoding: "utf8" }).trim();
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

import path from "node:path";
function resolveResourcesDir(appOutDir, productFilename, electronPlatformName) {
  if (electronPlatformName === "darwin" || electronPlatformName === "mas")
    return path.join(appOutDir, `${productFilename}.app`, "Contents", "Resources");
  return path.join(appOutDir, "resources");
}
async function afterPack(context) {
  let { appOutDir, packager, electronPlatformName } = context, productFilename = packager.appInfo.productFilename, resourcesDir = resolveResourcesDir(appOutDir, productFilename, electronPlatformName), standaloneBase = path.join(resourcesDir, "app", "frontend", ".next", "standalone"), candidates = [
    path.join(standaloneBase, "frontend", "server.js"),
    path.join(standaloneBase, "server.js")
  ], standaloneServer = candidates.find((candidate) => existsSync(candidate));
  let appArchive = path.join(resourcesDir, "app.asar"), appArchiveBytes = statSync(appArchive).size;
  if (appArchiveBytes > 5 * 1024 * 1024)
    throw Error(`Packaged app.asar is unexpectedly large: ${appArchiveBytes} bytes`);
  if (!standaloneServer)
    throw Error([
      "Packaged app is missing the embedded Next standalone server — refusing to sign/ship a broken bundle.",
      `Looked for: ${candidates.join(" or ")}`,
      `electron-builder failed to copy extraResources from .next/standalone (it can log "file source doesn't exist" yet still exit 0).`,
      "Re-run the build (run `npm run build` first if .next/standalone is absent)."
    ].join(`
  `));
  let standaloneRoot = path.dirname(standaloneServer), missingRuntimeFile = [
    path.join(standaloneRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js"),
    path.join(standaloneRoot, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "@earendil-works", "pi-ai", "package.json"),
    path.join(standaloneRoot, "node_modules", "@earendil-works", "pi-coding-agent", "node_modules", "@earendil-works", "pi-ai", "dist", "providers", "data", "amazon-bedrock.json")
  ].find((file) => !existsSync(file));
  if (missingRuntimeFile)
    throw Error(`Packaged app is missing a Pi runtime dependency: ${missingRuntimeFile}`);
  let agentRuntimeRoot = path.join(resourcesDir, "app", "agent-runtime"), agentRuntime = path.join(agentRuntimeRoot, "standalone.mjs"), missingAgentRuntimeFile = [
    agentRuntime,
    path.join(agentRuntimeRoot, "node_modules", "playwright-core", "package.json"),
    path.join(agentRuntimeRoot, "node_modules", "chromium-bidi", "package.json"),
    path.join(agentRuntimeRoot, "node_modules", "chromium-bidi", "node_modules", "zod", "package.json"),
    path.join(agentRuntimeRoot, "node_modules", "mitt", "package.json"),
    path.join(agentRuntimeRoot, "node_modules", "devtools-protocol", "package.json"),
    path.join(agentRuntimeRoot, "node_modules", "@silvia-odwyer", "photon-node", "package.json"),
    path.join(agentRuntimeRoot, "node_modules", "undici", "package.json")
  ].find((file) => !existsSync(file));
  if (missingAgentRuntimeFile)
    throw Error(`Packaged app is missing an agent runtime dependency: ${missingAgentRuntimeFile}`);
  let desktopRuntimeRoot = path.join(resourcesDir, "desktop-runtime", "node_modules", "@lydell"), missingDesktopRuntimeFile = [
    path.join(desktopRuntimeRoot, "node-pty", "package.json"),
    path.join(desktopRuntimeRoot, `node-pty-${process.platform}-${process.arch}`, "package.json")
  ].find((file) => !existsSync(file));
  if (missingDesktopRuntimeFile)
    throw Error(`Packaged app is missing a desktop runtime dependency: ${missingDesktopRuntimeFile}`);
  let unwantedRuntimeFile = [standaloneBase, agentRuntimeRoot].flatMap((directory) => readdirSync10(directory, { recursive: !0, withFileTypes: !0 }).filter((entry) => entry.isFile() && /\.(?:map|[cm]?ts)$/.test(entry.name)).map((entry) => path.join(entry.parentPath, entry.name)))[0];
  if (unwantedRuntimeFile)
    throw Error(`Packaged app contains a non-runtime source artifact: ${unwantedRuntimeFile}`);
  let agentRuntimeSource = readFileSync(agentRuntime, "utf8");
  if (/["'](?:[A-Za-z]:\\|\/(?:Users|home|root)\/)[^"'\n]*node_modules[\\/]/.test(agentRuntimeSource))
    throw Error("Packaged agent runtime contains a build-machine dependency path");
  if (electronPlatformName === "darwin") {
    let helperExecutable = path.join(path.dirname(resourcesDir), "Frameworks", `${productFilename} Helper.app`, "Contents", "MacOS", `${productFilename} Helper`);
    if (!existsSync(helperExecutable))
      throw Error(`Packaged app is missing its Pi helper executable: ${helperExecutable}`);
  }
  let packagedPiCli = path.join(resourcesDir, "app", "frontend", ".next", "standalone", "frontend", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
  if (!existsSync(packagedPiCli))
    throw Error(`Packaged app is missing its Pi CLI: ${packagedPiCli}`);
  console.log(`  afterPack: embedded frontend and agent runtime present, app.asar ${appArchiveBytes} bytes (${electronPlatformName})`);
}

var project_entry_default = afterPack, root5 = path11.resolve(path11.dirname(fileURLToPath11(import.meta.url)), "../.."), commands = new Map([
  ["assert-release-main", () => Promise.resolve().then(() => (init_assert_release_main(), exports_assert_release_main))],
  ["assert-standalone", () => Promise.resolve().then(() => (init_assert_standalone_build(), exports_assert_standalone_build))],
  ["browser-perf", () => init_browser_perf_audit().then(() => exports_browser_perf_audit)],
  ["bundle-agent-runtime", () => Promise.resolve().then(() => (init_bundle(), exports_bundle))],
  ["check-commits", () => Promise.resolve().then(() => (init_check_conventional_commits(), exports_check_conventional_commits))],
  ["complete-standalone", () => Promise.resolve().then(() => (init_complete_standalone_build(), exports_complete_standalone_build))],
  ["controller-standards", () => Promise.resolve().then(() => (init_controller_standards_audit(), exports_controller_standards_audit))],
  ["doctor", async () => doctor()],
  ["link-services", () => Promise.resolve().then(() => (init_link_services_node_modules(), exports_link_services_node_modules))],
  ["perf", () => init_perf_audit().then(() => exports_perf_audit)],
  ["postbuild-agent-runtime", () => Promise.resolve().then(() => (init_postbuild(), exports_postbuild))],
  ["prepare-agent-runtime", async () => rmSync6(path11.join(root5, "services", "agent-runtime", "dist"), { recursive: !0, force: !0 })],
  ["prepare-next", () => Promise.resolve().then(() => (init_prepare_next_build(), exports_prepare_next_build))],
  ["release-notes", () => Promise.resolve().then(() => (init_release_statement(), exports_release_statement))],
  ["setup", async () => setupRepository()],
  ["sign-release", () => init_sign_desktop_release().then(() => exports_sign_desktop_release)],
  ["stage-release", () => Promise.resolve().then(() => (init_stage_desktop_release(), exports_stage_desktop_release))],
  ["start", () => init_start_standalone().then(() => exports_start_standalone)],
  ["validate-contracts", () => Promise.resolve().then(() => (init_validate_shared_contracts(), exports_validate_shared_contracts))],
  ["validate-package", () => Promise.resolve().then(() => (init_validate_package_json(), exports_validate_package_json))],
  ["validate-structure", () => Promise.resolve().then(() => (init_validate_barrel_dir_siblings(), exports_validate_barrel_dir_siblings))],
  ["validate-ui", () => Promise.resolve().then(() => (init_validate_ui_structure(), exports_validate_ui_structure))],
  ["audit-layout", async () => auditLayout()]
]);
function parsedVersion(value) {
  let match = value.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : null;
}
function versionMeetsMinimum(actual, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index])
      return true;
    if (actual[index] < minimum[index])
      return false;
  }
  return true;
}
function requireTool(label, command, args3, minimum) {
  let result = spawnSync4(command, args3, { cwd: root5, encoding: "utf8" });
  if (result.error || result.status !== 0)
    throw Error(`${label} is required but unavailable`);
  let output4 = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(), actual = parsedVersion(output4);
  if (!actual || !versionMeetsMinimum(actual, minimum))
    throw Error(`${label} ${minimum.join(".")} or newer is required; found ${output4 || "unknown"}`);
  console.log(`${label}: ${actual.join(".")}`);
}
function doctor() {
  requireTool("Node.js", process.execPath, ["--version"], [22, 19, 0]);
  requireTool("npm", "npm", ["--version"], [10, 0, 0]);
  requireTool("Bun", "bun", ["--version"], [1, 3, 14]);
  requireTool("Python", "python3", ["--version"], [3, 10, 0]);
  requireTool("Git", "git", ["--version"], [2, 0, 0]);
  console.log("Toolchain check passed");
}
function setupRepository() {
  doctor();
  for (let directory of ["controller", "shared", "services/agent-runtime"])
    run3("bun", ["install", "--frozen-lockfile"], path11.join(root5, directory));
  run3("npm", ["ci", "--legacy-peer-deps"], path11.join(root5, "frontend"));
  console.log("Repository setup complete");
}
function auditLayout() {
  let expected = ["frontend/desktop/project.mjs", "scripts/install-controller.sh", "scripts/install-desktop-app.sh"], actual = readdirSync10(path11.join(root5, "scripts"), { withFileTypes: !0 }).filter((entry) => entry.isFile()).map((entry) => `scripts/${entry.name}`).sort(), executable = git(["ls-files", "-s"]).split("\n").filter((line) => line.startsWith("100755 ")).map((line) => line.split("\t")[1]).sort(), stale = ["frontend/scripts", "controller/scripts", "services/agent-runtime/scripts"].filter((directory) => existsSync(path11.join(root5, directory)));
  if (JSON.stringify(actual) !== JSON.stringify(expected.slice(1)) || JSON.stringify(executable) !== JSON.stringify(expected) || stale.length > 0)
    throw Error(`Automation layout drifted: scripts=${actual.join(",")}; executable=${executable.join(",")}; stale=${stale.join(",")}`);
  console.log("Automation layout passed: exactly three scripts");
}
function git(args3, options = {}) {
  return execFileSync6("git", args3, { cwd: root5, encoding: "utf8", ...options }).trim();
}
function run3(command, args3, cwd = root5) {
  let result = spawnSync4(command, args3, { cwd, stdio: "inherit" });
  if (result.error)
    throw result.error;
  if (result.status !== 0)
    process.exit(result.status ?? 1);
}
function stagedFiles() {
  let output4 = git(["diff", "--cached", "--name-only"]);
  return output4 ? output4.split(`
`) : [];
}
function isMergeInProgress() {
  try {
    return Boolean(git(["rev-parse", "-q", "--verify", "MERGE_HEAD"]));
  } catch {
    return !1;
  }
}
function preCommit() {
  let branch = git(["branch", "--show-current"]);
  if (["main", "dev"].includes(branch))
    throw Error(`pre-commit: commits on ${branch} are blocked; use a work branch and PR`);
  let files = stagedFiles(), activeFiles = files.filter((file2) => existsSync(path11.join(root5, file2))), lines = git(["diff", "--cached", "--numstat"]).split(`
`).reduce((total, row) => {
    let [added, removed, file2] = row.split("\t");
    if (!/^\d+$/.test(added ?? "") || !/^\d+$/.test(removed ?? ""))
      return total;
    if (["frontend/desktop/project.mjs", "scripts/project.mjs"].includes(file2 ?? "") || !existsSync(path11.join(root5, file2 ?? "")) || /(^|\/)(package-lock\.json|bun\.lockb?|.*\.snap)$/.test(file2 ?? ""))
      return total;
    return total + Number(added) + Number(removed);
  }, 0);
  if (!isMergeInProgress() && (activeFiles.length > 15 || lines > 600))
    throw Error(`pre-commit: staged change is too large (${activeFiles.length} files, ${lines} source lines); limit is 15 files and 600 source lines`);
  if (activeFiles.some((file2) => /^(frontend|shared)\//.test(file2)))
    run3("npm", ["run", "precommit"], path11.join(root5, "frontend"));
  if (activeFiles.some((file2) => file2.startsWith("controller/")))
    run3("bun", ["run", "typecheck"], path11.join(root5, "controller"));
}
function prePush() {
  let remote = process.argv[2], url = process.argv[3], updates = readFileSync17(0, "utf8").trim();
  for (let update of updates ? updates.split(`
`) : []) {
    let [localRef, localSha, remoteRef, remoteSha] = update.trim().split(/\s+/);
    if (["refs/heads/main", "refs/heads/dev"].includes(remoteRef))
      throw Error(`pre-push: direct pushes to ${remoteRef} are blocked; merge through GitHub`);
    if (/^0{40}$/.test(localSha))
      continue;
    let defaultRef, excludedRef, range2;
    try {
      defaultRef = git(["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`]);
    } catch {
      defaultRef = `${remote}/main`;
    }
    excludedRef = defaultRef;
    try {
      let devRef = `${remote}/dev`;
      git(["rev-parse", "--verify", "--quiet", devRef]);
      git(["merge-base", "--is-ancestor", devRef, localSha]);
      excludedRef = devRef;
    } catch {
    }
    if (/^0{40}$/.test(remoteSha)) {
      try {
        range2 = `${git(["merge-base", defaultRef, localSha])}..${localSha}`;
      } catch {
        range2 = localSha;
      }
    } else
      range2 = `${remoteSha}..${localSha}`;
    let checkArgs = [path11.join(root5, "scripts/project.mjs"), "check-commits", "--range", range2];
    try {
      git(["rev-parse", "--verify", "--quiet", excludedRef]), checkArgs.push("--exclude", excludedRef);
    } catch {
    }
    console.log(`Checking conventional commits for ${localRef} -> ${remote}/${remoteRef} (${url})`), run3(process.execPath, checkArgs);
  }
  run3("npm", ["run", "check:static"], path11.join(root5, "frontend")), run3("npm", ["run", "check:cleanup"], path11.join(root5, "frontend")), run3(process.execPath, [path11.join(root5, "scripts/project.mjs"), "assert-standalone"]);
}
function setupHooks() {
  let worktree = spawnSync4("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root5, encoding: "utf8" });
  if (worktree.status !== 0 || worktree.stdout.trim() !== "true")
    return console.log("Skipping Git hook setup outside a worktree");
  git(["rev-parse", "--git-dir"]), git(["config", "core.hooksPath", ".githooks"]);
  for (let name of readdirSync10(path11.join(root5, ".githooks")))
    chmodSync2(path11.join(root5, ".githooks", name), 493);
}
var invoked = path11.basename(process.argv[1] ?? "");
if (invoked === "commit-msg")
  process.argv.splice(2, 0, "--message-file"), await Promise.resolve().then(() => (init_check_conventional_commits(), exports_check_conventional_commits));
else if (invoked === "pre-commit")
  preCommit();
} else if (invoked === "pre-push") {
  const { prePush } = await import("./automation/hooks.mjs");
  prePush();
} else if (
  invoked === "project.mjs" ||
  path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)
) {
  const command = process.argv[2];
  process.argv.splice(2, 1);
  if (command === "setup-hooks") {
    const { setupHooks } = await import("./automation/toolchain.mjs");
    setupHooks();
  } else if (!command || !commands.has(command)) {
    console.error(`Usage: node scripts/project.mjs <${[...commands.keys()].join("|")}>`);
    process.exit(1);
  } else {
    await commands.get(command)();
  }
}

export default afterPack;
