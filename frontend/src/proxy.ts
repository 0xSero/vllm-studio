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

const TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
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

function enforceAccess(request: NextRequest): NextResponse | null {
  const posture = resolveAccessPosture();
  if (posture.kind === "allow") return null;

  const url = request.nextUrl;
  const isApi = url.pathname.startsWith("/api/");

  const queryToken = url.searchParams.get("token");
  if (queryToken && timingSafeStringEqual(queryToken.trim(), posture.token)) {
    const clean = url.clone();
    clean.searchParams.delete("token");
    const redirect = NextResponse.redirect(clean);
    redirect.cookies.set(STUDIO_TOKEN_COOKIE, posture.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: url.protocol === "https:",
      path: "/",
      maxAge: TOKEN_MAX_AGE_SECONDS,
    });
    return redirect;
  }

  const presented = presentedToken(
    request.headers.get(STUDIO_TOKEN_HEADER),
    request.cookies.get(STUDIO_TOKEN_COOKIE)?.value,
  );
  if (presented && timingSafeStringEqual(presented, posture.token)) return null;

  return denyResponse(isApi, 401, "Unauthorized");
}

export function proxy(request: NextRequest) {
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
  const denied = enforceAccess(request);
  if (denied) return denied;

  const start = Date.now();
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set(CSRF_BOOTSTRAP_HEADER, PROCESS_CSRF_TOKEN);
  const response = NextResponse.next({ request: { headers: forwardedHeaders } });

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
