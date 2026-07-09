import { NextResponse, type NextRequest } from "next/server";
import {
  callConnectorTool,
  ConnectorToolDeniedError,
  listConnectorTools,
} from "@local-studio/agent-runtime/connector-pool";
import { enabledConnectors } from "@local-studio/agent-runtime/connectors-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const connectors = await enabledConnectors();
  const inventory = await Promise.all(
    connectors.map(async (connector) => {
      try {
        const tools = await listConnectorTools(connector.id);
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
    const result = await callConnectorTool(body.connector_id, body.tool, body.args ?? {});
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const status = error instanceof ConnectorToolDeniedError ? 403 : 500;
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status },
    );
  }
}
