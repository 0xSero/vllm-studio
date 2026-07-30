import { NextResponse, type NextRequest } from "next/server";
import { Effect, Schema } from "effect";
import { AccessFabricCancelSessionSchema } from "@local-studio/agent-runtime/access-fabric-contract";
import { httpAccessFabricTransport } from "@local-studio/agent-runtime/access-fabric-http";
import {
  AccessFabricError,
  cancelAccessFabricBoundarySession,
} from "@local-studio/agent-runtime/access-fabric-service";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const denied = await requireApiAccess(request);
  if (denied) return denied;
  try {
    const { sessionId } = Schema.decodeUnknownSync(AccessFabricCancelSessionSchema)(
      await request.json(),
    );
    return NextResponse.json(
      await Effect.runPromise(
        cancelAccessFabricBoundarySession(sessionId, httpAccessFabricTransport),
      ),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Boundary session cancellation failed" },
      { status: error instanceof AccessFabricError ? error.status : 400 },
    );
  }
}
