import { NextRequest } from "next/server";
import { piRuntimeManager } from "@local-studio/agent-runtime/pi-runtime";
import { replayAfterCursor } from "../events/stream-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim() || "default";
  const piSessionId = request.nextUrl.searchParams.get("piSessionId")?.trim() || null;
  const after = Number(request.nextUrl.searchParams.get("after") ?? 0);
  const resolved = piRuntimeManager.findSessionForLookup(sessionId, piSessionId);
  if (!resolved) {
    return Response.json({ sessionId, status: null, events: [] });
  }
  const afterSeq = replayAfterCursor(
    Number.isFinite(after) ? after : 0,
    resolved.session.status.eventSeq,
  );
  return Response.json({
    sessionId: resolved.sessionId,
    status: resolved.session.status,
    events: resolved.session.getEventsAfter(afterSeq),
  });
}
