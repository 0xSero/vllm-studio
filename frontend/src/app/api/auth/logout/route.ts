import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  consumeIssuerLogoutTicket,
  createIssuerLogoutTicket,
  deleteEnterpriseSession,
  ENTERPRISE_SESSION_COOKIE,
} from "@/lib/auth/enterprise-session";
import { emitEnterpriseAudit } from "@/lib/auth/enterprise-audit";
import { enterpriseIssuer } from "@/lib/auth/enterprise-config";
import {
  issuerLogoutUrl,
  removeOidcSessionAccount,
  revokeOidcSession,
} from "@/lib/auth/oidc-client";
import { CSRF_COOKIE, CSRF_HEADER } from "@/lib/security/request-boundary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const returnLocation = (request: NextRequest): string => {
  const value = request.nextUrl.searchParams.get("returnTo") ?? "/settings#enterprise";
  if (!value.startsWith("/") || value.startsWith("//")) return "/settings#enterprise";
  return value;
};

const validCsrf = (request: NextRequest): boolean => {
  const cookie = request.cookies.get(CSRF_COOKIE)?.value ?? "";
  const header = request.headers.get(CSRF_HEADER) ?? "";
  if (!cookie || !header) return false;
  return timingSafeEqual(
    createHash("sha256").update(cookie, "utf8").digest(),
    createHash("sha256").update(header, "utf8").digest(),
  );
};

export async function POST(request: NextRequest) {
  if (!validCsrf(request)) {
    return NextResponse.json({ error: "CSRF validation failed" }, { status: 403 });
  }
  const session = await deleteEnterpriseSession(
    request.cookies.get(ENTERPRISE_SESSION_COOKIE)?.value,
  );
  const returnTo = returnLocation(request);
  let logoutPath: string | null = null;
  let revocation: "not_available" | "observed" | "failed" = "not_available";
  if (session) {
    let issuer: ReturnType<typeof enterpriseIssuer> | null = null;
    try {
      issuer = enterpriseIssuer(session.principal.issuer_id);
    } catch {
      revocation = "failed";
    }
    if (issuer) {
      try {
        await removeOidcSessionAccount(issuer, session.accountId);
        const revoked = await revokeOidcSession(issuer, session.refreshToken);
        if (revoked) revocation = "observed";
      } catch {
        revocation = "failed";
      }
      try {
        const target = await issuerLogoutUrl(
          issuer,
          session.idToken,
          new URL(returnTo, request.url).toString(),
        );
        if (target) {
          const ticket = await createIssuerLogoutTicket(target, returnTo);
          logoutPath = `/api/auth/logout?ticket=${encodeURIComponent(ticket)}`;
        }
      } catch {}
    }
  }
  emitEnterpriseAudit({
    event: "logout",
    ...(session
      ? {
          subject: session.principal.subject,
          issuer_id: session.principal.issuer_id,
          tenant: session.principal.tenant,
        }
      : { reason: "session_not_found" }),
  });
  const response = NextResponse.json({
    authenticated: false,
    revocation,
    logout_path: logoutPath,
  });
  response.cookies.delete(ENTERPRISE_SESSION_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const ticket = await consumeIssuerLogoutTicket(request.nextUrl.searchParams.get("ticket") ?? "");
  const target = ticket?.url ?? new URL("/settings#enterprise", request.url).toString();
  return NextResponse.redirect(target, 303);
}
