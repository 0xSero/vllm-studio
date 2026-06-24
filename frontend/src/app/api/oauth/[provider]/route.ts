import { NextRequest } from "next/server";
import {
  disconnectOAuth,
  getOAuthStatus,
  saveOAuthClient,
} from "@/features/agent/oauth/oauth-store";
import { getOAuthProvider } from "@/features/agent/oauth/oauth-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ provider: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { provider } = await context.params;
  if (!getOAuthProvider(provider)) {
    return Response.json({ error: "Unknown OAuth provider." }, { status: 404 });
  }
  return Response.json(await getOAuthStatus(provider));
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { provider } = await context.params;
  if (!getOAuthProvider(provider)) {
    return Response.json({ error: "Unknown OAuth provider." }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    clientId?: unknown;
    clientSecret?: unknown;
  } | null;
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.action === "save_client") {
    if (typeof body.clientId !== "string" || typeof body.clientSecret !== "string") {
      return Response.json({ error: "clientId and clientSecret are required." }, { status: 400 });
    }
    await saveOAuthClient(provider, body.clientId, body.clientSecret);
    return Response.json(await getOAuthStatus(provider));
  }

  if (body.action === "disconnect") {
    await disconnectOAuth(provider);
    return Response.json(await getOAuthStatus(provider));
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}
