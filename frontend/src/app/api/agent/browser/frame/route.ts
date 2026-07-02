// Frame poll for the visible browser panel (~10fps JSON poll; see
// browser-handlers.ts for why this is a poll and not SSE).
import { NextRequest } from "next/server";
import { handleBrowserFrame } from "@local-studio/agent-runtime/http/browser-handlers";
import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  return (await proxyToAgentRuntime(request)) ?? handleBrowserFrame();
}
