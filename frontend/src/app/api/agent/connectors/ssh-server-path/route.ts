import { NextResponse, type NextRequest } from "next/server";
import { resolveBundledMcpServerPath } from "@local-studio/agent-runtime/pi-runtime-helpers";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  return NextResponse.json({ path: resolveBundledMcpServerPath("ssh-remote.mjs") });
}
