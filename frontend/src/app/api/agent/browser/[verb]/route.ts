// Embedded browser verb dispatch for the pi agent's browser_* tools. The
// dispatch logic lives in the agent-runtime package
// (http/browser-handlers.ts) so this route and the standalone :8081 service
// share one implementation; with LOCAL_STUDIO_AGENT_RUNTIME_URL set the
// request proxies there instead (the browser host must live in the same
// process as the runtime that drives it).
import { NextRequest } from "next/server";
import { handleBrowserVerb } from "@local-studio/agent-runtime/http/browser-handlers";
import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ verb: string }> }) {
  const { verb } = await context.params;
  return (await proxyToAgentRuntime(request)) ?? handleBrowserVerb(request, verb);
}
