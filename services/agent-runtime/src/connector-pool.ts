import { Effect } from "effect";
import { connectMcp, type McpConnection, type McpToolInfo } from "./mcp-client";
import { connectorAuthorizationHeaders } from "./connector-auth";
import { listConnectors, type ConnectorConfig } from "./connectors-service";
import {
  assertPooledConnectorExecution,
  beginPooledConnectorExecution,
  closeSnapshotConnection,
  closePooledConnection,
  ConnectorExecutionInterruptedError,
  getOrCreatePooledConnectionForExecution,
  releasePooledConnectorExecution,
  trackSnapshotConnection,
  type PooledConnectorExecution,
  withConnectorAdmission,
} from "./connector-pool-state";
import { verifyPluginExecutionSnapshot } from "./plugin-execution-snapshot";
import { pluginConnectorConfigurationDigest } from "./plugin-connector-identity";
import type { PluginSource } from "./plugin-discovery";

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
    (connector.transport === "http" || origin.snapshotDigest) &&
    origin.configurationDigest === pluginConnectorConfigurationDigest(connector),
  );
}

type ConnectorExecutionAdmission = {
  connector: ConnectorConfig;
  execution: PooledConnectorExecution;
};

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

async function verifyPluginExecutionGrant(connector: ConnectorConfig): Promise<void> {
  if (connector.origin?.kind !== "plugin") return;
  if (!hasPluginExecutionGrant(connector)) {
    throw new ConnectorToolDeniedError(`Connector "${connector.id}" is not approved`);
  }
  if (connector.transport === "stdio") {
    await Effect.runPromise(verifyPluginExecutionSnapshot(connector)).catch(() => {
      throw new ConnectorToolDeniedError(`Connector "${connector.id}" is not approved`);
    });
  }
}

async function admitConnectorExecution(
  connectorId: string,
  load: () => Promise<ConnectorConfig>,
  validate: (connector: ConnectorConfig) => Promise<void> | void,
  signal?: AbortSignal,
): Promise<ConnectorExecutionAdmission> {
  while (true) {
    let pendingExecution: PooledConnectorExecution | undefined;
    try {
      const admission = withConnectorAdmission(
        Effect.tryPromise({
          try: async () => {
            const execution = beginPooledConnectorExecution(connectorId);
            pendingExecution = execution;
            try {
              const connector = await load();
              await validate(connector);
              assertPooledConnectorExecution(execution);
              return { connector, execution };
            } catch (error) {
              releasePooledConnectorExecution(execution);
              throw error;
            }
          },
          catch: asError,
        }).pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              if (pendingExecution) releasePooledConnectorExecution(pendingExecution);
            }),
          ),
        ),
      );
      return await (signal
        ? Effect.runPromise(admission, { signal })
        : Effect.runPromise(admission));
    } catch (error) {
      if (!(error instanceof ConnectorExecutionInterruptedError)) throw error;
      const closing = closePooledConnection(connectorId);
      if (signal) await raceAbortSignal(signal, closing);
      else await closing;
    }
  }
}

const connectionFor = (
  connector: ConnectorConfig,
  execution: PooledConnectorExecution,
): Promise<McpConnection> =>
  getOrCreatePooledConnectionForExecution(execution, async () =>
    connectMcp(toTarget(connector, execution.signal)),
  );

async function raceAbortSignal<A>(signal: AbortSignal, operation: Promise<A>): Promise<A> {
  signal.throwIfAborted();
  let rejectInterruption: ((error: unknown) => void) | undefined;
  const interruption = new Promise<never>((_, reject) => {
    rejectInterruption = reject;
  });
  const interrupt = () => rejectInterruption?.(signal.reason);
  signal.addEventListener("abort", interrupt, { once: true });
  try {
    signal.throwIfAborted();
    const result = await Promise.race([operation, interruption]);
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener("abort", interrupt);
  }
}

async function usePooledConnector<A>(
  admission: ConnectorExecutionAdmission,
  use: (connection: McpConnection) => Promise<A>,
): Promise<A> {
  const { connector, execution } = admission;
  const operation = Promise.resolve()
    .then(() => connectionFor(connector, execution))
    .then(use);
  try {
    const result = await raceAbortSignal(execution.signal, operation);
    releasePooledConnectorExecution(execution);
    return result;
  } catch (error) {
    if (execution.signal.aborted) {
      await operation.catch(() => undefined);
      releasePooledConnectorExecution(execution);
      throw error;
    }
    releasePooledConnectorExecution(execution);
    await closePooledConnection(connector.id).catch(() => undefined);
    throw error;
  }
}

export async function listConnectorTools(connectorId: string): Promise<McpToolInfo[]> {
  const admission = await admitConnectorExecution(
    connectorId,
    () => enabledConnector(connectorId),
    verifyPluginExecutionGrant,
  );
  return usePooledConnector(admission, async (connection) =>
    allowedTools(admission.connector, await connection.listTools()),
  );
}

export async function callConnectorTool(
  connectorId: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const admission = await admitConnectorExecution(
    connectorId,
    () => enabledConnector(connectorId),
    async (connector) => {
      assertToolAllowed(connector, tool);
      await verifyPluginExecutionGrant(connector);
    },
  );
  return usePooledConnector(admission, (connection) => connection.callTool(tool, args));
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
    }
    const tracked = connection;
    closeOnAbort = () =>
      void (snapshotBound ? closeSnapshotConnection(tracked) : tracked.close()).catch(
        () => undefined,
      );
    signal?.addEventListener("abort", closeOnAbort, { once: true });
    signal?.throwIfAborted();
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

export async function probePersistedConnector(
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
  const admission = await admitConnectorExecution(
    connectorId,
    async () => {
      const connector = (await listConnectors()).find((entry) => entry.id === connectorId);
      if (!connector) throw new UnknownConnectorError(`Unknown connector "${connectorId}"`);
      return connector;
    },
    async (connector) => {
      try {
        await verifyPluginExecutionGrant(connector);
      } catch (error) {
        if (error instanceof ConnectorToolDeniedError) {
          throw new ConnectorProbeDeniedError(`Connector "${connectorId}" is not approved`);
        }
        throw error;
      }
    },
    signal,
  );
  const { connector, execution } = admission;
  const operationSignal = signal ? AbortSignal.any([signal, execution.signal]) : execution.signal;
  const operation = probeConnector(
    connector,
    operationSignal,
    connector.origin?.kind === "plugin" && connector.transport === "stdio",
  );
  try {
    const result = await raceAbortSignal(operationSignal, operation);
    releasePooledConnectorExecution(execution);
    return result;
  } catch (error) {
    await operation.catch(() => undefined);
    releasePooledConnectorExecution(execution);
    throw error;
  }
}

export async function probePersistedConnectorWithReconciliation(
  connectorId: string,
  signal?: AbortSignal,
  sources?: PluginSource[],
): Promise<{ ok: boolean; tools: McpToolInfo[]; error?: string }> {
  signal?.throwIfAborted();
  const { refreshEnabledPluginConnectors } = await import("./plugin-runtime");
  await Effect.runPromise(refreshEnabledPluginConnectors(sources), signal ? { signal } : undefined);
  return probePersistedConnector(connectorId, signal);
}
