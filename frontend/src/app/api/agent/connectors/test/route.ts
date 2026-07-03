import { NextResponse, type NextRequest } from "next/server";
import { listConnectors } from "@local-studio/agent-runtime/connectors-service";
import { probeConnector } from "@local-studio/agent-runtime/connector-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { id?: string };
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const connector = (await listConnectors()).find((entry) => entry.id === body.id);
  if (!connector) return NextResponse.json({ error: "unknown connector" }, { status: 404 });
  const result = await probeConnector(connector);
  return NextResponse.json({
    ok: result.ok,
    tool_count: result.tools.length,
    tool_names: result.tools.map((tool) => tool.name).slice(0, 40),
    ...(result.error ? { error: result.error } : {}),
  });
}
