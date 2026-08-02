import { readRequestBytesWithinLimit } from "@shared/agent/agent-turn-body";

const UPSTREAM_REQUEST_HEADER_ALLOWLIST = [
  "accept",
  "content-type",
  "if-match",
  "if-none-match",
  "last-event-id",
  "x-request-id",
];
const DOWNSTREAM_RESPONSE_HEADER_ALLOWLIST = [
  "cache-control",
  "content-type",
  "etag",
  "last-modified",
  "retry-after",
  "x-request-id",
];
const DEFAULT_HARNESS_URL = "http://127.0.0.1:8771";
const DEFAULT_PROVIDER_HARNESS_URL = "http://127.0.0.1:8772";

export type HarnessTarget = "managed" | "provider";

const V1_GET_ROUTES = [
  /^routes$/,
  /^tasks$/,
  /^tasks\/current$/,
  /^tasks\/[^/]+$/,
  /^tasks\/[^/]+\/(?:events|artifacts)$/,
];
const API_GET_ROUTES = [/^modes$/, /^setup$/, /^tasks\/current$/, /^tasks\/current\/events$/];
const API_POST_ROUTES = [/^tasks$/, /^tasks\/current\/(?:stop|continue|accept)$/];

export function harnessBaseUrl(target: HarnessTarget = "managed"): string {
  const raw = (
    target === "provider"
      ? process.env.LOCAL_STUDIO_PROVIDER_HARNESS_URL
      : process.env.LOCAL_STUDIO_HARNESS_URL
  )?.trim();
  const fallback = target === "provider" ? DEFAULT_PROVIDER_HARNESS_URL : DEFAULT_HARNESS_URL;
  return (raw || fallback).replace(/\/+$/, "");
}

export function harnessToken(target: HarnessTarget = "managed"): string {
  return (
    (target === "provider"
      ? process.env.LOCAL_STUDIO_PROVIDER_HARNESS_TOKEN
      : process.env.LOCAL_STUDIO_HARNESS_TOKEN
    )?.trim() ?? ""
  );
}

export function isHarnessRouteAllowed(
  method: string,
  path: string[],
  namespace: "v1" | "api",
  target: HarnessTarget,
): boolean {
  const route = path.join("/");
  const normalizedMethod = method.toUpperCase();
  if (namespace === "v1") {
    return normalizedMethod === "GET"
      ? V1_GET_ROUTES.some((pattern) => pattern.test(route))
      : normalizedMethod === "POST" && route === "tasks";
  }
  if (normalizedMethod === "GET") {
    return API_GET_ROUTES.some((pattern) => pattern.test(route));
  }
  if (normalizedMethod !== "POST") return false;
  if (API_POST_ROUTES.some((pattern) => pattern.test(route))) return true;
  return target === "provider" && /^(?:setup|setup\/test)$/.test(route);
}

export function upstreamRequestHeaders(requestHeaders: Headers): Headers {
  const headers = new Headers();
  for (const name of UPSTREAM_REQUEST_HEADER_ALLOWLIST) {
    const value = requestHeaders.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

export function downstreamResponseHeaders(upstreamHeaders: Headers): Headers {
  const headers = new Headers();
  for (const name of DOWNSTREAM_RESPONSE_HEADER_ALLOWLIST) {
    const value = upstreamHeaders.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

function harnessPathSegment(part: string): string {
  let decoded = part;
  try {
    decoded = decodeURIComponent(part);
  } catch {
    throw new TypeError("Harness path contains invalid encoding");
  }
  if (decoded === "." || decoded === "..") {
    throw new TypeError("Harness path cannot contain dot segments");
  }
  return encodeURIComponent(part);
}

export function harnessTargetUrl(
  path: string[],
  namespace: "v1" | "api" = "v1",
  target: HarnessTarget = "managed",
): string {
  const targetPath = path.map(harnessPathSegment).join("/");
  return `${harnessBaseUrl(target)}/${namespace}/${targetPath}`;
}

async function proxyToHarnessNamespace(
  request: Request,
  path: string[],
  namespace: "v1" | "api",
  target: HarnessTarget,
  bodyLimitBytes = 256 * 1024,
): Promise<Response> {
  if (!isHarnessRouteAllowed(request.method, path, namespace, target)) {
    return Response.json(
      { error: "Harness route is not available through Local Studio" },
      {
        status: 404,
      },
    );
  }
  const token = harnessToken(target);
  if (!token) {
    return Response.json(
      {
        error: `Harness authentication is not configured for the ${target} integration`,
      },
      { status: 503 },
    );
  }
  const sourceUrl = new URL(request.url);
  let upstreamTarget: string;
  try {
    upstreamTarget = `${harnessTargetUrl(path, namespace, target)}${sourceUrl.search}`;
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Harness path is invalid" },
      { status: 400 },
    );
  }
  const headers = upstreamRequestHeaders(request.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("x-agentic-harness-client-scope", "remote");

  let body: ArrayBuffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const bounded = await readRequestBytesWithinLimit(request, bodyLimitBytes);
    if (!bounded.ok) return Response.json({ error: bounded.error }, { status: bounded.status });
    body = new ArrayBuffer(bounded.value.byteLength);
    new Uint8Array(body).set(bounded.value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamTarget, {
      method: request.method,
      headers,
      body,
      signal: request.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (request.signal.aborted) throw error;
    return Response.json(
      {
        error: `agentic harness unreachable at ${harnessBaseUrl(target)}: ${
          error instanceof Error ? error.message : "fetch failed"
        }`,
      },
      { status: 502 },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: downstreamResponseHeaders(upstream.headers),
  });
}

export function proxyToHarness(
  request: Request,
  path: string[],
  bodyLimitBytes = 256 * 1024,
): Promise<Response> {
  return proxyToHarnessNamespace(request, path, "v1", "managed", bodyLimitBytes);
}

/**
 * Proxy the managed local-goal API separately from the read-only integration
 * API. Keeping the namespace explicit prevents a UI caller from accidentally
 * turning a v1 canary endpoint into a privileged durable-goal action.
 */
export function proxyToManagedHarness(
  request: Request,
  path: string[],
  bodyLimitBytes = 256 * 1024,
): Promise<Response> {
  return proxyToHarnessNamespace(request, path, "api", "managed", bodyLimitBytes);
}

export function proxyToProviderHarness(
  request: Request,
  path: string[],
  bodyLimitBytes = 256 * 1024,
): Promise<Response> {
  return proxyToHarnessNamespace(request, path, "api", "provider", bodyLimitBytes);
}
