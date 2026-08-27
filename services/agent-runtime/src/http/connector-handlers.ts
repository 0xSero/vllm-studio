import { Schema } from "effect";
import { ConnectorTestInputSchema, ConnectorUpsertInputSchema } from "../connector-contract";
import {
  connectorToolPrefix,
  enabledConnectors,
  isValidConnectorId,
  listConnectors,
  removeConnector,
  toConnectorView,
  upsertConnector,
  type ConnectorConfig,
} from "../connectors-service";
import {
  callConnectorTool,
  closePooledConnection,
  ConnectorToolDeniedError,
  listConnectorTools,
  probeConnector,
} from "../connector-pool";
import {
  isConnectorToolGranted,
  listConnectorGrants,
  removeConnectorGrant,
  resolveGrantedTools,
  setConnectorGrant,
} from "../connector-grants";
import {
  ConnectorGrantInputSchema,
  ConnectorGrantRemovalSchema,
  type ConnectorGrantTarget,
} from "../connector-grants-contract";
import { resolveBundledResource } from "../plugin-resources";

export async function handleConnectorsList(): Promise<Response> {
  const connectors = await listConnectors();
  return Response.json({ connectors: connectors.map(toConnectorView) });
}

async function rejectionFor(
  body: typeof ConnectorUpsertInputSchema.Type,
): Promise<Response | null> {
  const reject = (error: string, status: number) => Response.json({ error }, { status });
  if (!isValidConnectorId(body.id)) return reject("invalid connector id", 400);
  if (body.transport === "stdio" && !body.command) {
    return reject("command is required for stdio", 400);
  }
  if (body.transport === "http") {
    if (!body.url) return reject("url is required for http", 400);
    if (!/^https?:\/\//i.test(body.url)) {
      return reject("url must start with http:// or https://", 400);
    }
  }
  const collision = (await listConnectors()).find(
    (entry) =>
      entry.id !== body.id && connectorToolPrefix(entry.id) === connectorToolPrefix(body.id),
  );
  return collision
    ? reject(`Tool names would collide with connector "${collision.id}"`, 409)
    : null;
}

function connectorFrom(body: typeof ConnectorUpsertInputSchema.Type): ConnectorConfig {
  const { allowTools, ...connector } = body;
  const result: ConnectorConfig = {
    ...connector,
    name: connector.name?.trim() || connector.id,
    enabled: connector.enabled ?? true,
  };
  return allowTools?.length ? { ...result, allowTools } : result;
}

export async function handleConnectorUpsert(request: Request): Promise<Response> {
  let body: typeof ConnectorUpsertInputSchema.Type;
  try {
    body = Schema.decodeUnknownSync(ConnectorUpsertInputSchema)(await request.json());
  } catch {
    return Response.json({ error: "invalid connector payload" }, { status: 400 });
  }
  const rejection = await rejectionFor(body);
  if (rejection) return rejection;
  const connector = connectorFrom(body);
  try {
    const connectors = await upsertConnector(connector);
    closePooledConnection(connector.id);
    return Response.json({ connectors: connectors.map(toConnectorView) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Connector could not be saved" },
      { status: 409 },
    );
  }
}

export async function handleConnectorDelete(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  try {
    const connectors = await removeConnector(id);
    closePooledConnection(id);
    return Response.json({ connectors: connectors.map(toConnectorView) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Connector could not be removed" },
      { status: 409 },
    );
  }
}

const ConnectorToolCallSchema = Schema.Struct({
  connector_id: Schema.String,
  tool: Schema.String,
  args: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  model_id: Schema.optional(Schema.String),
});

const callerModelId = (value: string | null | undefined): string => value?.trim() ?? "";

export async function handleConnectorInventory(request: Request): Promise<Response> {
  const modelId = callerModelId(new URL(request.url).searchParams.get("model_id"));
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
  return Response.json({ connectors: inventory });
}

export async function handleConnectorCall(request: Request): Promise<Response> {
  let body: typeof ConnectorToolCallSchema.Type;
  try {
    body = Schema.decodeUnknownSync(ConnectorToolCallSchema)(await request.json());
  } catch {
    return Response.json({ error: "connector_id and tool are required" }, { status: 400 });
  }
  if (!body.connector_id.trim() || !body.tool.trim()) {
    return Response.json({ error: "connector_id and tool are required" }, { status: 400 });
  }
  try {
    const grants = await listConnectorGrants();
    if (
      !isConnectorToolGranted(grants, callerModelId(body.model_id), body.connector_id, body.tool)
    ) {
      throw new ConnectorToolDeniedError(
        `Model is not granted "${body.tool}" on connector "${body.connector_id}"`,
      );
    }
    const result = await callConnectorTool(body.connector_id, body.tool, body.args ?? {});
    return Response.json({ ok: true, result });
  } catch (error) {
    const status = error instanceof ConnectorToolDeniedError ? 403 : 500;
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status },
    );
  }
}

