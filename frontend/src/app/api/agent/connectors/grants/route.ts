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
 * The grant targets.
 *
 * Probing a connector for its tool names OPENS it, and opening a stdio MCP
 * connector spawns its child process. Doing that for every enabled connector
 * just to render a list meant merely viewing this page executed every MCP
 * server the user had configured — so the probe is scoped to the one connector
 * being edited, and the list itself launches nothing.
 *
 * A connector that cannot be reached still has to be listable, so a failed
 * probe degrades to an empty tool list rather than failing the request.
 */
async function grantTargets(probeId: string | null): Promise<ConnectorGrantTarget[]> {
  return Promise.all(
    (await enabledConnectors()).map(async (connector) => {
      const tools =
        probeId === connector.id ? await listConnectorTools(connector.id).catch(() => []) : [];
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
    // ?connector=<id> asks for that connector's tool names; without it the
    // list is metadata only and nothing is executed.
    const probeId = request.nextUrl.searchParams.get("connector")?.trim() || null;
    const [grants, connectors] = await Promise.all([listConnectorGrants(), grantTargets(probeId)]);
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
