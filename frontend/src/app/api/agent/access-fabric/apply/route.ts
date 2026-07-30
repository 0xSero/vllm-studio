import { NextResponse, type NextRequest } from "next/server";
import { Effect } from "effect";
import { httpAccessFabricTransport } from "@local-studio/agent-runtime/access-fabric-http";
import {
  AccessFabricError,
  applyAccessFabric,
  offboardAccessFabric,
} from "@local-studio/agent-runtime/access-fabric-service";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const run = async (request: NextRequest, operation: "apply" | "offboard") => {
  const denied = await requireApiAccess(request);
  if (denied) return denied;
  try {
    const effect =
      operation === "apply"
        ? applyAccessFabric(httpAccessFabricTransport)
        : offboardAccessFabric(httpAccessFabricTransport);
    return NextResponse.json(await Effect.runPromise(effect));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Access fabric operation failed" },
      { status: error instanceof AccessFabricError ? error.status : 500 },
    );
  }
};

export const POST = (request: NextRequest) => run(request, "apply");
export const DELETE = (request: NextRequest) => run(request, "offboard");
