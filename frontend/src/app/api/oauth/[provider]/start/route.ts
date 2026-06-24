import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl } from "@/features/agent/oauth/oauth-store";
import { getOAuthProvider } from "@/features/agent/oauth/oauth-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "oauth_state";
const PROVIDER_COOKIE = "oauth_provider";
const INSTALL_CATALOGUE_COOKIE = "oauth_install_catalogue_id";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  if (!getOAuthProvider(provider)) {
    return new NextResponse("Unknown OAuth provider.", { status: 404 });
  }
  const redirectUri = `${request.nextUrl.origin}/api/oauth/${provider}/callback`;
  const state = randomUUID();
  const catalogueId = request.nextUrl.searchParams.get("catalogueId")?.trim();
  let authUrl: string;
  try {
    authUrl = await buildAuthUrl(provider, redirectUri, state);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cannot start OAuth.";
    return new NextResponse(message, { status: 400 });
  }
  const response = NextResponse.redirect(authUrl);
  const secure = request.nextUrl.protocol === "https:";
  const cookieBase = { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: 600 };
  response.cookies.set(STATE_COOKIE, state, cookieBase);
  response.cookies.set(PROVIDER_COOKIE, provider, cookieBase);
  if (catalogueId) {
    response.cookies.set(INSTALL_CATALOGUE_COOKIE, catalogueId, cookieBase);
  }
  return response;
}
