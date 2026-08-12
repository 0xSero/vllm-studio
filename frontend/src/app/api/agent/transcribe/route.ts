import { NextRequest } from "next/server";
import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dictation reaches a local binary and the microphone, so it gets the same
// token re-check the terminal and git routes use rather than relying on the
// edge gate alone.
const BODY_LIMIT_BYTES = 25 * 1024 * 1024;

export async function POST(request: NextRequest): Promise<Response> {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  return proxyToAgentRuntime(request, { bodyLimitBytes: BODY_LIMIT_BYTES });
}
