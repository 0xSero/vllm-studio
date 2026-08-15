import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { browserHost, type KeyInput, type MouseInput } from "../browser-host/browser-host";
import {
  BrowserOperationCoordinator,
  type BrowserOperationContext,
  type BrowserOperationCoordinatorOptions,
  type BrowserOperationRunOptions,
} from "../browser-host/browser-operation-coordinator";
import { browserNetworkPolicy, type BrowserNavigation } from "../browser-host/network-policy";
import { fetchReadable } from "../browser-host/reader";

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

let lastFallback: BrowserNavigation | null = null;

export function createBrowserOperationQueue(
  options: BrowserOperationCoordinatorOptions = {
    recover: () => browserHost.invalidate(),
  },
) {
  const coordinator = new BrowserOperationCoordinator(options);
  return <A>(
    runOptions: BrowserOperationRunOptions,
    operation: (context: BrowserOperationContext) => Promise<A>,
  ): Promise<A> => coordinator.run(runOptions, operation);
}

const runBrowserOperation = createBrowserOperationQueue();

type VerbResult = { ok: boolean; data?: unknown; error?: string };

export async function handleBrowserVerb(request: Request, verb: string): Promise<Response> {
  if (!ALLOWED_VERBS.has(verb)) {
    return Response.json({ ok: false, error: `Unknown browser verb: ${verb}` }, { status: 400 });
  }
  const payload = await readPayload(request);
  try {
    const result = await runBrowserOperation({ kind: "verb", signal: request.signal }, (context) =>
      dispatchVerb(verb, payload, context),
    );
    return Response.json(result);
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Browser command failed",
    });
  }
}

async function readPayload(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as Record<string, unknown> | null;
    if (body && typeof body === "object") {
      const { sessionId: _sessionId, ...rest } = body;
      return rest;
    }
  } catch {}
  return {};
}

async function dispatchVerb(
  verb: string,
  payload: Record<string, unknown>,
  context: BrowserOperationContext,
): Promise<VerbResult> {
  if (!browserHost.isAvailable()) return fallbackVerb(verb, payload, context);
  try {
    return await runHostVerb(verb, payload, context);
  } catch (error) {
    if (["navigate", "get-url", "get-text", "get-html"].includes(verb)) {
      return fallbackVerb(verb, payload, context);
    }
    throw error;
  }
}

async function runHostVerb(
  verb: string,
  payload: Record<string, unknown>,
  context: BrowserOperationContext,
): Promise<VerbResult> {
  switch (verb) {
    case "navigate":
      return navigateVerb(payload, context);
    case "get-url": {
      const data = await browserHost.getUrl();
      publishFallback(data.url, context);
      return { ok: true, data };
    }
    case "get-text": {
      const text = await browserHost.getText();
      context.assertActive();
      return { ok: true, data: { text } };
    }
    case "get-html": {
      const html = await browserHost.getHtml();
      context.assertActive();
      return { ok: true, data: { html } };
    }
    case "screenshot": {
      const dataUri = await browserHost.screenshot();
      context.assertActive();
      return { ok: true, data: { dataUri } };
    }
    case "click": {
      const result = await browserHost.click({ selector: requireSelector(payload) });
      context.assertActive();
      return selectorVerb(result);
    }
    case "fill": {
      const result = await browserHost.fill({
        selector: requireSelector(payload),
        value: String(payload.value ?? ""),
      });
      context.assertActive();
      return selectorVerb(result);
    }
    case "scroll":
      return scrollVerb(payload, context);
    case "back": {
      await browserHost.goBack();
      const data = await browserHost.getState();
      publishFallback(data.url, context);
      return { ok: true, data };
    }
    case "forward": {
      await browserHost.goForward();
      const data = await browserHost.getState();
      publishFallback(data.url, context);
      return { ok: true, data };
    }
    case "reload": {
      await browserHost.reload();
      const data = await browserHost.getState();
      publishFallback(data.url, context);
      return { ok: true, data };
    }
    default:
      return { ok: false, error: `Unsupported browser verb: ${verb}` };
  }
}

async function navigateVerb(
  payload: Record<string, unknown>,
  context: BrowserOperationContext,
): Promise<VerbResult> {
  const navigation = browserNetworkPolicy.navigation(String(payload.url ?? ""));
  if (!navigation) return { ok: false, error: "valid public or localhost http(s) url required" };
  const result = await browserHost.navigate(navigation.url);
  publishFallback(result.url, context);
  return { ok: true, data: result };
}

