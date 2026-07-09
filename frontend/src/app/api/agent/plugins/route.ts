import { NextResponse } from "next/server";
import { Effect } from "effect";
import { discoverPlugins } from "@local-studio/agent-runtime/plugin-discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const plugins = await Effect.runPromise(discoverPlugins());
  return NextResponse.json({ plugins });
}
