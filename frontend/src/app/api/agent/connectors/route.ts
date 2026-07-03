import { NextResponse, type NextRequest } from "next/server";
import {
  isValidConnectorId,
  listConnectors,
  removeConnector,
  toConnectorView,
  upsertConnector,
  type ConnectorConfig,
} from "@local-studio/agent-runtime/connectors-service";
import { closePooledConnection } from "@local-studio/agent-runtime/connector-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const connectors = await listConnectors();
  return NextResponse.json({ connectors: connectors.map(toConnectorView) });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Partial<ConnectorConfig>;
  if (!body.id || !isValidConnectorId(body.id)) {
    return NextResponse.json({ error: "invalid connector id" }, { status: 400 });
  }
  if (body.transport !== "stdio" && body.transport !== "http") {
    return NextResponse.json({ error: "transport must be stdio or http" }, { status: 400 });
  }
  if (body.transport === "stdio" && !body.command) {
    return NextResponse.json({ error: "command is required for stdio" }, { status: 400 });
  }
  if (body.transport === "http" && !body.url) {
    return NextResponse.json({ error: "url is required for http" }, { status: 400 });
  }
  const connector: ConnectorConfig = {
    id: body.id,
    name: body.name?.trim() || body.id,
    transport: body.transport,
    ...(body.command ? { command: body.command } : {}),
    ...(body.args ? { args: body.args } : {}),
    ...(body.env ? { env: body.env } : {}),
    ...(body.url ? { url: body.url } : {}),
    ...(body.headers ? { headers: body.headers } : {}),
    enabled: body.enabled ?? true,
  };
  const connectors = await upsertConnector(connector);
  closePooledConnection(connector.id);
  return NextResponse.json({ connectors: connectors.map(toConnectorView) });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const connectors = await removeConnector(id);
  closePooledConnection(id);
  return NextResponse.json({ connectors: connectors.map(toConnectorView) });
}
