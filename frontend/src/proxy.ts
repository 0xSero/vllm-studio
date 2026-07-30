import { NextResponse, type NextRequest } from "next/server";
import {
  STUDIO_TOKEN_COOKIE,
  STUDIO_TOKEN_HEADER,
  presentedToken,
  resolveAccessPosture,
  timingSafeStringEqual,
} from "@/lib/auth/access";
import {
  CSRF_COOKIE,
  CSRF_BOOTSTRAP_HEADER,
  CSRF_HEADER,
  evaluateRequestBoundary,
  splitAllowedValues,
} from "@/lib/security/request-boundary";
import { enterpriseAuthConfig } from "@/lib/auth/enterprise-config";
import {
  ENTERPRISE_SESSION_COOKIE,
  getEnterpriseSession,
  type EnterpriseSession,
} from "@/lib/auth/enterprise-session";
import type { EnterpriseAuthConfig } from "@local-studio/contracts/enterprise-auth";
import {
  enterpriseOperationDenial,
  enterpriseOperationPolicy,
} from "@local-studio/contracts/enterprise-authorization";
import { acquireEnterpriseAccessToken } from "@/lib/auth/token-broker";
import { requestUsesHttps } from "@/lib/auth/request-context";

const PROCESS_CSRF_TOKEN = crypto.randomUUID();

function denyResponse(isApi: boolean, status: number, message: string): NextResponse {
  if (isApi) {
    return new NextResponse(JSON.stringify({ error: message }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }
  return new NextResponse(message, { status });
}

type AccessEvaluation = {
  denied: NextResponse | null;
  session?: EnterpriseSession;
  previousSessionId?: string;
};

async function enforceEnterpriseAccess(
  request: NextRequest,
  config: EnterpriseAuthConfig | null,
  optional: boolean,
): Promise<AccessEvaluation> {
  const sessionId = request.cookies.get(ENTERPRISE_SESSION_COOKIE)?.value;
  const existingSession = await getEnterpriseSession(sessionId, config);
  let session = existingSession;
  if (session) {
    try {
      session = (await acquireEnterpriseAccessToken(session)).session;
    } catch {
      session = null;
    }
  }
  const policy = enterpriseOperationPolicy(request.method, request.nextUrl.pathname);
  if (session) {
    if (policy && enterpriseOperationDenial(session.principal, policy)) {
      return {
        denied: denyResponse(true, 403, "Enterprise authorization denied"),
        session,
        ...(sessionId && session.id !== sessionId ? { previousSessionId: sessionId } : {}),
      };
    }
    return {
      denied: null,
      session,
      ...(sessionId && session.id !== sessionId ? { previousSessionId: sessionId } : {}),
    };
  }
  if (optional && !sessionId && !policy) return { denied: null };
  const url = request.nextUrl;
  let response: NextResponse;
  if (url.pathname.startsWith("/api/")) {
    response = denyResponse(true, 401, "Enterprise sign-in required");
  } else {
    const issuerId = config?.issuers[0]?.id;
    if (!issuerId) {
      response = denyResponse(false, 503, "Enterprise issuer is not configured");
    } else {
      const login = new URL(`/api/auth/login/${encodeURIComponent(issuerId)}`, request.url);
      login.searchParams.set("returnTo", `${url.pathname}${url.search}`);
      response = NextResponse.redirect(login);
    }
  }
  if (sessionId) response.cookies.delete(ENTERPRISE_SESSION_COOKIE);
  return { denied: response };
}

async function evaluateAccess(
  request: NextRequest,
  config: EnterpriseAuthConfig | null = enterpriseAuthConfig(),
): Promise<AccessEvaluation> {
  const url = request.nextUrl;
  const isApi = url.pathname.startsWith("/api/");
  if (
    url.pathname.startsWith("/api/auth/") ||
    url.pathname === "/api/health" ||
    url.pathname === "/api/desktop-health"
  ) {
    return { denied: null };
  }
  const posture = resolveAccessPosture({ enterpriseMode: config?.mode ?? null });
  if (posture.kind === "allow") return { denied: null };
  if (posture.kind === "misconfigured") {
    return {
      denied: denyResponse(isApi, 503, "Shared deployment authentication is not configured"),
    };
  }
  if (posture.kind === "require-oidc" || posture.kind === "optional-oidc") {
    return enforceEnterpriseAccess(request, config, posture.kind === "optional-oidc");
  }

  const presented = presentedToken(
    request.headers.get(STUDIO_TOKEN_HEADER),
    request.cookies.get(STUDIO_TOKEN_COOKIE)?.value,
  );
  if (presented && timingSafeStringEqual(presented, posture.token)) return { denied: null };

  return { denied: denyResponse(isApi, 401, "Unauthorized") };
}

export async function enforceAccess(
  request: NextRequest,
  config: EnterpriseAuthConfig | null = enterpriseAuthConfig(),
): Promise<NextResponse | null> {
  const access = await evaluateAccess(request, config);
  if (access.denied && access.session && access.previousSessionId) {
    setEnterpriseSessionCookie(access.denied, request, access.session);
  }
  return access.denied;
}

const withEnterpriseSessionCookie = (cookie: string, sessionId: string): string => {
  const entries = cookie
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry && !entry.startsWith(`${ENTERPRISE_SESSION_COOKIE}=`));
  entries.push(`${ENTERPRISE_SESSION_COOKIE}=${sessionId}`);
  return entries.join("; ");
};

const setEnterpriseSessionCookie = (
  response: NextResponse,
  request: NextRequest,
  session: EnterpriseSession,
): void => {
  response.cookies.set(ENTERPRISE_SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: requestUsesHttps(request),
    path: "/",
    maxAge: Math.max(Math.floor((session.absoluteExpiresAt - Date.now()) / 1000), 1),
  });
};

