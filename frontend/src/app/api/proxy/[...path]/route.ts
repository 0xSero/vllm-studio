import { NextRequest, NextResponse } from "next/server";
import { getApiSettings } from "@/lib/api-settings";
import { getUpstreamTimeoutMs } from "./proxy-timeouts";

const OVERRIDE_ALLOWLIST_ENV_KEY = "VLLM_STUDIO_PROXY_OVERRIDE_ALLOWLIST";
const PROXY_ACCESS_LOGS_ENABLED = process.env.VLLM_STUDIO_PROXY_ACCESS_LOGS === "true";
const PROXY_ERROR_LOG_THROTTLE_MS = 30_000;
const proxyErrorLogTimes = new Map<string, number>();

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

function getClientInfo(request: NextRequest) {
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    request.headers.get("X-Real-IP") ||
    "unknown";
  const country = request.headers.get("CF-IPCountry") || "-";
  const ua = request.headers.get("User-Agent")?.slice(0, 80) || "unknown";
  return { ip, country, ua };
}

function normalizeBackendUrl(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function normalizeOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getTrustedOverrideOrigins(defaultBackendUrl: string): Set<string> {
  const trusted = new Set<string>();

  const defaultOrigin = normalizeOrigin(defaultBackendUrl);
  if (defaultOrigin) {
    trusted.add(defaultOrigin);
  }

  const rawAllowlist = process.env[OVERRIDE_ALLOWLIST_ENV_KEY] ?? "";
  for (const entry of rawAllowlist.split(",")) {
    const normalized = normalizeBackendUrl(entry.trim());
    const origin = normalizeOrigin(normalized);
    if (origin) {
      trusted.add(origin);
    }
  }

  return trusted;
}

function isPrivateUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "0.0.0.0"
    )
      return true;
    if (hostname.endsWith(".local") || hostname.endsWith(".internal")) return true;
    // Check private IP ranges
    const parts = hostname.split(".");
    if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
      const [a, b] = parts.map(Number);
      if (a === 10) return true;
      if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 169 && b === 254) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function isTrustedPrivateOverride(urlString: string, defaultBackendUrl: string): boolean {
  // Desktop app (Electron) runs entirely locally — all private IPs are trusted.
  if (process.env.VLLM_STUDIO_DATA_DIR) return true;

  const targetOrigin = normalizeOrigin(urlString);
  if (!targetOrigin) return false;
  const trusted = getTrustedOverrideOrigins(defaultBackendUrl);
  return trusted.has(targetOrigin);
}

function buildTargetUrl(backendUrl: string, path: string[], searchParams: string): string {
  return `${backendUrl}/${path.join("/")}${searchParams ? `?${searchParams}` : ""}`;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"))
  );
}

/**
 * Distinguishes a transiently dropped/stale connection (worth one retry with a
 * fresh socket) from a definitive failure like a clean connection refusal or
 * DNS error (where retrying just doubles the load on a down backend).
 */
function isRetriableConnectionError(error: unknown): boolean {
  if (isAbortError(error)) return false;
  const code = (error as { cause?: { code?: string } } | undefined)?.cause?.code;
  if (code) {
    return (
      code === "ECONNRESET" ||
      code === "EPIPE" ||
      code === "ETIMEDOUT" ||
      code === "UND_ERR_SOCKET" ||
      code === "UND_ERR_CONNECT_TIMEOUT"
    );
  }
  // undici sometimes surfaces a stale keep-alive socket as a bare "fetch failed"
  // TypeError with no cause code; a single retry typically gets a fresh socket.
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes("fetch failed") || message.includes("terminated");
}

function proxyLogKey(method: string, path: string[], error: unknown): string {
  const message = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  return `${method}:${path.join("/")}:${message.slice(0, 120)}`;
}

function shouldLogProxyError(method: string, path: string[], error: unknown): boolean {
  const key = proxyLogKey(method, path, error);
  const now = Date.now();
  const previous = proxyErrorLogTimes.get(key) ?? 0;
  if (now - previous < PROXY_ERROR_LOG_THROTTLE_MS) return false;
  proxyErrorLogTimes.set(key, now);
  return true;
}

