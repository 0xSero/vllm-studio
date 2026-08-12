import { NextRequest } from "next/server";
import { relayResponse } from "@/app/api/_lib/relay-response";
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
import { clearBackendOverrideHeaders, resolveProxyTarget } from "./proxy-target";

const route = (request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) =>
  params.then(({ path }) => handleRequest(request, request.method, path));

export const GET = route;
export const POST = route;
export const PUT = route;
export const DELETE = route;

async function handleRequest(request: NextRequest, method: string, path: string[]) {
  const startTime = Date.now();
  const client = getClientInfo(request);

  try {
    const target = await resolveProxyTarget(request, client);
    if ("blockedResponse" in target) return target.blockedResponse;

    const { apiKeyQuery, searchParams } = getForwardedSearchParams(request);
    const targetUrl = buildTargetUrl(target.backendUrl, path, searchParams);
    const fallbackTargetUrl = buildFallbackTargetUrl({
      defaultBackendUrl: target.defaultBackendUrl,
      overrideUrl: target.overrideUrl,
      path,
      searchParams,
    });
    const hasAuth = Boolean(request.headers.get("authorization"));
    logProxyAccess({ client, hasAuth, method, overrideUrl: target.overrideUrl, path });

    const body = await readProxyRequestBody(request, method, proxyRequestBodyLimit(path));
    const headers = buildProxyRequestHeaders(
      request,
      target.apiKey,
      apiKeyQuery,
      Boolean(target.overrideUrl),
    );

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
      },
    );

    return relayResponse(response, {
      headers:
        usedFallback || target.blockedOverrideCleared ? clearBackendOverrideHeaders() : undefined,
      onStreamError: (error) => {
        if (shouldLogProxyError(method, path, error)) {
          console.warn(
            `[PROXY STREAM CLOSED] ip=${client.ip} | country=${client.country} | method=${method} | path=/${path.join("/")} | error=${String(error)}`,
          );
        }
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    if (shouldLogProxyError(method, path, error)) {
      console.error(
        `[PROXY ERROR] ip=${client.ip} | country=${client.country} | method=${method} | path=/${path.join("/")} | duration=${duration}ms | error=${String(error)}`,
      );
    }
    if (isAbortError(error)) {
      return Response.json({ error: "Backend request timed out" }, { status: 504 });
    }
    if (error instanceof ProxyBodyTooLargeError) {
      return Response.json({ error: error.message }, { status: 413 });
    }
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
