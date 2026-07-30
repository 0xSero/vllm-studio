import { NextRequest, NextResponse } from "next/server";
import { getClientInfo, logProxyAccess, shouldLogProxyError } from "./proxy-logging";
import {
  buildFallbackTargetUrl,
  buildProxyRequestHeaders,
  buildTargetUrl,
  fetchWithOptionalFallback,
  getForwardedSearchParams,
  isAbortError,
  ProxyBodyTooLargeError,
  proxyRequestBodyLimit,
  readProxyRequestBody,
} from "./proxy-fetch";
import { toProxyNextResponse } from "./proxy-response";
import { resolveProxyTarget } from "./proxy-target";
import { enterpriseAuthConfig } from "@/lib/auth/enterprise-config";
import { ENTERPRISE_SESSION_COOKIE, getEnterpriseSession } from "@/lib/auth/enterprise-session";
import { acquireEnterpriseAccessToken } from "@/lib/auth/token-broker";
import { loadWorkloadIdentityConfig } from "@local-studio/agent-runtime/spiffe-config";
import { fetchJwtSvid } from "@local-studio/agent-runtime/spiffe-workload-api";
import { fetchWithX509Svid } from "@local-studio/agent-runtime/spiffe-x509";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return handleRequest(request, "GET", path);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return handleRequest(request, "POST", path);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return handleRequest(request, "PUT", path);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  return handleRequest(request, "DELETE", path);
}

async function handleRequest(request: NextRequest, method: string, path: string[]) {
  const startTime = Date.now();
  const client = getClientInfo(request);

  try {
    const { credentialQueryPresent, searchParams } = getForwardedSearchParams(request);
    if (credentialQueryPresent) {
      return NextResponse.json(
        { error: "Query-string credentials are not accepted" },
        { status: 400 },
      );
    }
    const target = await resolveProxyTarget(request, client);
    if ("blockedResponse" in target) return target.blockedResponse;
    const targetUrl = buildTargetUrl(target.backendUrl, path, searchParams);
    const fallbackTargetUrl = buildFallbackTargetUrl({
      defaultBackendUrl: target.defaultBackendUrl,
      overrideUrl: target.overrideUrl,
      path,
      searchParams,
    });
    const enterpriseSession = await getEnterpriseSession(
      request.cookies.get(ENTERPRISE_SESSION_COOKIE)?.value,
      enterpriseAuthConfig(),
    );
    const hasAuth = Boolean(request.headers.get("authorization") || enterpriseSession);
    logProxyAccess({ client, hasAuth, method, overrideUrl: target.overrideUrl, path });

    const body = await readProxyRequestBody(request, method, proxyRequestBodyLimit(path));
    const headers = buildProxyRequestHeaders(request, target.apiKey);
    if (enterpriseSession) {
      const lease = await acquireEnterpriseAccessToken(enterpriseSession);
      headers.set("Authorization", `Bearer ${lease.accessToken}`);
    }
    const workload = loadWorkloadIdentityConfig();
    let workloadFetcher: ((url: string, init: RequestInit) => Promise<Response>) | undefined;
    if (
      workload &&
      workload.mode !== "disabled" &&
      target.backendUrl === target.defaultBackendUrl
    ) {
      const identity = await fetchJwtSvid(
        workload,
        workload.controller_audience,
        workload.frontend_id,
        request.signal,
      );
      headers.set("x-spiffe-jwt-svid", identity.svid);
      workloadFetcher = (url, init) =>
        fetchWithX509Svid(workload, workload.frontend_id, workload.controller_id, url, init);
    }

    const { response, usedFallback } = await fetchWithOptionalFallback(
      targetUrl,
      fallbackTargetUrl,
      { method, headers, body },
      {
        client,
        method,
        path,
        overrideUsed: Boolean(target.overrideUrl),
        strictOverride: target.strictOverride,
        ...(workloadFetcher ? { fetcher: workloadFetcher } : {}),
      },
    );

    return toProxyNextResponse(response, {
      client,
      invalidateOverride: usedFallback || target.blockedOverrideCleared,
      method,
      path,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    if (shouldLogProxyError(method, path, error)) {
      console.error(
        `[PROXY ERROR] ip=${client.ip} | country=${client.country} | method=${method} | path=/${path.join("/")} | duration=${duration}ms | error=${String(error)}`,
      );
    }
    if (isAbortError(error)) {
      return NextResponse.json({ error: "Backend request timed out" }, { status: 504 });
    }
    if (error instanceof ProxyBodyTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
