import { NextRequest, NextResponse } from "next/server";
import { piRuntimeManager } from "@local-studio/agent-runtime/pi-runtime";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { sessionId?: string };
  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId.trim() : "default";
  await piRuntimeManager.getSession(sessionId).abort();
  return NextResponse.json({ ok: true });
}
