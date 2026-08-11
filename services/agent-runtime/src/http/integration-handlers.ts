import { Effect, Schema } from "effect";
import { ConnectorTestInputSchema, ConnectorUpsertInputSchema } from "../connector-contract";
import {
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
  disconnectGoogleAccount,
  getGoogleAccount,
  GoogleAccountError,
  saveGoogleClient,
} from "../google-account";
import {
  beginGoogleLoopbackAuthorization,
  cancelGoogleLoopbackAuthorization,
} from "../google-oauth-loopback";
import { disableGoogleWorkspaceAdapter } from "../google-workspace-adapter";
import {
  GOOGLE_WORKSPACE_BINDINGS,
  GOOGLE_WORKSPACE_PLUGIN_IDS,
} from "../google-workspace-binding";
import { refreshEnabledPluginConnectors } from "../plugin-runtime";
import { resolveBundledMcpServerPath } from "../pi-runtime-helpers";

const GoogleClientInputSchema = Schema.Struct({
  clientId: Schema.String,
  clientSecret: Schema.optional(Schema.String),
});
const GoogleAccountInputSchema = Schema.Struct({
  account: Schema.Union([Schema.Literal("gmail"), Schema.Literal("google-calendar")]),
});
const ConnectorToolCallSchema = Schema.Struct({
  connector_id: Schema.String,
  tool: Schema.String,
  args: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

const failure = (error: unknown, fallback: string, status = 500): Response =>
  Response.json({ error: error instanceof Error ? error.message : fallback }, { status });

async function decode<T>(request: Request, schema: Schema.ConstraintDecoder<T>): Promise<T | null> {
  try {
    return Schema.decodeUnknownSync(schema)(await request.json());
  } catch {
    return null;
  }
}

function googleFailure(error: unknown, fallback: string): Response {
  return failure(error, fallback, error instanceof GoogleAccountError ? error.status : 500);
}

function closeGoogleConnections(): void {
  GOOGLE_WORKSPACE_PLUGIN_IDS.forEach((id) =>
    closePooledConnection(GOOGLE_WORKSPACE_BINDINGS[id].connectorId),
  );
}

export async function handleGoogleAccountGet(): Promise<Response> {
  try {
    return Response.json({ account: await Effect.runPromise(getGoogleAccount()) });
  } catch (error) {
    return googleFailure(error, "Google account failed");
  }
}

export async function handleGoogleAccountPut(request: Request): Promise<Response> {
  const input = await decode(request, GoogleClientInputSchema);
  if (!input) return Response.json({ error: "clientId must be a string" }, { status: 400 });
  try {
    return Response.json({ account: await Effect.runPromise(saveGoogleClient(input)) });
  } catch (error) {
    return googleFailure(error, "Google account failed");
  } finally {
    closeGoogleConnections();
  }
}

export async function handleGoogleAccountDelete(request: Request): Promise<Response> {
  const input = await decode(request, GoogleAccountInputSchema);
  if (!input) return Response.json({ error: "account is required" }, { status: 400 });
  try {
    const account = await Effect.runPromise(
      Effect.gen(function* () {
        const disconnected = yield* disconnectGoogleAccount(input.account);
        yield* disableGoogleWorkspaceAdapter(input.account).pipe(
          Effect.mapError((error) => new GoogleAccountError(500, error.message)),
        );
        return disconnected;
      }),
    );
    return Response.json({ account });
  } catch (error) {
    return googleFailure(error, "Google account failed");
  } finally {
    closeGoogleConnections();
  }
}

export async function handleGoogleAuthorize(request: Request): Promise<Response> {
  const input = await decode(request, GoogleAccountInputSchema);
  if (!input) return Response.json({ error: "account is required" }, { status: 400 });
  try {
    return Response.json(await Effect.runPromise(beginGoogleLoopbackAuthorization(input.account)));
  } catch (error) {
    return googleFailure(error, "Google sign-in failed");
  }
}

export async function handleGoogleAuthorizeDelete(request: Request): Promise<Response> {
  const input = await decode(request, GoogleAccountInputSchema);
  if (!input) return Response.json({ error: "account is required" }, { status: 400 });
  try {
    await Effect.runPromise(cancelGoogleLoopbackAuthorization(input.account));
    return Response.json({ cancelled: true });
  } catch (error) {
    return googleFailure(error, "Google sign-in cancellation failed");
  }
}

const connectorViews = async () => (await listConnectors()).map(toConnectorView);

export async function handleConnectorsGet(): Promise<Response> {
  return Response.json({ connectors: await connectorViews() });
}

export async function handleConnectorsPost(request: Request): Promise<Response> {
  const body = await decode(request, ConnectorUpsertInputSchema);
  if (!body) return Response.json({ error: "invalid connector payload" }, { status: 400 });
  if (!isValidConnectorId(body.id))
    return Response.json({ error: "invalid connector id" }, { status: 400 });
  if (body.transport === "stdio" && !body.command)
    return Response.json({ error: "command is required for stdio" }, { status: 400 });
  if (body.transport === "http" && !body.url)
    return Response.json({ error: "url is required for http" }, { status: 400 });
  const connector: ConnectorConfig = {
    id: body.id,
    name: body.name?.trim() || body.id,
    transport: body.transport,
    ...(body.command ? { command: body.command } : {}),
    ...(body.args ? { args: body.args } : {}),
    ...(body.env ? { env: body.env } : {}),
    ...(body.cwd ? { cwd: body.cwd } : {}),
    ...(body.url ? { url: body.url } : {}),
    ...(body.headers ? { headers: body.headers } : {}),
    ...(body.allowTools ? { allowTools: body.allowTools } : {}),
    enabled: body.enabled ?? true,
  };
  try {
    const connectors = await upsertConnector(connector);
    closePooledConnection(connector.id);
    return Response.json({ connectors: connectors.map(toConnectorView) });
  } catch (error) {
    return failure(error, "Connector could not be saved", 409);
  }
}

export async function handleConnectorsDelete(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });
  try {
    const connectors = await removeConnector(id);
    closePooledConnection(id);
    return Response.json({ connectors: connectors.map(toConnectorView) });
  } catch (error) {
    return failure(error, "Connector could not be removed", 409);
  }
}

