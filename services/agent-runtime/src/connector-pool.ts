import { connectMcp, type McpConnection, type McpToolInfo } from "./mcp-client";
import { connectorAuthorizationHeaders, googleWorkspaceConnectorAuth } from "./connector-auth";
import { listConnectors, type ConnectorConfig } from "./connectors-service";
import { googleWorkspaceConnection } from "./google-account";
import { googleWorkspaceEndpointTransport } from "./google-workspace-binding";

const pool = new Map<string, McpConnection>();

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

/**
 * A signed-in Google account is served by an in-process REST adapter or by
 * Google's MCP preview, depending on how the row was written. Both satisfy the
 * same connection interface, so the pool, the tool allow list, and the callers
 * above are identical either way.
 */
function openConnection(connector: ConnectorConfig, signal?: AbortSignal): McpConnection {
  const identity = googleWorkspaceConnectorAuth(connector);
  if (identity) {
    return googleWorkspaceConnection({
      service: identity.service,
      transport: googleWorkspaceEndpointTransport(identity.service, connector.url ?? ""),
      authorize: (forceRefresh: boolean) => connectorAuthorizationHeaders(connector, forceRefresh),
      ...(signal ? { signal } : {}),
    });
  }
  return connectMcp(toTarget(connector, signal));
}

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
  const existing = pool.get(connectorId);
  if (existing) return existing;
  const connector = await enabledConnector(connectorId);
  const connection = openConnection(connector);
  pool.set(connectorId, connection);
  return connection;
}

export function closePooledConnection(connectorId: string): void {
  const connection = pool.get(connectorId);
  if (!connection) return;
  pool.delete(connectorId);
  connection.close();
}

export async function listConnectorTools(connectorId: string): Promise<McpToolInfo[]> {
  const connector = await enabledConnector(connectorId);
  try {
    const connection = await getPooledConnection(connectorId);
    return allowedTools(connector, await connection.listTools());
  } catch (error) {
    closePooledConnection(connectorId);
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
    closePooledConnection(connectorId);
    throw error;
  }
}

export async function probeConnector(
  connector: ConnectorConfig,
  signal?: AbortSignal,
): Promise<{ ok: boolean; tools: McpToolInfo[]; error?: string }> {
  let connection: McpConnection | null = null;
  try {
    connection = openConnection(connector, signal);
    const tools = await connection.listTools();
    return { ok: true, tools };
  } catch (error) {
    return { ok: false, tools: [], error: error instanceof Error ? error.message : String(error) };
  } finally {
    connection?.close();
  }
}
