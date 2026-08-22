import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sanitizeBrowserPaneUrl } from "../../../../shared/agent/sanitize-embedded-browser-url";
import {
  browserHost,
  normalizeBrowserSessionKey,
  type KeyInput,
  type MouseInput,
} from "../browser-host/browser-host";
import {
  explicitBinaryOverride,
  isBrowserEngineId,
  listBrowserEngines,
  readEnginePreference,
  resolveBrowserEngine,
  writeEnginePreference,
} from "../browser-host/browser-engines";
import { browserHistory } from "../browser-host/browser-history";
import { playwrightManager } from "../browser-host/playwright";
import { fetchReadable } from "../browser-host/reader";
import { errorMessage } from "./helpers";

// The reason the engine could not be resolved, phrased for whoever has to fix
// it — a missing LOCAL_STUDIO_CHROME_PATH binary reads differently from "no
// browser installed", and the old single string blamed the wrong dial.
function unavailableError(): string {
  try {
    resolveBrowserEngine();
    return "Browser unavailable";
  } catch (error) {
    return errorMessage(error, "Browser unavailable");
  }
}

let lastFallbackUrl = "";

type VerbResult = { ok: boolean; data?: unknown; error?: string };

/**
 * One verb invocation: the verb, its payload, the browser session it is scoped
 * to, and the request's abort signal.
 */
type VerbCall = {
  verb: string;
  payload: Record<string, unknown>;
  session: string | undefined;
  signal: AbortSignal | undefined;
};

export async function handleBrowserVerb(request: Request, verb: string): Promise<Response> {
  if (!Object.hasOwn(HOST_VERBS, verb)) {
    return Response.json({ ok: false, error: `Unknown browser verb: ${verb}` }, { status: 400 });
  }
  try {
    const call = { verb, ...(await readPayload(request)), signal: request.signal };
    return Response.json(await dispatchVerb(call));
  } catch (error) {
    return browserFailure(error, "Browser command failed");
  }
}

async function readPayload(
  request: Request,
): Promise<{ payload: Record<string, unknown>; session: string | undefined }> {
  try {
    const body = (await request.json()) as Record<string, unknown> | null;
    if (body && typeof body === "object") {
      // sessionId scopes the verb to its agent session's isolated browser
      // context; verbs without one (the panel's) follow the active session.
      const { sessionId, ...rest } = body;
      return { payload: rest, session: normalizeBrowserSessionKey(sessionId) ?? undefined };
    }
  } catch {
    // empty body is fine
  }
  return { payload: {}, session: undefined };
}

// Every verb — model-issued or panel-issued, both arrive here — lands in the
// history ring before the result goes back out.
async function dispatchVerb(call: VerbCall): Promise<VerbResult> {
  try {
    const result = await runVerb(call);
    const data = (result.data ?? {}) as { url?: unknown; title?: unknown };
    browserHistory.record({
      action: call.verb,
      url: typeof data.url === "string" ? data.url : undefined,
      title: typeof data.title === "string" ? data.title : undefined,
      detail: historyDetail(call),
      ok: result.ok,
      error: result.error,
    });
    return result;
  } catch (error) {
    browserHistory.record({
      action: call.verb,
      detail: historyDetail(call),
      ok: false,
      error: errorMessage(error, String(error)),
    });
    throw error;
  }
}

async function runVerb(call: VerbCall): Promise<VerbResult> {
  if (!browserHost.isAvailable()) return fallbackVerb(call);
  const run = HOST_VERBS[call.verb];
  if (!run) return { ok: false, error: `Unsupported browser verb: ${call.verb}` };
  try {
    return await run(call);
  } catch (error) {
    // A launch/connection failure for the reading verbs still degrades to
    // reading mode rather than failing the tool call outright.
    if (call.verb === "navigate" || call.verb === "get-text") return fallbackVerb(call);
    throw error;
  }
}

