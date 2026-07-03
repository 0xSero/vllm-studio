import { NextResponse, type NextRequest } from "next/server";
import { getPooledConnection } from "@local-studio/agent-runtime/connector-pool";
import { enabledConnectors } from "@local-studio/agent-runtime/connectors-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tool inventory for the pi bridge extension: every enabled connector's tools. */
export async function GET() {
  const connectors = await enabledConnectors();
  const inventory = await Promise.all(
    connectors.map(async (connector) => {
      try {
        const connection = await getPooledConnection(connector.id);
        const tools = await connection.listTools();
        return { id: connector.id, name: connector.name, tools };
      } catch (error) {
        return {
          id: connector.id,
          name: connector.name,
          tools: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  return NextResponse.json({ connectors: inventory });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    connector_id?: string;
    tool?: string;
    args?: Record<string, unknown>;
  };
  if (!body.connector_id || !body.tool) {
    return NextResponse.json({ error: "connector_id and tool are required" }, { status: 400 });
  }
  try {
    const connection = await getPooledConnection(body.connector_id);
    const result = await connection.callTool(body.tool, body.args ?? {});
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
