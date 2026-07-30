import { NextResponse, type NextRequest } from "next/server";
import { Effect } from "effect";
import {
  AccessFabricError,
  planAccessFabric,
} from "@local-studio/agent-runtime/access-fabric-service";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const denied = await requireApiAccess(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await Effect.runPromise(planAccessFabric()));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Access fabric plan failed" },
      { status: error instanceof AccessFabricError ? error.status : 500 },
    );
  }
}