function historyDetail({ verb, payload }: VerbCall): string | undefined {
  if (verb === "navigate") return String(payload.url ?? "") || undefined;
  if (verb === "click") return String(payload.selector ?? "") || undefined;
  if (verb === "fill") return `${String(payload.selector ?? "")} = ${String(payload.value ?? "")}`;
  if (verb === "scroll") return `deltaY ${Number(payload.deltaY ?? 0)}`;
  return undefined;
}

/** The verb vocabulary: what a POST /api/agent/browser/:verb may ask for. */
const done = (data: unknown): VerbResult => ({ ok: true, data });

const HOST_VERBS: Record<string, (call: VerbCall) => Promise<VerbResult>> = {
  navigate: navigateVerb,
  "get-url": async ({ session }) => done(await browserHost.getUrl(session)),
  "get-text": async ({ session }) => done({ text: await browserHost.getText(session) }),
  "get-html": async ({ session }) => done({ html: await browserHost.getHtml(session) }),
  screenshot: async ({ session }) => done({ dataUri: await browserHost.screenshot(session) }),
  click: async ({ payload, session }) =>
    selectorVerb(await browserHost.click({ selector: requireSelector(payload) }, session)),
  fill: async ({ payload, session }) =>
    selectorVerb(
      await browserHost.fill(
        { selector: requireSelector(payload), value: String(payload.value ?? "") },
        session,
      ),
    ),
  scroll: async ({ payload, session }) => {
    const deltaY = Number(payload.deltaY ?? 0);
    const scrolled = await browserHost.scroll(
      { deltaY: Number.isFinite(deltaY) ? deltaY : 0 },
      session,
    );
    return done({ deltaY: scrolled.deltaY, scrollY: scrolled.scrollY });
  },
  // The history-moving verbs all answer with the state they landed on.
  back: ({ session }) => stateAfter(browserHost.goBack(session), session),
  forward: ({ session }) => stateAfter(browserHost.goForward(session), session),
  reload: ({ session }) => stateAfter(browserHost.reload(session), session),
};

async function stateAfter(action: Promise<unknown>, session: string | undefined) {
  await action;
  return done(await browserHost.getState(session));
}

async function navigateVerb({ payload, session }: VerbCall): Promise<VerbResult> {
  // Pane rules: public web plus loopback (previewing local dev servers is the
  // pane's main job); other private ranges stay blocked. The same policy is
  // re-applied — with DNS pinning — to every request the page then makes; see
  // browser-host/network-policy.ts.
  const url = sanitizeBrowserPaneUrl(String(payload.url ?? ""));
  if (!url) return { ok: false, error: "valid public or localhost http(s) url required" };
  return done(await browserHost.navigate(url, session));
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

// Chromium-unavailable fallbacks. navigate/get-url/get-text/get-html degrade to
// reading mode (remembering the last navigated URL per process so reads work
// without a url arg); every other verb returns the clear unavailable error. The
// fallback honors pane rules (public + loopback) so local dev servers stay
// previewable even when there's no headless Chromium to drive a full surface.
async function fallbackVerb({ verb, payload, signal }: VerbCall): Promise<VerbResult> {
  if (verb === "navigate") {
    const url = sanitizeBrowserPaneUrl(String(payload.url ?? ""));
    if (!url) return { ok: false, error: "valid public or localhost http(s) url required" };
    const reader = await fetchReadable(url, signal);
    lastFallbackUrl = reader.url;
    return done({ url: reader.url, title: reader.title, readingMode: true });
  }
  if (verb === "get-url") return done({ url: lastFallbackUrl, title: "" });
  if (verb === "get-text" || verb === "get-html") {
    const url = sanitizeBrowserPaneUrl(String(payload.url ?? "")) || lastFallbackUrl;
    if (!url) return { ok: false, error: unavailableError() };
    const reader = await fetchReadable(url, signal);
    lastFallbackUrl = reader.url;
    return done(
      verb === "get-text"
        ? { text: reader.text, readingMode: true }
        : { html: reader.markdown ?? reader.text, readingMode: true },
    );
  }
  return { ok: false, error: unavailableError() };
}

/**
 * The panel routes all answer `{ ok, ... }`: a 503 with the reason when there is
 * no Chromium to drive, the run's own body on success, and a 200 `{ ok:false }`
 * for a failure inside the host. `unavailable` stays a thunk because resolving
 * the engine touches the filesystem and the frame poll runs at ~10fps.
 */
async function browserJson(
  unavailable: () => string,
  fallback: string,
  run: () => Promise<Response | Record<string, unknown>>,
): Promise<Response> {
  if (!browserHost.isAvailable()) {
    return Response.json({ ok: false, error: unavailable() }, { status: 503 });
  }
  try {
    const result = await run();
    return result instanceof Response ? result : Response.json({ ok: true, ...result });
  } catch (error) {
    return browserFailure(error, fallback);
  }
}

const browserUnavailable = () => "Browser unavailable";

/** Parse a panel body, distinguishing "no valid JSON" from a falsy payload. */
async function readJson<T>(request: Request): Promise<{ value: T } | null> {
  try {
    return { value: (await request.json()) as T };
  } catch {
    return null;
  }
}

const invalidJson = () => Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });

