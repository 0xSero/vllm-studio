import { NextRequest, NextResponse } from "next/server";
import { enterpriseAuthConfig, enterpriseIssuer } from "@/lib/auth/enterprise-config";
import {
  consumeAuthorizationFlow,
  createEnterpriseSession,
  ENTERPRISE_FLOW_COOKIE,
  ENTERPRISE_SESSION_COOKIE,
  normalizeOidcClaims,
  oidcSessionIdFromClaims,
} from "@/lib/auth/enterprise-session";
import { redeemAuthorizationCode } from "@/lib/auth/oidc-client";
import { emitEnterpriseAudit } from "@/lib/auth/enterprise-audit";
import { requestUsesHttps } from "@/lib/auth/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ issuer: string }> },
) {
  try {
    const { issuer: issuerId } = await params;
    const code = request.nextUrl.searchParams.get("code") ?? "";
    const state = request.nextUrl.searchParams.get("state") ?? "";
    const flow = await consumeAuthorizationFlow(
      request.cookies.get(ENTERPRISE_FLOW_COOKIE)?.value ?? "",
      state,
      issuerId,
    );
    if (!code) throw new Error("OIDC callback does not match login");
    const issuer = enterpriseIssuer(issuerId);
    const tokens = await redeemAuthorizationCode(issuer, flow, code);
    const config = enterpriseAuthConfig();
    if (!config) throw new Error("Enterprise authentication is not configured");
    const principal = normalizeOidcClaims(tokens.claims, issuer);
    const session = await createEnterpriseSession(principal, tokens.accessToken, config, {
      ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
      ...(tokens.idToken ? { idToken: tokens.idToken } : {}),
      ...(tokens.accountId ? { accountId: tokens.accountId } : {}),
      ...(oidcSessionIdFromClaims(tokens.claims)
        ? { oidcSessionId: oidcSessionIdFromClaims(tokens.claims) }
        : {}),
    });
    emitEnterpriseAudit({
      event: "login",
      subject: principal.subject,
      issuer_id: principal.issuer_id,
      tenant: principal.tenant,
    });
    const response = NextResponse.redirect(new URL(flow.returnTo, request.url));
    response.cookies.delete(ENTERPRISE_FLOW_COOKIE);
    response.cookies.set(ENTERPRISE_SESSION_COOKIE, session.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: requestUsesHttps(request),
      path: "/",
      maxAge: config.session_absolute_seconds,
    });
    return response;
  } catch {
    emitEnterpriseAudit({ event: "session_denied", reason: "callback_validation_failed" });
    const response = NextResponse.json(
      { error: "OIDC callback validation failed" },
      { status: 401 },
    );
    response.cookies.delete(ENTERPRISE_FLOW_COOKIE);
    return response;
  }
}
