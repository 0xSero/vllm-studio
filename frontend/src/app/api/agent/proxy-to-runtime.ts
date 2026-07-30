import { readRequestBytesWithinLimit } from "@shared/agent/agent-turn-body";
import { enterpriseAuthConfig } from "@/lib/auth/enterprise-config";
import { ENTERPRISE_SESSION_COOKIE, getEnterpriseSession } from "@/lib/auth/enterprise-session";
import { acquireEnterpriseAccessToken } from "@/lib/auth/token-broker";
import { loadWorkloadIdentityConfig } from "@local-studio/agent-runtime/spiffe-config";
import { fetchJwtSvid } from "@local-studio/agent-runtime/spiffe-workload-api";
import { fetchWithX509Svid } from "@local-studio/agent-runtime/spiffe-x509";

const HOP_BY_HOP_REQUEST_HEADERS = [
  "host",
  "connection",
  "content-length",
  "accept-encoding",
  "cookie",
  "authorization",
  "x-spiffe-jwt-svid",
];
const DEFAULT_AGENT_RUNTIME_URL = "http://127.0.0.1:8081";

type AgentRuntimeProxyOptions = {
  bodyLimitBytes?: number;
  authorization?: string;
  upstreamPath?: string;
};

export function agentRuntimeBaseUrl(): string {
  const raw = process.env.LOCAL_STUDIO_AGENT_RUNTIME_URL?.trim();
  return (raw || DEFAULT_AGENT_RUNTIME_URL).replace(/\/+$/, "");
}

export async function proxyToAgentRuntime(
  request: Request,
  options: AgentRuntimeProxyOptions = {},
): Promise<Response> {
  const base = agentRuntimeBaseUrl();
  const url = new URL(request.url);
  const target = `${base}${options.upstreamPath ?? url.pathname}${url.search}`;

  const headers = new Headers(request.headers);
  for (const name of HOP_BY_HOP_REQUEST_HEADERS) headers.delete(name);
  for (const name of [...headers.keys()]) {
    if (name.startsWith("x-local-studio-enterprise-")) headers.delete(name);
  }
  const enterpriseSession = await getEnterpriseSession(
    request.headers
      .get("cookie")
      ?.split(";")
      .map((entry) => entry.trim().split("="))
      .find(([name]) => name === ENTERPRISE_SESSION_COOKIE)?.[1],
    enterpriseAuthConfig(),
  );
  if (enterpriseSession) {
    const lease = await acquireEnterpriseAccessToken(enterpriseSession);
    headers.set("x-local-studio-enterprise-token", lease.accessToken);
  }
  const workload = loadWorkloadIdentityConfig();
  if (workload && workload.mode !== "disabled") {
    try {
      const identity = await fetchJwtSvid(
        workload,
        workload.agent_runtime_audience,
        workload.frontend_id,
        request.signal,
      );
      headers.set("x-spiffe-jwt-svid", identity.svid);
    } catch {
      if (workload.mode === "required") {
        return Response.json({ error: "SPIFFE workload identity unavailable" }, { status: 503 });
      }
    }
  }
  if (options.authorization !== undefined) {
    headers.delete("authorization");
    if (options.authorization) headers.set("authorization", options.authorization);
  }

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
    const requestInit = {
      method: request.method,
      headers,
      body,
      signal: request.signal,
      cache: "no-store",
    } satisfies RequestInit;
    upstream =
      workload && workload.mode !== "disabled"
        ? await fetchWithX509Svid(
            workload,
            workload.frontend_id,
            workload.agent_runtime_id,
            target,
            requestInit,
          )
        : await fetch(target, requestInit);
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

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("content-length");
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("transfer-encoding");
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
