import { piRuntimeManager } from "@/features/agent/pi-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    sessions: piRuntimeManager
      .listSessions()
      .map(({ sessionId, session }) => ({ sessionId, status: session.status })),
  });
}