export async function proxy(request: NextRequest) {
  const boundary = evaluateRequestBoundary({
    method: request.method,
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    origin: request.headers.get("origin"),
    fetchSite: request.headers.get("sec-fetch-site"),
    csrfCookie: request.cookies.get(CSRF_COOKIE)?.value ?? null,
    csrfHeader: request.headers.get(CSRF_HEADER),
    tailscaleUser: request.headers.get("tailscale-user-login"),
    requestProtocol: request.nextUrl.protocol,
    allowedTailscaleHosts: splitAllowedValues(process.env.ALLOWED_TAILSCALE_HOSTS),
    allowedTailscaleUsers: splitAllowedValues(process.env.ALLOWED_TAILSCALE_USERS),
    csrfToken: PROCESS_CSRF_TOKEN,
  });
  if (!boundary.ok) {
    return denyResponse(
      request.nextUrl.pathname.startsWith("/api/"),
      boundary.status,
      boundary.error,
    );
  }
  const access = await evaluateAccess(request);
  if (access.denied) {
    if (access.session && access.previousSessionId) {
      setEnterpriseSessionCookie(access.denied, request, access.session);
    }
    return access.denied;
  }

  const start = Date.now();
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set(CSRF_BOOTSTRAP_HEADER, PROCESS_CSRF_TOKEN);
  if (access.session && access.previousSessionId) {
    forwardedHeaders.set(
      "cookie",
      withEnterpriseSessionCookie(request.headers.get("cookie") ?? "", access.session.id),
    );
  }
  const response = NextResponse.next({ request: { headers: forwardedHeaders } });
  if (access.session && access.previousSessionId) {
    setEnterpriseSessionCookie(response, request, access.session);
  }

  writeAccessLog(request, Date.now() - start);
  applySecurityHeaders(request, response);
  return response;
}

/** Client IP as seen through Cloudflare, a reverse proxy, or neither. */
function clientIpOf(request: NextRequest): string {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    request.headers.get("X-Real-IP") ||
    "unknown"
  );
}

/** Credentials routinely arrive as query parameters; they must never be logged. */
function redactedQuery(request: NextRequest): string {
  const sanitizedUrl = request.nextUrl.clone();
  for (const sensitiveKey of ["api_key", "key", "token", "access_token"]) {
    if (sanitizedUrl.searchParams.has(sensitiveKey)) {
      sanitizedUrl.searchParams.set(sensitiveKey, "[redacted]");
    }
  }
  return sanitizedUrl.search || "";
}

/** Origin + path only: a full referer can carry query secrets of its own. */
function safeReferer(request: NextRequest): string {
  const raw = request.headers.get("Referer") || "-";
  if (raw === "-") return "-";
  try {
    const parsed = new URL(raw);
    return `${parsed.origin}${parsed.pathname}`.slice(0, 200);
  } catch {
    return "[invalid]";
  }
}

function writeAccessLog(request: NextRequest, duration: number): void {
  if (process.env.LOCAL_STUDIO_ACCESS_LOGS !== "true") return;
  const referer = safeReferer(request);
  const logParts = [
    `ip=${clientIpOf(request)}`,
    `country=${request.headers.get("CF-IPCountry") || "-"}`,
    `method=${request.method}`,
    `path=${request.nextUrl.pathname}${redactedQuery(request)}`,
    `duration=${duration}ms`,
    `auth=${request.headers.get("Authorization") ? "present" : "none"}`,
    `ua=${request.headers.get("User-Agent")?.slice(0, 100) || "unknown"}`,
  ];
  if (referer !== "-") logParts.push(`referer=${referer}`);
  console.log(`${new Date().toISOString()} ACCESS ${logParts.join(" | ")}`);
}

function applySecurityHeaders(request: NextRequest, response: NextResponse): void {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "no-referrer");
  // `secure` must follow the scheme the browser actually sees (cloudflared
  // forwards https as x-forwarded-proto) — a Secure cookie over plain-http
  // Tailscale access is silently dropped and every mutation then fails CSRF.
  const effectiveProto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() ||
    request.nextUrl.protocol.replace(/:$/, "");
  response.cookies.set(CSRF_COOKIE, PROCESS_CSRF_TOKEN, {
    httpOnly: false,
    sameSite: "strict",
    secure: effectiveProto === "https",
    path: "/",
  });
}

export default proxy;

// Configure which paths the middleware runs on
export const config = {
  matcher: [
    // Every /api/* request, unconditionally. This MUST come first and carry no
    // extension exclusion: the privileged API routes are the token gate's whole
    // point, and dynamic segments (/api/proxy/[...path], /api/agent/sessions/[id])
    // let a caller append a `.png`-style suffix. If the static-asset exclusion
    // below also covered /api, that suffix would skip the gate entirely.
    "/api/:path*",
    /*
     * All non-API paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files (icons/, image extensions)
     */
    "/((?!api/|_next/static|_next/image|favicon.ico|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
