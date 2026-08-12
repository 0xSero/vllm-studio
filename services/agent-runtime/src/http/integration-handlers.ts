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
import { decodeJson, jsonEffect, jsonError, jsonTask } from "./helpers";

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

const googleFailure = (fallback: string) => ({
  fallback,
  status: (error: unknown) => (error instanceof GoogleAccountError ? error.status : 500),
});

function closeGoogleConnections(): void {
  GOOGLE_WORKSPACE_PLUGIN_IDS.forEach((id) =>
    closePooledConnection(GOOGLE_WORKSPACE_BINDINGS[id].connectorId),
  );
}

export async function handleGoogleAccountGet(): Promise<Response> {
  return jsonEffect(getGoogleAccount(), (account) => ({ account }), googleFailure("Google account failed"));
}

export async function handleGoogleAccountPut(request: Request): Promise<Response> {
  const input = await decodeJson(request, GoogleClientInputSchema);
  if (!input) return jsonError("clientId must be a string");
  return jsonEffect(
    saveGoogleClient(input).pipe(Effect.ensuring(Effect.sync(closeGoogleConnections))),
    (account) => ({ account }),
    googleFailure("Google account failed"),
  );
}

export async function handleGoogleAccountDelete(request: Request): Promise<Response> {
  const input = await decodeJson(request, GoogleAccountInputSchema);
  if (!input) return jsonError("account is required");
  return jsonEffect(
    Effect.gen(function* () {
        const disconnected = yield* disconnectGoogleAccount(input.account);
        yield* disableGoogleWorkspaceAdapter(input.account).pipe(
          Effect.mapError((error) => new GoogleAccountError(500, error.message)),
        );
        return disconnected;
      }).pipe(Effect.ensuring(Effect.sync(closeGoogleConnections))),
    (account) => ({ account }),
    googleFailure("Google account failed"),
  );
}

export async function handleGoogleAuthorize(request: Request): Promise<Response> {
  const input = await decodeJson(request, GoogleAccountInputSchema);
  if (!input) return jsonError("account is required");
  return jsonEffect(
    beginGoogleLoopbackAuthorization(input.account),
    (authorization) => authorization,
    googleFailure("Google sign-in failed"),
  );
}

export async function handleGoogleAuthorizeDelete(request: Request): Promise<Response> {
  const input = await decodeJson(request, GoogleAccountInputSchema);
  if (!input) return jsonError("account is required");
  return jsonEffect(
    cancelGoogleLoopbackAuthorization(input.account),
    () => ({ cancelled: true }),
    googleFailure("Google sign-in cancellation failed"),
  );
}

const connectorViews = async () => (await listConnectors()).map(toConnectorView);

export async function handleConnectorsGet(): Promise<Response> {
  return Response.json({ connectors: await connectorViews() });
}

export async function handleConnectorsPost(request: Request): Promise<Response> {
  const body = await decodeJson(request, ConnectorUpsertInputSchema);
  if (!body) return jsonError("invalid connector payload");
  if (!isValidConnectorId(body.id)) return jsonError("invalid connector id");
  if (body.transport === "stdio" && !body.command) return jsonError("command is required for stdio");
  if (body.transport === "http" && !body.url) return jsonError("url is required for http");
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
  return jsonTask(
    async () => {
      const connectors = await upsertConnector(connector);
      closePooledConnection(connector.id);
      return connectors;
    },
    (connectors) => ({ connectors: connectors.map(toConnectorView) }),
    { fallback: "Connector could not be saved", status: 409 },
  );
}

export async function handleConnectorsDelete(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return jsonError("id is required");
  return jsonTask(
    async () => {
      const connectors = await removeConnector(id);
      closePooledConnection(id);
      return connectors;
    },
    (connectors) => ({ connectors: connectors.map(toConnectorView) }),
    { fallback: "Connector could not be removed", status: 409 },
  );
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
  const body = await decodeJson(request, ConnectorToolCallSchema);
  if (!body?.connector_id.trim() || !body.tool.trim())
    return jsonError("connector_id and tool are required");
  return jsonTask(
    () => callConnectorTool(body.connector_id, body.tool, body.args ?? {}),
    (result) => ({ ok: true, result }),
    {
      fallback: "Connector call failed",
      project: (error) =>
        Response.json(
          { ok: false, error: error instanceof Error ? error.message : String(error) },
          { status: error instanceof ConnectorToolDeniedError ? 403 : 500 },
        ),
    },
  );
}

export async function handleConnectorTest(request: Request): Promise<Response> {
  const body = await decodeJson(request, ConnectorTestInputSchema);
  if (!body) return jsonError("id is required");
  const connector = (await listConnectors()).find((entry) => entry.id === body.id);
  if (!connector) return jsonError("unknown connector", 404);
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
