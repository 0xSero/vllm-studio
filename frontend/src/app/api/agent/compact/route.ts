import { NextRequest } from "next/server";
import { handleAgentCompact } from "@local-studio/agent-runtime/http/handlers";
import { requireApiAccess } from "@/lib/auth/guard";
import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  return (await proxyToAgentRuntime(request)) ?? handleAgentCompact(request);
}
