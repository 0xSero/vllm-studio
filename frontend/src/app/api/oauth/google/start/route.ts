import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { buildGoogleAuthUrl } from "@/features/agent/oauth/google-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "google_oauth_state";
const INSTALL_CATALOGUE_COOKIE = "google_oauth_install_catalogue_id";

export async function GET(request: NextRequest) {
  const redirectUri = `${request.nextUrl.origin}/api/oauth/google/callback`;
  const state = randomUUID();
  const catalogueId = request.nextUrl.searchParams.get("catalogueId")?.trim();
  let authUrl: string;
  try {
    authUrl = await buildGoogleAuthUrl(redirectUri, state);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cannot start Google OAuth.";
    return new NextResponse(message, { status: 400 });
  }
  const response = NextResponse.redirect(authUrl);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 600,
  });
  if (catalogueId) {
    response.cookies.set(INSTALL_CATALOGUE_COOKIE, catalogueId, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 600,
    });
  }
  return response;
}
