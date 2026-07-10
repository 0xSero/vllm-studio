import { NextRequest } from "next/server";
import { handleAgentTurn } from "@local-studio/agent-runtime/http/handlers";
import { requireApiAccess } from "@/lib/auth/guard";
import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";
import { AGENT_TURN_BODY_LIMIT_BYTES } from "@shared/agent/agent-turn-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  return (
    (await proxyToAgentRuntime(request, { bodyLimitBytes: AGENT_TURN_BODY_LIMIT_BYTES })) ??
    handleAgentTurn(request)
  );
}
