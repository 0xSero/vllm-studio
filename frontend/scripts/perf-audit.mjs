import { performance } from "node:perf_hooks";
import { httpRoutes } from "./perf-routes.mjs";

const baseUrl = (process.env.LOCAL_STUDIO_PERF_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const runs = Math.max(3, Number.parseInt(process.env.LOCAL_STUDIO_PERF_RUNS || "8", 10));
const routes = httpRoutes();

const assetSizeCache = new Map();

function percentile(values, ratio) {
  const index = Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1);
  return values[index] ?? 0;
}

function assetUrls(html) {
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]);
  const css = [...html.matchAll(/<link[^>]+href="([^"]+\.css[^"]*)"/g)].map((match) => match[1]);
  return [...new Set([...scripts, ...css])];
}

async function assetSize(url) {
  const absolute = new URL(url, baseUrl).toString();
  const cached = assetSizeCache.get(absolute);
  if (cached !== undefined) return cached;
  const response = await fetch(absolute);
  if (!response.ok) throw new Error(`Asset ${absolute} returned ${response.status}`);
  const bytes = (await response.arrayBuffer()).byteLength;
  assetSizeCache.set(absolute, bytes);
  return bytes;
}

async function routeResult(route) {
  const timings = [];
  let html = "";
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    const response = await fetch(`${baseUrl}${route.path}`, { cache: "no-store" });
    html = await response.text();
    if (!response.ok) throw new Error(`${route.path} returned ${response.status}`);
    timings.push(performance.now() - started);
  }
  timings.sort((a, b) => a - b);
  const assets = assetUrls(html);
  const bytes = (
    await Promise.all(assets.map((url) => assetSize(url)))
  ).reduce((total, value) => total + value, 0);
  return {
    path: route.path,
    medianMs: percentile(timings, 0.5),
    p90Ms: percentile(timings, 0.9),
    assetKiB: bytes / 1024,
    scripts: [...html.matchAll(/<script[^>]+src="/g)].length,
    css: [...html.matchAll(/<link[^>]+href="[^"]+\.css[^"]*"/g)].length,
    budget: route,
  };
}

function formatNumber(value) {
  return value.toFixed(1).padStart(6, " ");
}

function violations(result) {
  const out = [];
  if (result.medianMs > result.budget.medianMs) {
    out.push(`median ${result.medianMs.toFixed(1)}ms > ${result.budget.medianMs}ms`);
  }
  if (result.p90Ms > result.budget.p90Ms) {
    out.push(`p90 ${result.p90Ms.toFixed(1)}ms > ${result.budget.p90Ms}ms`);
  }
  if (result.assetKiB > result.budget.assetKiB) {
    out.push(`assets ${result.assetKiB.toFixed(1)}KiB > ${result.budget.assetKiB}KiB`);
  }
  return out;
}

const results = [];
for (const route of routes) {
  results.push(await routeResult(route));
}

console.log(`Local Studio perf audit: ${baseUrl} (${runs} runs per route)`);
console.log("route            median     p90  assets scripts css");
const failures = [];
for (const result of results) {
  const bad = violations(result);
  console.log(
    `${result.path.padEnd(16)} ${formatNumber(result.medianMs)}ms ${formatNumber(result.p90Ms)}ms ${formatNumber(result.assetKiB)}KiB ${String(result.scripts).padStart(7, " ")} ${String(result.css).padStart(3, " ")}`,
  );
  if (bad.length > 0) failures.push(`${result.path}: ${bad.join(", ")}`);
}

if (failures.length > 0) {
  console.error("Perf budget violations:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