function grantsFailure(error: Error | null, fallback: string): Response {
  return Response.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 500 },
  );
}

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

export async function handleConnectorGrantsGet(request: Request): Promise<Response> {
  try {
    const probeId = new URL(request.url).searchParams.get("connector")?.trim() || null;
    const [grants, connectors] = await Promise.all([listConnectorGrants(), grantTargets(probeId)]);
    return Response.json({ grants, connectors });
  } catch (error) {
    return grantsFailure(error instanceof Error ? error : null, "Connector grants failed");
  }
}

export async function handleConnectorGrantPut(request: Request): Promise<Response> {
  let input: typeof ConnectorGrantInputSchema.Type;
  try {
    input = Schema.decodeUnknownSync(ConnectorGrantInputSchema)(await request.json());
  } catch {
    return Response.json({ error: "modelId, connectorId and tools are required" }, { status: 400 });
  }
  if (!input.modelId.trim() || !input.connectorId.trim()) {
    return Response.json({ error: "modelId and connectorId are required" }, { status: 400 });
  }
  try {
    return Response.json({ grants: await setConnectorGrant(input) });
  } catch (error) {
    return grantsFailure(
      error instanceof Error ? error : null,
      "Connector grant could not be saved",
    );
  }
}

export async function handleConnectorGrantDelete(request: Request): Promise<Response> {
  let input: typeof ConnectorGrantRemovalSchema.Type;
  try {
    input = Schema.decodeUnknownSync(ConnectorGrantRemovalSchema)(await request.json());
  } catch {
    return Response.json({ error: "modelId and connectorId are required" }, { status: 400 });
  }
  try {
    return Response.json({
      grants: await removeConnectorGrant(input.modelId, input.connectorId),
    });
  } catch (error) {
    return grantsFailure(
      error instanceof Error ? error : null,
      "Connector grant could not be removed",
    );
  }
}

type ConnectorTestResponse = {
  ok: boolean;
  tool_count: number;
  tool_names: string[];
  error?: string;
};

export async function handleConnectorTest(request: Request): Promise<Response> {
  let body: typeof ConnectorTestInputSchema.Type;
  try {
    body = Schema.decodeUnknownSync(ConnectorTestInputSchema)(await request.json());
  } catch {
    return Response.json({ error: "id is required" }, { status: 400 });
  }
  const connector = (await listConnectors()).find((entry) => entry.id === body.id);
  if (!connector) return Response.json({ error: "unknown connector" }, { status: 404 });
  const result = await probeConnector(connector);
  const response: ConnectorTestResponse = {
    ok: result.ok,
    tool_count: result.tools.length,
    tool_names: result.tools.map((tool) => tool.name).slice(0, 40),
  };
  if (result.error) response.error = result.error;
  return Response.json(response);
}

export async function handleSshServerPath(): Promise<Response> {
  return Response.json({ path: resolveBundledResource("mcp", "ssh-remote.mjs") });
}