async function scrollVerb(
  payload: Record<string, unknown>,
  context: BrowserOperationContext,
): Promise<VerbResult> {
  const deltaY = Number(payload.deltaY ?? 0);
  const result = await browserHost.scroll({ deltaY: Number.isFinite(deltaY) ? deltaY : 0 });
  context.assertActive();
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

function publishFallback(url: string, context: BrowserOperationContext): BrowserNavigation | null {
  const navigation = browserNetworkPolicy.navigation(url);
  context.assertActive();
  lastFallback = navigation;
  return navigation;
}

async function fallbackVerb(
  verb: string,
  payload: Record<string, unknown>,
  context: BrowserOperationContext,
): Promise<VerbResult> {
  if (verb === "navigate") {
    const navigation = browserNetworkPolicy.navigation(String(payload.url ?? ""));
    if (!navigation) return { ok: false, error: "valid public or localhost http(s) url required" };
    const reader = await fetchReadable(navigation.url, navigation.mode, context.signal);
    const finalNavigation = publishFallback(reader.url, context);
    if (!finalNavigation) throw new Error("Browser network policy blocked final reader URL");
    return {
      ok: true,
      data: { url: finalNavigation.url, title: reader.title, readingMode: true },
    };
  }
  if (verb === "get-url") {
    context.assertActive();
    return { ok: true, data: { url: lastFallback?.url ?? "", title: "" } };
  }
  if (verb === "get-text" || verb === "get-html") {
    const navigation = browserNetworkPolicy.navigation(String(payload.url ?? "")) ?? lastFallback;
    if (!navigation) return { ok: false, error: UNAVAILABLE_ERROR };
    const reader = await fetchReadable(navigation.url, navigation.mode, context.signal);
    const finalNavigation = publishFallback(reader.url, context);
    if (!finalNavigation) throw new Error("Browser network policy blocked final reader URL");
    return verb === "get-text"
      ? { ok: true, data: { text: reader.text, readingMode: true } }
      : { ok: true, data: { html: reader.markdown ?? reader.text, readingMode: true } };
  }
  return { ok: false, error: UNAVAILABLE_ERROR };
}

export async function handleBrowserFetch(request: Request): Promise<Response> {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) return Response.json({ error: "url is required" }, { status: 400 });
  try {
    const result = await fetchReadable(raw, "public", request.signal);
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fetch failed";
    const status = message.startsWith("url rejected") ? 400 : 502;
    return Response.json({ error: message }, { status });
  }
}

export async function handleBrowserFrame(request: Request): Promise<Response> {
  try {
    return await runBrowserOperation({ kind: "frame", signal: request.signal }, async (context) => {
      if (!browserHost.isAvailable()) return fallbackFrame(UNAVAILABLE_ERROR, 503);
      try {
        const { frame, state } = await browserHost.pollFrame();
        publishFallback(state.url, context);
        return Response.json({
          ok: true,
          data: {
            frame: frame?.data ?? null,
            url: state.url,
            title: state.title,
            canGoBack: state.canGoBack,
            canGoForward: state.canGoForward,
          },
        });
      } catch (error) {
        return fallbackFrame(error instanceof Error ? error.message : "frame poll failed");
      }
    });
  } catch (error) {
    return fallbackFrame(error instanceof Error ? error.message : "frame poll failed");
  }
}

function fallbackFrame(error: string, status = 502): Response {
  return Response.json(
    {
      ok: false,
      error,
      data: {
        frame: null,
        url: lastFallback?.url ?? "",
        title: "",
        canGoBack: false,
        canGoForward: false,
      },
    },
    { status },
  );
}

type InputBody =
  | ({ kind: "mouse" } & Omit<MouseInput, "type"> & { type: MouseInput["type"] })
  | ({ kind: "wheel" } & Omit<MouseInput, "type">)
  | ({ kind: "key" } & KeyInput);

export async function handleBrowserInput(request: Request): Promise<Response> {
  if (!browserHost.isAvailable()) {
    return Response.json({ ok: false, error: "Browser unavailable" }, { status: 503 });
  }
  let body: InputBody;
  try {
    body = (await request.json()) as InputBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  try {
    await runBrowserOperation({ kind: "input", signal: request.signal }, async (context) => {
      await dispatchInput(body);
      context.assertActive();
    });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "input dispatch failed",
    });
  }
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
const HTML_ENTITY_REPLACEMENTS: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
};

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
  const lower = html.toLowerCase();
  const start = lower.indexOf("<title");
  if (start < 0) return "";
  const openEnd = html.indexOf(">", start + 6);
  if (openEnd < 0) return "";
  const closeStart = lower.indexOf("</title", openEnd + 1);
  if (closeStart < 0) return "";
  return html
    .slice(openEnd + 1, closeStart)
    .trim()
    .replace(/&(amp|lt|gt|quot|#39);/g, (match, entity: string) =>
      HTML_ENTITY_REPLACEMENTS[entity] ?? match,
    );
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

export async function handleBrowserState(request: Request): Promise<Response> {
  if (!browserHost.isAvailable()) {
    return Response.json({ ok: false, error: "Browser unavailable" }, { status: 503 });
  }
  try {
    const data = await runBrowserOperation(
      { kind: "state", signal: request.signal },
      async (context) => {
        const state = await browserHost.peekState();
        if (state) publishFallback(state.url, context);
        else context.assertActive();
        return state;
      },
    );
    return Response.json({ ok: true, data });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "getState failed",
    });
  }
}

export async function handleBrowserViewport(request: Request): Promise<Response> {
  if (!browserHost.isAvailable()) {
    return Response.json({ ok: false, error: "Browser unavailable" }, { status: 503 });
  }
  let body: { width?: unknown; height?: unknown };
  try {
    body = (await request.json()) as { width?: unknown; height?: unknown };
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const width = Number(body.width);
  const height = Number(body.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return Response.json({ ok: false, error: "width and height are required" }, { status: 400 });
  }
  try {
    await runBrowserOperation({ kind: "viewport", signal: request.signal }, async (context) => {
      await browserHost.setViewport(width, height);
      context.assertActive();
    });
    return Response.json({
      ok: true,
      data: { width: Math.round(width), height: Math.round(height) },
    });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "setViewport failed",
    });
  }
}