export async function handleConnectorInventory(): Promise<Response> {
  await Effect.runPromise(refreshEnabledPluginConnectors());
  const inventory = await Promise.all(
    (await enabledConnectors()).map(async (connector) => {
      try {
        return {
          id: connector.id,
          name: connector.name,
          tools: await listConnectorTools(connector.id),
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
  const body = await decode(request, ConnectorToolCallSchema);
  if (!body?.connector_id.trim() || !body.tool.trim())
    return Response.json({ error: "connector_id and tool are required" }, { status: 400 });
  try {
    return Response.json({
      ok: true,
      result: await callConnectorTool(body.connector_id, body.tool, body.args ?? {}),
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: error instanceof ConnectorToolDeniedError ? 403 : 500 },
    );
  }
}

export async function handleConnectorTest(request: Request): Promise<Response> {
  const body = await decode(request, ConnectorTestInputSchema);
  if (!body) return Response.json({ error: "id is required" }, { status: 400 });
  const connector = (await listConnectors()).find((entry) => entry.id === body.id);
  if (!connector) return Response.json({ error: "unknown connector" }, { status: 404 });
  const result = await probeConnector(connector);
  return Response.json({
    ok: result.ok,
    tool_count: result.tools.length,
    tool_names: result.tools.map((tool) => tool.name).slice(0, 40),
    ...(result.error ? { error: result.error } : {}),
  });
}

export function handleConnectorSshPath(): Response {
  return Response.json({ path: resolveBundledMcpServerPath("ssh-remote.mjs") });
}
