import { readRequestBytesWithinLimit } from "@shared/agent/agent-turn-body";

const UPSTREAM_REQUEST_HEADERS_TO_REMOVE = [
  "host",
  "connection",
  "content-length",
  "accept-encoding",
  // The Harness server validates browser-origin requests against its own
  // listener. These headers describe the browser-to-Local-Studio hop and must
  // not be replayed on the trusted Local-Studio-to-Harness hop.
  // Stripping them here is safe because the browser hop is already enforced
  // before this route runs: src/proxy.ts applies evaluateRequestBoundary
  // (host allowlist, cross-site rejection, Origin match, CSRF double-submit;
  // see src/lib/security/request-boundary.ts and its tests) and the route
  // handler re-checks the access token via requireApiAccess. Do not add a
  // second origin gate here, and do not stop stripping these headers.
  "origin",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-user",
];
const DEFAULT_HARNESS_URL = "http://127.0.0.1:8771";
const DEFAULT_PROVIDER_HARNESS_URL = "http://127.0.0.1:8772";

export type HarnessTarget = "managed" | "provider";

export function harnessBaseUrl(target: HarnessTarget = "managed"): string {
  const raw = (
    target === "provider"
      ? process.env.LOCAL_STUDIO_PROVIDER_HARNESS_URL
      : process.env.LOCAL_STUDIO_HARNESS_URL
  )?.trim();
  const fallback = target === "provider" ? DEFAULT_PROVIDER_HARNESS_URL : DEFAULT_HARNESS_URL;
  return (raw || fallback).replace(/\/+$/, "");
}

export function upstreamRequestHeaders(requestHeaders: Headers): Headers {
  const headers = new Headers(requestHeaders);
  for (const name of UPSTREAM_REQUEST_HEADERS_TO_REMOVE) headers.delete(name);
  return headers;
}

export function harnessTargetUrl(
  path: string[],
  namespace: "v1" | "api" = "v1",
  target: HarnessTarget = "managed",
): string {
  const targetPath = path.map((part) => encodeURIComponent(part)).join("/");
  return `${harnessBaseUrl(target)}/${namespace}/${targetPath}`;
}

async function proxyToHarnessNamespace(
  request: Request,
  path: string[],
  namespace: "v1" | "api",
  target: HarnessTarget,
  bodyLimitBytes = 256 * 1024,
): Promise<Response> {
  const sourceUrl = new URL(request.url);
  const upstreamTarget = `${harnessTargetUrl(path, namespace, target)}${sourceUrl.search}`;
  const headers = upstreamRequestHeaders(request.headers);

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

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("content-length");
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("transfer-encoding");
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
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
