import { Effect } from "effect";
import {
  GitHubConnectorArtifactError,
  assertGitHubConnectorReady,
  isManagedGitHubConnector,
  managedGitHubConnectorMatches,
} from "./connector-artifacts";
import { connectorAuthorizationHeaders } from "./connector-auth";
import { listConnectors, type ConnectorConfig } from "./connectors-service";
import { connectMcp, type McpConnection, type McpTarget, type McpToolInfo } from "./mcp-client";

export class ConnectorToolDeniedError extends Error {}

type ConnectorPoolDependencies = {
  loadConnectors: () => Promise<ConnectorConfig[]>;
  connect: (target: McpTarget) => McpConnection;
  verifyGitHub: (connector: ConnectorConfig, signal?: AbortSignal) => Promise<void>;
};

const toTarget = (connector: ConnectorConfig, signal?: AbortSignal): McpTarget => {
  if (connector.transport === "stdio") {
    return {
      transport: "stdio",
      command: connector.command ?? "",
      args: [...(connector.args ?? [])],
      env: connector.env ?? {},
      ...(connector.cwd ? { cwd: connector.cwd } : {}),
    };
  }
  return {
    transport: "http",
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

function assertConnectorConfiguration(connector: ConnectorConfig): void {
  if (isManagedGitHubConnector(connector) && !managedGitHubConnectorMatches(connector)) {
    throw new GitHubConnectorArtifactError(409, "GitHub connector configuration is invalid");
  }
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

export function makeConnectorPool(overrides: Partial<ConnectorPoolDependencies> = {}): {
  getPooledConnection(connectorId: string): Promise<McpConnection>;
  closePooledConnection(connectorId: string): Promise<void>;
  listConnectorTools(connectorId: string): Promise<McpToolInfo[]>;
  callConnectorTool(
    connectorId: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<unknown>;
  probeConnector(
    connector: ConnectorConfig,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; tools: McpToolInfo[]; error?: string }>;
} {
  const dependencies: ConnectorPoolDependencies = {
    loadConnectors: listConnectors,
    connect: connectMcp,
    verifyGitHub: (connector, signal) =>
      Effect.runPromise(assertGitHubConnectorReady(connector), { signal }),
    ...overrides,
  };
  const pool = new Map<string, McpConnection>();

  const enabledConnector = async (connectorId: string): Promise<ConnectorConfig> => {
    const connector = (await dependencies.loadConnectors()).find(
      (entry) => entry.id === connectorId,
    );
    if (!connector) throw new Error(`Unknown connector "${connectorId}"`);
    if (!connector.enabled) throw new Error(`Connector "${connectorId}" is disabled`);
    assertConnectorConfiguration(connector);
    return connector;
  };

  const connectionFor = async (connector: ConnectorConfig): Promise<McpConnection> => {
    const existing = pool.get(connector.id);
    if (existing) return existing;
    if (isManagedGitHubConnector(connector)) await dependencies.verifyGitHub(connector);
    const connection = dependencies.connect(toTarget(connector));
    pool.set(connector.id, connection);
    return connection;
  };

  const getPooledConnection = async (connectorId: string): Promise<McpConnection> =>
    connectionFor(await enabledConnector(connectorId));

  const closePooledConnection = async (connectorId: string): Promise<void> => {
    const connection = pool.get(connectorId);
    if (!connection) return;
    pool.delete(connectorId);
    await connection.close();
  };

  const listConnectorTools = async (connectorId: string): Promise<McpToolInfo[]> => {
    const connector = await enabledConnector(connectorId);
    try {
      const connection = await connectionFor(connector);
      return allowedTools(connector, await connection.listTools());
    } catch (error) {
      await closePooledConnection(connectorId);
      throw error;
    }
  };

  const callConnectorTool = async (
    connectorId: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<unknown> => {
    const connector = await enabledConnector(connectorId);
    assertToolAllowed(connector, tool);
    try {
      return await (await connectionFor(connector)).callTool(tool, args);
    } catch (error) {
      await closePooledConnection(connectorId);
      throw error;
    }
  };

  const probeConnector = async (
    connector: ConnectorConfig,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; tools: McpToolInfo[]; error?: string }> => {
    let connection: McpConnection | null = null;
    try {
      assertConnectorConfiguration(connector);
      if (isManagedGitHubConnector(connector)) {
        await dependencies.verifyGitHub(connector, signal);
      }
      connection = dependencies.connect(toTarget(connector, signal));
      const tools = await connection.listTools();
      await connection.close();
      connection = null;
      return { ok: true, tools };
    } catch (error) {
      return {
        ok: false,
        tools: [],
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await connection?.close().catch(() => undefined);
    }
  };

  return {
    getPooledConnection,
    closePooledConnection,
    listConnectorTools,
    callConnectorTool,
    probeConnector,
  };
}

const defaultConnectorPool = makeConnectorPool();

export const getPooledConnection = defaultConnectorPool.getPooledConnection;
export const closePooledConnection = defaultConnectorPool.closePooledConnection;
export const listConnectorTools = defaultConnectorPool.listConnectorTools;
export const callConnectorTool = defaultConnectorPool.callConnectorTool;
export const probeConnector = defaultConnectorPool.probeConnector;
