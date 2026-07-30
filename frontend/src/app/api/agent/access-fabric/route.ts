import { NextResponse, type NextRequest } from "next/server";
import { Effect, Schema } from "effect";
import { AccessFabricSaveSchema } from "@local-studio/agent-runtime/access-fabric-contract";
import {
  AccessFabricError,
  getAccessFabricState,
  saveAccessFabric,
} from "@local-studio/agent-runtime/access-fabric-service";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const failure = (error: unknown, fallbackStatus = 500) =>
  NextResponse.json(
    { error: error instanceof Error ? error.message : "Access fabric request failed" },
    { status: error instanceof AccessFabricError ? error.status : fallbackStatus },
  );

export async function GET(request: NextRequest) {
  const denied = await requireApiAccess(request);
  if (denied) return denied;
  try {
    return NextResponse.json(await Effect.runPromise(getAccessFabricState()));
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: NextRequest) {
  const denied = await requireApiAccess(request);
  if (denied) return denied;
  try {
    const input = Schema.decodeUnknownSync(AccessFabricSaveSchema)(await request.json());
    return NextResponse.json(await Effect.runPromise(saveAccessFabric(input)));
  } catch (error) {
    return failure(error, 400);
  }
}
