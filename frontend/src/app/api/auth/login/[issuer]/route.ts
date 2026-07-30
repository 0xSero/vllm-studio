import { NextRequest, NextResponse } from "next/server";
import { enterpriseIssuer } from "@/lib/auth/enterprise-config";
import { createAuthorizationFlow, ENTERPRISE_FLOW_COOKIE } from "@/lib/auth/enterprise-session";
import { authorizationUrl } from "@/lib/auth/oidc-client";
import { requestUsesHttps } from "@/lib/auth/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ issuer: string }> },
) {
  try {
    const { issuer: issuerId } = await params;
    const issuer = enterpriseIssuer(issuerId);
    const redirectUri = new URL(`/api/auth/callback/${issuer.id}`, request.url).toString();
    const flow = await createAuthorizationFlow(
      issuer.id,
      redirectUri,
      request.nextUrl.searchParams.get("returnTo") ?? "/",
    );
    const response = NextResponse.redirect(await authorizationUrl(issuer, flow));
    response.cookies.set(ENTERPRISE_FLOW_COOKIE, flow.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: requestUsesHttps(request),
      path: "/api/auth",
      maxAge: 600,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "OIDC login could not be started" }, { status: 400 });
  }
}
