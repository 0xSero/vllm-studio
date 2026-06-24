import { NextRequest } from "next/server";
import {
  disconnectGoogle,
  getGoogleStatus,
  saveGoogleClient,
} from "@/features/agent/oauth/google-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getGoogleStatus());
}

export async function POST(request: NextRequest) {
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
    await saveGoogleClient(body.clientId, body.clientSecret);
    return Response.json(await getGoogleStatus());
  }

  if (body.action === "disconnect") {
    await disconnectGoogle();
    return Response.json(await getGoogleStatus());
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}
