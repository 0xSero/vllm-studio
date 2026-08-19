import { NextResponse, type NextRequest } from "next/server";
import { Schema } from "effect";
import { listConnectorTools } from "@local-studio/agent-runtime/connector-pool";
import { enabledConnectors } from "@local-studio/agent-runtime/connectors-service";
import {
  listConnectorGrants,
  removeConnectorGrant,
  setConnectorGrant,
} from "@local-studio/agent-runtime/connector-grants";
import {
  ConnectorGrantInputSchema,
  ConnectorGrantRemovalSchema,
  type ConnectorGrantTarget,
} from "@local-studio/agent-runtime/connector-grants-contract";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failure(error: unknown, fallback: string) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 500 },
  );
}

/**
 * The grant editor needs the tool names a connector actually serves. A
 * connector that cannot be reached right now still has to be listable, so a
 * failed probe degrades to an empty tool list rather than failing the request.
 */
async function grantTargets(): Promise<ConnectorGrantTarget[]> {
  return Promise.all(
    (await enabledConnectors()).map(async (connector) => {
      const tools = await listConnectorTools(connector.id).catch(() => []);
      return {
        id: connector.id,
        name: connector.name,
        tools: tools.map((tool) => tool.name),
      };
    }),
  );
}

export async function GET(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  try {
    const [grants, connectors] = await Promise.all([listConnectorGrants(), grantTargets()]);
    return NextResponse.json({ grants, connectors });
  } catch (error) {
    return failure(error, "Connector grants failed");
  }
}

export async function PUT(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  let input: typeof ConnectorGrantInputSchema.Type;
  try {
    input = Schema.decodeUnknownSync(ConnectorGrantInputSchema)(await request.json());
  } catch {
    return NextResponse.json(
      { error: "modelId, connectorId and tools are required" },
      { status: 400 },
    );
  }
  if (!input.modelId.trim() || !input.connectorId.trim()) {
    return NextResponse.json({ error: "modelId and connectorId are required" }, { status: 400 });
  }
  try {
    return NextResponse.json({ grants: await setConnectorGrant(input) });
  } catch (error) {
    return failure(error, "Connector grant could not be saved");
  }
}

export async function DELETE(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  let input: typeof ConnectorGrantRemovalSchema.Type;
  try {
    input = Schema.decodeUnknownSync(ConnectorGrantRemovalSchema)(await request.json());
  } catch {
    return NextResponse.json({ error: "modelId and connectorId are required" }, { status: 400 });
  }
  try {
    return NextResponse.json({
      grants: await removeConnectorGrant(input.modelId, input.connectorId),
    });
  } catch (error) {
    return failure(error, "Connector grant could not be removed");
  }
}
