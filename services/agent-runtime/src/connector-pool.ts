import { Effect } from "effect";
import { connectMcp, type McpConnection, type McpToolInfo } from "./mcp-client";
import { connectorAuthorizationHeaders } from "./connector-auth";
import { listConnectors, type ConnectorConfig } from "./connectors-service";
import {
  closeSnapshotConnection,
  closePooledConnection,
  getOrCreatePooledConnection,
  trackSnapshotConnection,
} from "./connector-pool-state";
import { withPluginExecutionSnapshotLifecycle } from "./plugin-execution-snapshot";

export { closePooledConnection } from "./connector-pool-state";

export class ConnectorToolDeniedError extends Error {}

const toTarget = (connector: ConnectorConfig, signal?: AbortSignal) => {
  if (connector.transport === "stdio") {
    return {
      transport: "stdio" as const,
      command: connector.command ?? "",
      args: [...(connector.args ?? [])],
      env: connector.env ?? {},
      ...(connector.cwd ? { cwd: connector.cwd } : {}),
    };
  }
  return {
    transport: "http" as const,
    url: connector.url ?? "",
    headers: connector.headers ?? {},
    ...(connector.auth
      ? {
          authorize: (forceRefresh: boolean) =>
            connectorAuthorizationHeaders(connector, forceRefresh),
        }
      : {}),
    ...(signal ? { signal } : {}),
  };
};

async function enabledConnector(connectorId: string): Promise<ConnectorConfig> {
  const connector = (await listConnectors()).find((entry) => entry.id === connectorId);
  if (!connector) throw new Error(`Unknown connector "${connectorId}"`);
  if (!connector.enabled) throw new Error(`Connector "${connectorId}" is disabled`);
  return connector;
}

function allowedTools(connector: ConnectorConfig, tools: McpToolInfo[]): McpToolInfo[] {
  if (!connector.allowTools) return tools;
  const allow = new Set(connector.allowTools);
  return tools.filter((tool) => allow.has(tool.name));
}

function assertToolAllowed(connector: ConnectorConfig, tool: string): void {
  if (!connector.allowTools || connector.allowTools.includes(tool)) return;
  throw new ConnectorToolDeniedError(
    `Tool "${tool}" is not allowed for connector "${connector.id}"`,
  );
}

export async function getPooledConnection(connectorId: string): Promise<McpConnection> {
  return getOrCreatePooledConnection(connectorId, async () => {
    const connector = await enabledConnector(connectorId);
    return connectMcp(toTarget(connector));
  });
}

export async function listConnectorTools(connectorId: string): Promise<McpToolInfo[]> {
  const connector = await enabledConnector(connectorId);
  try {
    const connection = await getPooledConnection(connectorId);
    return allowedTools(connector, await connection.listTools());
  } catch (error) {
    await closePooledConnection(connectorId).catch(() => undefined);
    throw error;
  }
}

export async function callConnectorTool(
  connectorId: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const connector = await enabledConnector(connectorId);
  assertToolAllowed(connector, tool);
  try {
    return await (await getPooledConnection(connectorId)).callTool(tool, args);
  } catch (error) {
    await closePooledConnection(connectorId).catch(() => undefined);
    throw error;
  }
}

export async function probeConnector(
  connector: ConnectorConfig,
  signal?: AbortSignal,
  snapshotBound = false,
): Promise<{ ok: boolean; tools: McpToolInfo[]; error?: string }> {
  let connection: McpConnection | null = null;
  let closeOnAbort: (() => void) | undefined;
  try {
    connection = connectMcp(toTarget(connector, signal));
    if (snapshotBound) {
      trackSnapshotConnection(connection);
      const tracked = connection;
      closeOnAbort = () => void closeSnapshotConnection(tracked).catch(() => undefined);
      signal?.addEventListener("abort", closeOnAbort, { once: true });
    }
    const tools = await connection.listTools();
    return { ok: true, tools };
  } catch (error) {
    return { ok: false, tools: [], error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (closeOnAbort) signal?.removeEventListener("abort", closeOnAbort);
    if (connection) {
      if (snapshotBound) await closeSnapshotConnection(connection);
      else await connection.close().catch(() => undefined);
    }
  }
}

export function probePersistedConnector(
  connector: ConnectorConfig,
  signal?: AbortSignal,
): Promise<{ ok: boolean; tools: McpToolInfo[]; error?: string }> {
  if (connector.origin?.kind !== "plugin") return probeConnector(connector, signal);
  return Effect.runPromise(
    withPluginExecutionSnapshotLifecycle(() =>
      Effect.tryPromise({
        try: (lifecycleSignal) =>
          probeConnector(
            connector,
            signal ? AbortSignal.any([signal, lifecycleSignal]) : lifecycleSignal,
            true,
          ),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
    ),
  );
}
