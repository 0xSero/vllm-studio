import { NextRequest } from "next/server";
import { handleRuntimeSessions } from "@local-studio/agent-runtime/http/handlers";
import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  return (await proxyToAgentRuntime(request)) ?? handleRuntimeSessions();
}