/** A host failure the panel renders inline: `{ ok:false }` with a 200. */
const browserFailure = (error: unknown, fallback: string) =>
  Response.json({ ok: false, error: errorMessage(error, fallback) });

export async function handleBrowserFetch(request: Request): Promise<Response> {
  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) return Response.json({ error: "url is required" }, { status: 400 });
  try {
    const result = await fetchReadable(raw, request.signal);
    return Response.json(result);
  } catch (error) {
    const message = errorMessage(error, "Fetch failed");
    // Only the initial url-rejection is a client error (400); resolved-host,
    // redirect, and upstream failures are bad-gateway (502) like before.
    const status = message.startsWith("url rejected") ? 400 : 502;
    return Response.json({ error: message }, { status });
  }
}

// ─── GET /api/agent/browser/frame ─────────────────────────────────────────
//
// Frame poll for the visible browser panel (~10fps JSON poll instead of SSE:
// Next's standalone server buffers locally-built event streams, and polling
// survives buffering proxies for remote deploys).

export function handleBrowserFrame(): Promise<Response> {
  return browserJson(unavailableError, "frame poll failed", async () => {
    const { frame, state } = await browserHost.pollFrame();
    return {
      data: {
        frame: frame?.data ?? null,
        url: state.url,
        title: state.title,
        canGoBack: state.canGoBack,
        canGoForward: state.canGoForward,
      },
    };
  });
}

type InputBody =
  | ({ kind: "mouse" } & Omit<MouseInput, "type"> & { type: MouseInput["type"] })
  | ({ kind: "wheel" } & Omit<MouseInput, "type">)
  | ({ kind: "key" } & KeyInput);

export function handleBrowserInput(request: Request): Promise<Response> {
  return browserJson(browserUnavailable, "input dispatch failed", async () => {
    const body = await readJson<InputBody>(request);
    if (!body) return invalidJson();
    await dispatchInput(body.value);
    return {};
  });
}

async function dispatchInput(body: InputBody): Promise<void> {
  if (body.kind === "key") {
    await browserHost.dispatchKey({ type: body.type, key: body.key, code: body.code });
    return;
  }
  const at = { x: Number(body.x) || 0, y: Number(body.y) || 0 };
  await browserHost.dispatchMouse(
    body.kind === "wheel"
      ? { type: "wheel", ...at, deltaX: body.deltaX, deltaY: body.deltaY }
      : { type: body.type, ...at, button: body.button, clickCount: body.clickCount },
  );
}

// ─── GET /api/agent/browser/localhosts ────────────────────────────────────
//
// Discovers locally listening HTTP dev servers for the browser panel's
// localhost picker.

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 650;
const LSOF_TIMEOUT_MS = 2_500;
const MAX_CANDIDATES = 48;
const FALLBACK_PORTS = [3000, 3001, 3002, 3017, 4173, 5173, 5174, 8000, 8080, 8317, 1234];

type PortCandidate = {
  port: number;
  process?: string;
};