function proxyResponseStream(
  body: ReadableStream<Uint8Array>,
  context: {
    client: { ip: string; country: string };
    method: string;
    path: string[];
  },
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        if (shouldLogProxyError(context.method, context.path, error)) {
          console.warn(
            `[PROXY STREAM CLOSED] ip=${context.client.ip} | country=${context.client.country} | method=${context.method} | path=/${context.path.join("/")} | error=${String(error)}`,
          );
        }
        controller.close();
      }
    },
    cancel(reason) {
      void reader.cancel(reason).catch(() => undefined);
    },
  });
}

function shouldFallbackFromResponse(response: Response): boolean {
  if (response.ok) return false;
  if (response.status !== 404) return false;
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("text/plain");
}

async function fetchWithOptionalFallback(
  primaryUrl: string,
  fallbackUrl: string | null,
  init: RequestInit,
  context: {
    client: { ip: string; country: string; ua: string };
    method: string;
    path: string[];
    overrideUsed: boolean;
    strictOverride: boolean;
  },
): Promise<{ response: Response; usedFallback: boolean }> {
  const canFallback = Boolean(
    context.overrideUsed && !context.strictOverride && fallbackUrl && fallbackUrl !== primaryUrl,
  );

  // Idempotent reads may retry once on a dropped/stale connection so a single
  // bad keep-alive socket doesn't surface to the user as a disconnect.
  const maxConnectionAttempts = context.method === "GET" || context.method === "HEAD" ? 2 : 1;

  const fetchOnce = async (url: string): Promise<Response> => {
    const controller = new AbortController();
    const timeoutMs = getUpstreamTimeoutMs(context.path);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const fetchWithTimeout = async (url: string): Promise<Response> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < maxConnectionAttempts; attempt++) {
      try {
        return await fetchOnce(url);
      } catch (error) {
        lastError = error;
        if (attempt < maxConnectionAttempts - 1 && isRetriableConnectionError(error)) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  };

  try {
    const primaryResponse = await fetchWithTimeout(primaryUrl);
    if (canFallback && shouldFallbackFromResponse(primaryResponse)) {
      console.warn(
        `[PROXY FALLBACK] ip=${context.client.ip} | country=${context.client.country} | method=${context.method} | path=/${context.path.join("/")} | reason=override-404-text`,
      );
      return { response: await fetchWithTimeout(fallbackUrl as string), usedFallback: true };
    }
    return { response: primaryResponse, usedFallback: false };
  } catch (error) {
    if (!canFallback) throw error;
    console.warn(
      `[PROXY FALLBACK] ip=${context.client.ip} | country=${context.client.country} | method=${context.method} | path=/${context.path.join("/")} | reason=override-network-error | error=${String(error)}`,
    );
    return { response: await fetchWithTimeout(fallbackUrl as string), usedFallback: true };
  }
}

async function handleRequest(request: NextRequest, method: string, path: string[]) {
  const startTime = Date.now();
  const client = getClientInfo(request);

  try {
    // Get dynamic settings
    const settings = await getApiSettings();
    const overrideHeaderUrl = normalizeBackendUrl(request.headers.get("x-backend-url"));
    const strictOverride = request.headers.get("x-backend-strict") === "1";
    const overrideCookieUrl = normalizeBackendUrl(
      request.cookies.get("vllmstudio_backend_url")?.value ?? null,
    );
    const defaultBackendUrl = normalizeBackendUrl(settings.backendUrl) ?? settings.backendUrl;

    let overrideUrl = overrideHeaderUrl ?? overrideCookieUrl;
    const overrideSource = overrideHeaderUrl ? "header" : overrideCookieUrl ? "cookie" : null;
    let blockedOverrideCleared = false;

    if (overrideUrl && isPrivateUrl(overrideUrl)) {
      const trusted = isTrustedPrivateOverride(overrideUrl, defaultBackendUrl);
      if (!trusted) {
        if (overrideSource === "header") {
          console.warn(
            `[PROXY BLOCKED] ip=${client.ip} | override=redacted | reason=private-address-not-allowlisted`,
          );
          return NextResponse.json(
            {
              error:
                "Backend override blocked: private/local addresses must be allowlisted via VLLM_STUDIO_PROXY_OVERRIDE_ALLOWLIST",
            },
            {
              status: 403,
              headers: {
                "X-Backend-Override-Invalid": "1",
                "Set-Cookie": "vllmstudio_backend_url=; Path=/; Max-Age=0; SameSite=Lax",
              },
            },
          );
        }

        console.warn(
          `[PROXY OVERRIDE IGNORED] ip=${client.ip} | override=redacted | reason=private-cookie-not-allowlisted`,
        );
        overrideUrl = null;
        blockedOverrideCleared = true;
      }
    }

    const backendUrl = overrideUrl ?? defaultBackendUrl;
    const API_KEY = settings.apiKey;

    const url = new URL(request.url);
    const forwardedParams = new URLSearchParams(url.searchParams);
    const apiKeyQuery = forwardedParams.get("api_key");
    // Never forward credentials to the controller as query params.
    if (apiKeyQuery) forwardedParams.delete("api_key");
    const searchParams = forwardedParams.toString();
    const targetUrl = buildTargetUrl(backendUrl, path, searchParams);
    const fallbackTargetUrl =
      overrideUrl && defaultBackendUrl !== overrideUrl
        ? buildTargetUrl(defaultBackendUrl, path, searchParams)
        : null;
    const hasAuth = Boolean(request.headers.get("authorization"));

    if (PROXY_ACCESS_LOGS_ENABLED) {
      console.log(
        `[PROXY] ip=${client.ip} | country=${client.country} | method=${method} | path=/${path.join("/")} | backend=configured | override=${overrideUrl ? "yes" : "no"} | auth=${hasAuth ? "present" : "none"}`,
      );
    }

    const headers: HeadersInit = {
      ...(request.headers.get("accept") ? { Accept: request.headers.get("accept") as string } : {}),
    };

    const incomingContentType = request.headers.get("content-type");
    if (incomingContentType) headers["Content-Type"] = incomingContentType;

    // Prefer per-user Authorization header passed from the browser; fallback to configured API key.
    const incomingAuth = request.headers.get("authorization");
    if (incomingAuth) {
      headers["Authorization"] = incomingAuth;
    } else if (apiKeyQuery) {
      headers["Authorization"] = `Bearer ${apiKeyQuery}`;
    } else if (API_KEY) {
      headers["Authorization"] = `Bearer ${API_KEY}`;
    }

    const body = method !== "GET" && method !== "DELETE" ? await request.text() : undefined;

    const { response, usedFallback } = await fetchWithOptionalFallback(
      targetUrl,
      fallbackTargetUrl,
      { method, headers, body },
      {
        client,
        method,
        path,
        overrideUsed: Boolean(overrideUrl),
        strictOverride,
      },
    );

    const contentType = response.headers.get("content-type") || "application/json";
    const invalidateOverride = usedFallback || blockedOverrideCleared;

    if (contentType.includes("text/event-stream") && response.body) {
      const runId = response.headers.get("x-run-id");
      return new NextResponse(
        proxyResponseStream(response.body, {
          client,
          method,
          path,
        }),
        {
          status: response.status,
          headers: {
            "Content-Type": contentType,
            "Cache-Control": response.headers.get("cache-control") || "no-cache",
            ...(invalidateOverride ? { "X-Backend-Override-Invalid": "1" } : {}),
            ...(invalidateOverride
              ? { "Set-Cookie": "vllmstudio_backend_url=; Path=/; Max-Age=0; SameSite=Lax" }
              : {}),
            ...(runId ? { "X-Run-Id": runId } : {}),
          },
        },
      );
    }

    const data = await response.text();
    return new NextResponse(data, {
      status: response.status,
      headers: {
        "Content-Type": contentType,
        ...(invalidateOverride ? { "X-Backend-Override-Invalid": "1" } : {}),
        ...(invalidateOverride
          ? { "Set-Cookie": "vllmstudio_backend_url=; Path=/; Max-Age=0; SameSite=Lax" }
          : {}),
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
      return NextResponse.json({ error: "Backend request timed out" }, { status: 504 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
