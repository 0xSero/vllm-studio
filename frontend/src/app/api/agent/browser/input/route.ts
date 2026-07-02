import { NextRequest } from "next/server";
import { handleBrowserInput } from "@local-studio/agent-runtime/http/browser-handlers";
import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<Response> {
  return (await proxyToAgentRuntime(request)) ?? handleBrowserInput(request);
}
