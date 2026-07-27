import { readRequestBytesWithinLimit } from "@shared/agent/agent-turn-body";

const HOP_BY_HOP_REQUEST_HEADERS = ["host", "connection", "content-length", "accept-encoding"];
const DEFAULT_HARNESS_URL = "http://127.0.0.1:8771";

export function harnessBaseUrl(): string {
  const raw = process.env.LOCAL_STUDIO_HARNESS_URL?.trim();
  return (raw || DEFAULT_HARNESS_URL).replace(/\/+$/, "");
}

export async function proxyToHarness(
  request: Request,
  path: string[],
  bodyLimitBytes = 256 * 1024,
): Promise<Response> {
  const targetPath = path.map((part) => encodeURIComponent(part)).join("/");
  const sourceUrl = new URL(request.url);
  const target = `${harnessBaseUrl()}/v1/${targetPath}${sourceUrl.search}`;
  const headers = new Headers(request.headers);
  for (const name of HOP_BY_HOP_REQUEST_HEADERS) headers.delete(name);

  let body: ArrayBuffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const bounded = await readRequestBytesWithinLimit(request, bodyLimitBytes);
    if (!bounded.ok) return Response.json({ error: bounded.error }, { status: bounded.status });
    body = new ArrayBuffer(bounded.value.byteLength);
    new Uint8Array(body).set(bounded.value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
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
        error: `agentic harness unreachable at ${harnessBaseUrl()}: ${
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
