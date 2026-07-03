// Shared pool of live MCP connections keyed by connector id, so stdio servers
// (often `npx …`) spawn once per process instead of once per tool call.

import { connectMcp, type McpConnection, type McpToolInfo } from "./mcp-client";
import { listConnectors, type ConnectorConfig } from "./connectors-service";

const pool = new Map<string, McpConnection>();

const toTarget = (connector: ConnectorConfig) =>
  connector.transport === "stdio"
    ? {
        transport: "stdio" as const,
        command: connector.command ?? "",
        args: connector.args ?? [],
        env: connector.env ?? {},
      }
    : {
        transport: "http" as const,
        url: connector.url ?? "",
        headers: connector.headers ?? {},
      };

export async function getPooledConnection(connectorId: string): Promise<McpConnection> {
  const existing = pool.get(connectorId);
  if (existing) return existing;
  const connector = (await listConnectors()).find((entry) => entry.id === connectorId);
  if (!connector) throw new Error(`Unknown connector "${connectorId}"`);
  if (!connector.enabled) throw new Error(`Connector "${connectorId}" is disabled`);
  const connection = connectMcp(toTarget(connector));
  pool.set(connectorId, connection);
  return connection;
}

export function closePooledConnection(connectorId: string): void {
  const connection = pool.get(connectorId);
  if (connection) {
    pool.delete(connectorId);
    connection.close();
  }
}

/** One-shot connection for connectivity tests; never pooled. */
export async function probeConnector(
  connector: ConnectorConfig,
): Promise<{ ok: boolean; tools: McpToolInfo[]; error?: string }> {
  let connection: McpConnection | null = null;
  try {
    connection = connectMcp(toTarget(connector));
    const tools = await connection.listTools();
    return { ok: true, tools };
  } catch (error) {
    return { ok: false, tools: [], error: error instanceof Error ? error.message : String(error) };
  } finally {
    connection?.close();
  }
}
