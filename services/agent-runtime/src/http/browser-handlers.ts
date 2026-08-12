import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sanitizeBrowserPaneUrl } from "../../../../shared/agent/sanitize-embedded-browser-url";
import { browserHost, type KeyInput, type MouseInput } from "../browser-host/browser-host";
import { fetchReadable } from "../browser-host/reader";
import { errorMessage, jsonError, jsonTask, readJsonBody } from "./helpers";

const ALLOWED_VERBS = new Set([
  "navigate",
  "get-url",
  "get-text",
  "get-html",
  "screenshot",
  "click",
  "scroll",
  "fill",
  "back",
  "forward",
  "reload",
]);

const UNAVAILABLE_ERROR = "Browser unavailable: no Chromium found — set LOCAL_STUDIO_CHROME_PATH";

let lastFallbackUrl = "";

type VerbResult = { ok: boolean; data?: unknown; error?: string };

const browserError = (error: string, status = 200): Response =>
  Response.json({ ok: false, error }, { status });

const browserFailure = (fallback: string, status = 200) => ({
  fallback,
  project: (error: unknown) => browserError(errorMessage(error, fallback), status),
});

export async function handleBrowserVerb(request: Request, verb: string): Promise<Response> {
  if (!ALLOWED_VERBS.has(verb)) {
    return browserError(`Unknown browser verb: ${verb}`, 400);
  }
  const payload = await readPayload(request);
  return jsonTask(() => dispatchVerb(verb, payload), (result) => result, browserFailure("Browser command failed"));
}

async function readPayload(request: Request): Promise<Record<string, unknown>> {
  const body = await readJsonBody(request);
  if (!body) return {};
  const { sessionId: _sessionId, ...rest } = body;
  return rest;
}

async function dispatchVerb(verb: string, payload: Record<string, unknown>): Promise<VerbResult> {
  if (!browserHost.isAvailable()) return fallbackVerb(verb, payload);
  try {
    return await runHostVerb(verb, payload);
  } catch (error) {
    if (verb === "navigate" || verb === "get-text") return fallbackVerb(verb, payload);
    throw error;
  }
}

async function runHostVerb(verb: string, payload: Record<string, unknown>): Promise<VerbResult> {
  switch (verb) {
    case "navigate":
      return navigateVerb(payload);
    case "get-url":
      return { ok: true, data: await browserHost.getUrl() };
    case "get-text":
      return { ok: true, data: { text: await browserHost.getText() } };
    case "get-html":
      return { ok: true, data: { html: await browserHost.getHtml() } };
    case "screenshot":
      return { ok: true, data: { dataUri: await browserHost.screenshot() } };
    case "click":
      return selectorVerb(await browserHost.click({ selector: requireSelector(payload) }));
    case "fill":
      return selectorVerb(
        await browserHost.fill({
          selector: requireSelector(payload),
          value: String(payload.value ?? ""),
        }),
      );
    case "scroll":
      return scrollVerb(payload);
    case "back":
      await browserHost.goBack();
      return { ok: true, data: await browserHost.getState() };
    case "forward":
      await browserHost.goForward();
      return { ok: true, data: await browserHost.getState() };
    case "reload":
      await browserHost.reload();
      return { ok: true, data: await browserHost.getState() };
    default:
      return { ok: false, error: `Unsupported browser verb: ${verb}` };
  }
}

async function navigateVerb(payload: Record<string, unknown>): Promise<VerbResult> {
  const url = sanitizeBrowserPaneUrl(String(payload.url ?? ""));
  if (!url) return { ok: false, error: "valid public or localhost http(s) url required" };
  const result = await browserHost.navigate(url);
  return { ok: true, data: result };
}

async function scrollVerb(payload: Record<string, unknown>): Promise<VerbResult> {
  const deltaY = Number(payload.deltaY ?? 0);
  const result = await browserHost.scroll({ deltaY: Number.isFinite(deltaY) ? deltaY : 0 });
  return { ok: true, data: { deltaY: result.deltaY, scrollY: result.scrollY } };
}

function selectorVerb(result: { found: boolean }): VerbResult {
  return {
    ok: result.found,
    data: { found: result.found },
    ...(result.found ? {} : { error: "selector not found" }),
  };
}

function requireSelector(payload: Record<string, unknown>): string {
  const selector = String(payload.selector ?? "");
  if (!selector) throw new Error("selector required");
  return selector;
}

async function fallbackVerb(verb: string, payload: Record<string, unknown>): Promise<VerbResult> {
  if (verb === "navigate") {
    const url = sanitizeBrowserPaneUrl(String(payload.url ?? ""));
    if (!url) return { ok: false, error: "valid public or localhost http(s) url required" };
    const reader = await fetchReadable(url);
    lastFallbackUrl = reader.url;
    return { ok: true, data: { url: reader.url, title: reader.title, readingMode: true } };
  }
  if (verb === "get-url") {
    return { ok: true, data: { url: lastFallbackUrl, title: "" } };
  }
  if (verb === "get-text" || verb === "get-html") {
    const url = sanitizeBrowserPaneUrl(String(payload.url ?? "")) || lastFallbackUrl;
    if (!url) return { ok: false, error: UNAVAILABLE_ERROR };
    const reader = await fetchReadable(url);
    lastFallbackUrl = reader.url;
    return verb === "get-text"
      ? { ok: true, data: { text: reader.text, readingMode: true } }
      : { ok: true, data: { html: reader.markdown ?? reader.text, readingMode: true } };
  }
  return { ok: false, error: UNAVAILABLE_ERROR };
}