function parseCurrentPort(request: Request): number | null {
  const host = request.headers.get("host") ?? "";
  const match = host.match(/:(\d+)$/);
  const port = match ? Number(match[1]) : NaN;
  return Number.isFinite(port) ? port : null;
}

const HTML_ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&amp;": "&",
};

function titleFromHtml(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  // One pass, so a decoded "&" is never re-read as the start of an entity —
  // sequentially, "&amp;lt;" would round-trip into a phantom "<".
  return (
    title?.replace(/&(?:lt|gt|quot|#39|amp);/g, (entity) => HTML_ENTITIES[entity] ?? entity) ?? ""
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
  } catch {
    // Fall through to common dev-server ports.
  }
  return FALLBACK_PORTS.map((port) => ({ port }));
}

async function probePort(candidate: PortCandidate, currentPort: number | null) {
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
    .flatMap((site) => site ?? [])
    .sort((a, b) => (a.current === b.current ? a.port - b.port : a.current ? -1 : 1));
  return Response.json({ sites });
}

// ─── GET /api/agent/browser/state ─────────────────────────────────────────

export function handleBrowserState(): Promise<Response> {
  return browserJson(browserUnavailable, "getState failed", async () => ({
    data: await browserHost.peekState(),
  }));
}

// ─── POST /api/agent/browser/viewport ─────────────────────────────────────
//
// Sets the headless Chromium viewport so it matches the visible panel's
// dimensions. Body: { width, height }.

export function handleBrowserViewport(request: Request): Promise<Response> {
  return browserJson(browserUnavailable, "setViewport failed", async () => {
    const body = await readJson<{ width?: unknown; height?: unknown }>(request);
    if (!body) return invalidJson();
    const width = Number(body.value.width);
    const height = Number(body.value.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return Response.json({ ok: false, error: "width and height are required" }, { status: 400 });
    }
    await browserHost.setViewport(width, height);
    return { data: { width: Math.round(width), height: Math.round(height) } };
  });
}

// ─── GET /api/agent/browser/history ───────────────────────────────────────
//
// The computer-use log: every browser action this runtime performed, model- or
// panel-driven. `?limit=` bounds the reply; `?visited=1` collapses it to the
// distinct pages in visit order.

export async function handleBrowserHistory(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const limit = Number(params.get("limit") ?? 50);
  const visitedOnly = params.get("visited") === "1";
  return Response.json({
    ok: true,
    data: visitedOnly
      ? { visited: browserHistory.visitedUrls(limit) }
      : { entries: browserHistory.list(limit) },
  });
}

// ─── GET /api/agent/browser/engines · POST /api/agent/browser/engine ──────
//
// Which Chromium-family binary the embedded browser drives. GET reports what is
// installed and what is running; POST persists a choice and drops the live
// context so the next action relaunches on the new engine.

function enginesPayload() {
  const preference = readEnginePreference();
  const engines = listBrowserEngines();
  const active = playwrightManager.activeEngine();
  const chosen = engines.find((engine) => engine.id === preference);
  return {
    preference,
    // True when the user picked a browser that is not installed here, so the UI
    // can say "Brave not found — running Chromium" instead of quietly lying.
    preferenceUnavailable: preference !== "auto" && !chosen?.path,
    override: explicitBinaryOverride(),
    active: active
      ? { id: active.id, label: active.label, path: active.path, source: active.source }
      : null,
    unavailableReason: active ? null : unavailableError(),
    engines,
  };
}

export function handleBrowserEngines(): Response {
  return Response.json({ ok: true, data: enginesPayload() });
}

export async function handleBrowserEngineSelect(request: Request): Promise<Response> {
  const body = await readJson<{ engine?: unknown }>(request);
  if (!body) return invalidJson();
  if (!isBrowserEngineId(body.value.engine)) {
    return Response.json({ ok: false, error: "unknown browser engine" }, { status: 400 });
  }
  try {
    writeEnginePreference(body.value.engine);
  } catch (error) {
    return browserFailure(error, "failed to save browser engine");
  }
  // The running context is bound to the old binary; the next verb relaunches.
  browserHost.stop();
  return Response.json({ ok: true, data: enginesPayload() });
}
