import { NextResponse, type NextRequest } from "next/server";
import { Schema } from "effect";
import {
  callConnectorTool,
  ConnectorToolDeniedError,
  listConnectorTools,
} from "@local-studio/agent-runtime/connector-pool";
import { enabledConnectors } from "@local-studio/agent-runtime/connectors-service";
import {
  isConnectorToolGranted,
  listConnectorGrants,
  resolveGrantedTools,
} from "@local-studio/agent-runtime/connector-grants";
import { requireApiAccess } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ConnectorToolCallSchema = Schema.Struct({
  connector_id: Schema.String,
  tool: Schema.String,
  args: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  model_id: Schema.optional(Schema.String),
});

/**
 * The session's model, as claimed by the caller. It decides which connector
 * tools are offered and which calls are allowed. An unnamed model matches only
 * the `*` grants, so an older extension that does not send one keeps whatever
 * blanket access the user left in place and gains nothing else.
 */
const callerModelId = (value: string | null | undefined): string => value?.trim() ?? "";

export async function GET(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;
  const modelId = callerModelId(request.nextUrl.searchParams.get("model_id"));
  const grants = await listConnectorGrants();
  const granted = (await enabledConnectors()).flatMap((connector) => {
    const tools = resolveGrantedTools(grants, modelId, connector.id);
    return tools === "all" || tools.length ? [{ connector, tools }] : [];
  });
  const inventory = await Promise.all(
    granted.map(async ({ connector, tools }) => {
      try {
        const available = await listConnectorTools(connector.id);
        return {
          id: connector.id,
          name: connector.name,
          tools:
            tools === "all" ? available : available.filter((tool) => tools.includes(tool.name)),
        };
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
  const denied = requireApiAccess(request);
  if (denied) return denied;
  let body: typeof ConnectorToolCallSchema.Type;
  try {
    body = Schema.decodeUnknownSync(ConnectorToolCallSchema)(await request.json());
  } catch {
    return NextResponse.json({ error: "connector_id and tool are required" }, { status: 400 });
  }
  if (!body.connector_id.trim() || !body.tool.trim()) {
    return NextResponse.json({ error: "connector_id and tool are required" }, { status: 400 });
  }
  try {
    // Filtering the inventory only decides what the model is told about; the
    // grant is re-checked here because this route is the actual boundary.
    const grants = await listConnectorGrants();
    if (
      !isConnectorToolGranted(grants, callerModelId(body.model_id), body.connector_id, body.tool)
    ) {
      throw new ConnectorToolDeniedError(
        `Model is not granted "${body.tool}" on connector "${body.connector_id}"`,
      );
    }
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
