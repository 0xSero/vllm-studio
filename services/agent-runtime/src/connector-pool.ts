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
import {
  verifyPluginExecutionSnapshot,
  withPluginExecutionSnapshotLifecycle,
} from "./plugin-execution-snapshot";
import { pluginConnectorConfigurationDigest } from "./plugin-connector-identity";

export { closePooledConnection } from "./connector-pool-state";

export class ConnectorToolDeniedError extends Error {}
export class UnknownConnectorError extends Error {}
export class ConnectorProbeDeniedError extends Error {}

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

function hasPluginExecutionGrant(connector: ConnectorConfig): boolean {
  const origin = connector.origin;
  return Boolean(
    connector.enabled &&
    connector.allowTools?.length &&
    origin?.kind === "plugin" &&
    origin.artifactDigest &&
    origin.sourceDigest &&
    origin.snapshotDigest &&
    origin.configurationDigest === pluginConnectorConfigurationDigest(connector),
  );
}

const connectionFor = (connector: ConnectorConfig): Promise<McpConnection> =>
  getOrCreatePooledConnection(connector.id, async () => connectMcp(toTarget(connector)));

async function usePooledConnector<A>(
  connector: ConnectorConfig,
  use: (connection: McpConnection) => Promise<A>,
): Promise<A> {
  try {
    return await use(await connectionFor(connector));
  } catch (error) {
    await closePooledConnection(connector.id).catch(() => undefined);
    throw error;
  }
}

function withPersistedConnectorExecution<A>(
  connectorId: string,
  use: (connector: ConnectorConfig) => Promise<A>,
): Promise<A> {
  return Effect.runPromise(
    withPluginExecutionSnapshotLifecycle(() =>
      Effect.gen(function* () {
        const connector = yield* Effect.tryPromise({
          try: () => enabledConnector(connectorId),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        });
        if (connector.origin?.kind === "plugin") {
          if (!hasPluginExecutionGrant(connector)) {
            return yield* Effect.fail(
              new ConnectorToolDeniedError(`Connector "${connectorId}" is not approved`),
            );
          }
          yield* verifyPluginExecutionSnapshot(connector).pipe(
            Effect.mapError(
              () => new ConnectorToolDeniedError(`Connector "${connectorId}" is not approved`),
            ),
          );
        }
        return yield* Effect.tryPromise({
          try: () => use(connector),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        });
      }),
    ),
  );
}

export async function listConnectorTools(connectorId: string): Promise<McpToolInfo[]> {
  return withPersistedConnectorExecution(connectorId, (connector) =>
    usePooledConnector(connector, async (connection) =>
      allowedTools(connector, await connection.listTools()),
    ),
  );
}

export async function callConnectorTool(
  connectorId: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return withPersistedConnectorExecution(connectorId, (connector) => {
    assertToolAllowed(connector, tool);
    return usePooledConnector(connector, (connection) => connection.callTool(tool, args));
  });
}

export async function probeConnector(
  connector: ConnectorConfig,
  signal?: AbortSignal,
  snapshotBound = false,
): Promise<{ ok: boolean; tools: McpToolInfo[]; error?: string }> {
  let connection: McpConnection | null = null;
  let closeOnAbort: (() => void) | undefined;
  try {
    signal?.throwIfAborted();
    connection = connectMcp(toTarget(connector, signal));
    if (snapshotBound) {
      trackSnapshotConnection(connection);
      const tracked = connection;
      closeOnAbort = () => void closeSnapshotConnection(tracked).catch(() => undefined);
      signal?.addEventListener("abort", closeOnAbort, { once: true });
      signal?.throwIfAborted();
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
  connectorId: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; tools: McpToolInfo[]; error?: string }> {
  if (signal?.aborted) {
    return Promise.reject(
      signal.reason instanceof Error
        ? signal.reason
        : new DOMException("Connector probe aborted", "AbortError"),
    );
  }
  const operation = withPluginExecutionSnapshotLifecycle(() =>
    Effect.gen(function* () {
      const connector = yield* Effect.tryPromise({
        try: () =>
          listConnectors().then((connectors) =>
            connectors.find((entry) => entry.id === connectorId),
          ),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      });
      if (!connector) return { _tag: "unknown" as const };
      if (connector.origin?.kind === "plugin") {
        if (!hasPluginExecutionGrant(connector)) {
          return { _tag: "denied" as const };
        }
        const verified = yield* verifyPluginExecutionSnapshot(connector).pipe(
          Effect.match({ onFailure: () => false, onSuccess: () => true }),
        );
        if (!verified) return { _tag: "denied" as const };
      }
      const result = yield* Effect.tryPromise({
        try: (lifecycleSignal) => {
          lifecycleSignal.throwIfAborted();
          return probeConnector(connector, lifecycleSignal, connector.origin?.kind === "plugin");
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      });
      return { _tag: "result" as const, result };
    }),
  );
  const running = signal ? Effect.runPromise(operation, { signal }) : Effect.runPromise(operation);
  return running.then((outcome) => {
    if (outcome._tag === "unknown") {
      throw new UnknownConnectorError(`Unknown connector "${connectorId}"`);
    }
    if (outcome._tag === "denied") {
      throw new ConnectorProbeDeniedError(`Connector "${connectorId}" is not approved`);
    }
    return outcome.result;
  });
}
