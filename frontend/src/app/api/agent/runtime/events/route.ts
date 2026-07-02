// Runtime SSE stream. In-process (env unset) this is a locally-generated
// ReadableStream — fine under `next dev`, but Next's standalone server buffers
// it. With LOCAL_STUDIO_AGENT_RUNTIME_URL set, the stream is proxied from the
// standalone agent-runtime process and passes through unbuffered.
import { NextRequest } from "next/server";
import { handleRuntimeEvents } from "@local-studio/agent-runtime/http/handlers";
import { proxyToAgentRuntime } from "@/app/api/agent/proxy-to-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  return (await proxyToAgentRuntime(request)) ?? handleRuntimeEvents(request);
}
