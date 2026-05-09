import { NextRequest } from "next/server";
import { piRuntimeManager } from "@/lib/agent/pi-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim() || "default";
  const after = Number(request.nextUrl.searchParams.get("after") ?? 0);
  const session = piRuntimeManager.getSession(sessionId);
  return Response.json({
    sessionId,
    status: session.status,
    events: session.getEventsAfter(Number.isFinite(after) ? after : 0),
  });
}
