import { NextResponse } from "next/server";
import { resolveBundledMcpServerPath } from "@local-studio/agent-runtime/pi-runtime-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ path: resolveBundledMcpServerPath("ssh-remote.mjs") });
}