export async function handleBrowserFetch(request: Request): Promise<Response> {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) return jsonError("url is required");
  return jsonTask(() => fetchReadable(raw), (result) => result, {
    fallback: "Fetch failed",
    status: (error) => errorMessage(error, "Fetch failed").startsWith("url rejected") ? 400 : 502,
  });
}

export async function handleBrowserFrame(): Promise<Response> {
  if (!browserHost.isAvailable()) {
    return browserError(UNAVAILABLE_ERROR, 503);
  }
  return jsonTask(
    () => browserHost.pollFrame(),
    ({ frame, state }) => ({
      ok: true,
      data: {
        frame: frame?.data ?? null,
        url: state.url,
        title: state.title,
        canGoBack: state.canGoBack,
        canGoForward: state.canGoForward,
      },
    }),
    browserFailure("frame poll failed"),
  );
}

type InputBody =
  | ({ kind: "mouse" } & Omit<MouseInput, "type"> & { type: MouseInput["type"] })
  | ({ kind: "wheel" } & Omit<MouseInput, "type">)
  | ({ kind: "key" } & KeyInput);

export async function handleBrowserInput(request: Request): Promise<Response> {
  if (!browserHost.isAvailable()) {
    return browserError("Browser unavailable", 503);
  }
  const body = await readJsonBody(request);
  if (!body) return browserError("Invalid JSON", 400);
  return jsonTask(
    () => dispatchInput(body as InputBody),
    () => ({ ok: true }),
    browserFailure("input dispatch failed"),
  );
}

async function dispatchInput(body: InputBody): Promise<void> {
  if (body.kind === "key") {
    await browserHost.dispatchKey({
      type: body.type,
      key: body.key,
      code: body.code,
    });
    return;
  }
  if (body.kind === "wheel") {
    await browserHost.dispatchMouse({
      type: "wheel",
      x: Number(body.x) || 0,
      y: Number(body.y) || 0,
      deltaX: body.deltaX,
      deltaY: body.deltaY,
    });
    return;
  }
  await browserHost.dispatchMouse({
    type: body.type,
    x: Number(body.x) || 0,
    y: Number(body.y) || 0,
    button: body.button,
    clickCount: body.clickCount,
  });
}

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 650;
const LSOF_TIMEOUT_MS = 2_500;
const MAX_CANDIDATES = 48;
const FALLBACK_PORTS = [3000, 3001, 3002, 3017, 4173, 5173, 5174, 8000, 8080, 8317, 1234];

type PortCandidate = {
  port: number;
  process?: string;
};

type LocalhostSite = {
  port: number;
  url: string;
  displayUrl: string;
  title: string;
  process?: string;
  current?: boolean;
};

function parseCurrentPort(request: Request): number | null {
  const host = request.headers.get("host") ?? "";
  const match = host.match(/:(\d+)$/);
  const port = match ? Number(match[1]) : NaN;
  return Number.isFinite(port) ? port : null;
}

function titleFromHtml(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  return title
    ? title
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
    : "";
}

function parseLsof(stdout: string): PortCandidate[] {
  const byPort = new Map<number, PortCandidate>();
  for (const line of stdout.split(/\r?\n/).slice(1)) {
    const listenMatch = line.match(/:(\d+)\s+\(LISTEN\)/);
    if (!listenMatch) continue;
    const port = Number(listenMatch[1]);
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) continue;
    const processName = line.trim().split(/\s+/)[0];
    if (!byPort.has(port)) byPort.set(port, { port, process: processName });
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port).slice(0, MAX_CANDIDATES);
}

async function listListeningPorts(): Promise<PortCandidate[]> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], {
      timeout: LSOF_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    const ports = parseLsof(stdout);
    if (ports.length > 0) return ports;
  } catch {}
  return FALLBACK_PORTS.map((port) => ({ port }));
}

async function probePort(
  candidate: PortCandidate,
  currentPort: number | null,
): Promise<LocalhostSite | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const url = `http://127.0.0.1:${candidate.port}`;
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8" },
      redirect: "follow",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? "";
    let title = "";
    if (contentType.includes("text/html")) {
      title = titleFromHtml((await response.text()).slice(0, 64_000));
    }
    const displayUrl = `localhost:${candidate.port}`;
    return {
      port: candidate.port,
      url: `http://${displayUrl}`,
      displayUrl,
      title: title || displayUrl,
      process: candidate.process,
      current: candidate.port === currentPort,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function handleBrowserLocalhosts(request: Request): Promise<Response> {
  const currentPort = parseCurrentPort(request);
  const candidates = await listListeningPorts();
  const probed = await Promise.all(
    candidates.map((candidate) => probePort(candidate, currentPort)),
  );
  const sites = probed
    .filter((site): site is LocalhostSite => Boolean(site))
    .sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      return a.port - b.port;
    });
  return Response.json({ sites });
}

export async function handleBrowserState(): Promise<Response> {
  if (!browserHost.isAvailable()) {
    return browserError("Browser unavailable", 503);
  }
  return jsonTask(
    () => browserHost.peekState(),
    (data) => ({ ok: true, data }),
    browserFailure("getState failed"),
  );
}

export async function handleBrowserViewport(request: Request): Promise<Response> {
  if (!browserHost.isAvailable()) {
    return browserError("Browser unavailable", 503);
  }
  const body = await readJsonBody(request);
  if (!body) return browserError("Invalid JSON", 400);
  const width = Number(body.width);
  const height = Number(body.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return browserError("width and height are required", 400);
  }
  return jsonTask(
    () => browserHost.setViewport(width, height),
    () => ({ ok: true, data: { width: Math.round(width), height: Math.round(height) } }),
    browserFailure("setViewport failed"),
  );
}
