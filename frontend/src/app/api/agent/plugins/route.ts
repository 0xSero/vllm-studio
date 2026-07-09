import { NextResponse } from "next/server";
import { Effect } from "effect";
import { listPluginRuntimeViews } from "@local-studio/agent-runtime/plugin-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const plugins = await Effect.runPromise(listPluginRuntimeViews());
  return NextResponse.json({ plugins });
}
