// Single switch between the two agent-runtime hosts (Phase 5b).
//
// When LOCAL_STUDIO_AGENT_RUNTIME_URL is set (e.g. http://127.0.0.1:8081), the
// runtime + browser-host routes proxy to the standalone agent-runtime process
// and return the upstream body pass-through — the one case Next's standalone
// server does NOT buffer, so SSE streams flush. When unset (the default, and
// all of `next dev`), the routes fall back to their in-process handlers and
// behavior is byte-identical to before this seam existed.
//
// Read at request time (not module scope) so the standalone server picks the
// value up from its systemd/service environment.

import { readRequestBytesWithinLimit } from "@shared/agent/agent-turn-body";

const HOP_BY_HOP_REQUEST_HEADERS = ["host", "connection", "content-length", "accept-encoding"];

type AgentRuntimeProxyOptions = {
  bodyLimitBytes?: number;
};

export function agentRuntimeBaseUrl(): string | null {
  const raw = process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

/**
 * Proxy `request` to the standalone agent-runtime service, preserving the
 * pathname + query (the service mounts the identical /api/agent/* paths).
 * Returns null when the env switch is unset — the caller then runs the
 * in-process handler. Returns 502 when the switch is set but the service is
 * unreachable, so a dead sidecar degrades with a clean error instead of a
 * hung request.
 */
export async function proxyToAgentRuntime(
  request: Request,
  options: AgentRuntimeProxyOptions = {},
): Promise<Response | null> {
  const base = agentRuntimeBaseUrl();
  if (!base) return null;
  const url = new URL(request.url);
  const target = `${base}${url.pathname}${url.search}`;

  const headers = new Headers(request.headers);
  for (const name of HOP_BY_HOP_REQUEST_HEADERS) headers.delete(name);

  let body: ArrayBuffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (options.bodyLimitBytes) {
      const bounded = await readRequestBytesWithinLimit(request, options.bodyLimitBytes);
      if (!bounded.ok) return Response.json({ error: bounded.error }, { status: bounded.status });
      body = new ArrayBuffer(bounded.value.byteLength);
      new Uint8Array(body).set(bounded.value);
    } else {
      body = await request.arrayBuffer();
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      // Propagate client disconnects so upstream SSE subscriptions close.
      signal: request.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (request.signal.aborted) throw error;
    return Response.json(
      {
        error: `agent runtime unreachable at ${base}: ${
          error instanceof Error ? error.message : "fetch failed"
        }`,
      },
      { status: 502 },
    );
  }

  // Pass-through: hand Next the upstream body stream unchanged. Strip
  // entity-framing headers that no longer match after re-chunking.
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("content-length");
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("transfer-encoding");
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
