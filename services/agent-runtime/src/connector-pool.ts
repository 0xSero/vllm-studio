import { connectMcp, type McpConnection, type McpToolInfo } from "./mcp-client";
import { connectorAuthorizationHeaders } from "./connector-auth";
import { listConnectors, type ConnectorConfig } from "./connectors-service";

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

async function enabledConnector(connectorId: string): Promise<ConnectorConfig> {
  const connector = (await listConnectors()).find((entry) => entry.id === connectorId);
  if (!connector) throw new Error(`Unknown connector "${connectorId}"`);
  if (!connector.enabled || connector.permissionReviewed !== true) {
    throw new Error(`Connector "${connectorId}" is disabled`);
  }
  return connector;
}

export function filterAllowedConnectorTools(
  connector: ConnectorConfig,
  tools: McpToolInfo[],
): McpToolInfo[] {
  if (connector.permissionReviewed !== true) return [];
  const allow = new Set(connector.allowTools ?? []);
  return tools.filter((tool) => allow.has(tool.name));
}

export function assertConnectorToolAllowed(connector: ConnectorConfig, tool: string): void {
  if (connector.permissionReviewed === true && connector.allowTools?.includes(tool)) return;
  throw new ConnectorToolDeniedError(
    `Tool "${tool}" is not allowed for connector "${connector.id}"`,
  );
}

export async function getPooledConnection(connectorId: string): Promise<McpConnection> {
  const existing = pool.get(connectorId);
  if (existing) return existing;
  const connector = await enabledConnector(connectorId);
  const connection = connectMcp(toTarget(connector));
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
    return filterAllowedConnectorTools(connector, await connection.listTools());
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
  assertConnectorToolAllowed(connector, tool);
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
    connection = connectMcp(toTarget(connector, signal));
    const tools = await connection.listTools();
    return { ok: true, tools };
  } catch (error) {
    return { ok: false, tools: [], error: error instanceof Error ? error.message : String(error) };
  } finally {
    connection?.close();
  }
}
