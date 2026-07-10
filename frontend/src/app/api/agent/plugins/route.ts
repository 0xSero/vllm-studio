import { NextResponse, type NextRequest } from "next/server";
import { Effect } from "effect";
import { listPluginRuntimeViews } from "@local-studio/agent-runtime/plugin-runtime";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const plugins = await Effect.runPromise(listPluginRuntimeViews());
  return NextResponse.json({ plugins });
}
