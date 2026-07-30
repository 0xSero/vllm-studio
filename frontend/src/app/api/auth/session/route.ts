import { NextRequest, NextResponse } from "next/server";
import { enterpriseAuthConfig } from "@/lib/auth/enterprise-config";
import { ENTERPRISE_SESSION_COOKIE, getEnterpriseSession } from "@/lib/auth/enterprise-session";
import { acquireEnterpriseAccessToken } from "@/lib/auth/token-broker";
import { requestUsesHttps } from "@/lib/auth/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const config = enterpriseAuthConfig();
  const sessionId = request.cookies.get(ENTERPRISE_SESSION_COOKIE)?.value;
  const existing = await getEnterpriseSession(sessionId, config);
  let session = existing;
  if (session) {
    try {
      session = (await acquireEnterpriseAccessToken(session)).session;
    } catch {
      session = null;
    }
  }
  const response = NextResponse.json({
    mode: config?.mode ?? "local",
    issuers:
      config?.issuers.map(({ id, kind, tenant, realm }) => ({
        id,
        kind,
        ...(tenant ? { tenant } : {}),
        ...(realm ? { realm } : {}),
      })) ?? [],
    authenticated: Boolean(session),
    principal: session?.principal ?? null,
    expires_at: session ? new Date(session.absoluteExpiresAt).toISOString() : null,
  });
  if (!session && sessionId) {
    response.cookies.delete(ENTERPRISE_SESSION_COOKIE);
  } else if (session && session.id !== sessionId) {
    response.cookies.set(ENTERPRISE_SESSION_COOKIE, session.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: requestUsesHttps(request),
      path: "/",
      maxAge: Math.max(Math.floor((session.absoluteExpiresAt - Date.now()) / 1000), 1),
    });
  }
  return response;
}
