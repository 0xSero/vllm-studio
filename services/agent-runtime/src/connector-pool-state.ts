import type { McpConnection } from "./mcp-client";
import { Effect, Semaphore } from "effect";

type ConnectorPoolState = {
  active?: McpConnection;
  creating?: Promise<McpConnection>;
  closing?: Promise<void>;
  generation: number;
  generationController: AbortController;
  executions: Set<ConnectorExecutionRecord>;
  pending: Set<McpConnection>;
};

type ConnectorExecutionRecord = {
  generation: number;
  released: Promise<void>;
  release: () => void;
  settled: boolean;
};

declare const pooledConnectorExecution: unique symbol;

export type PooledConnectorExecution = {
  readonly [pooledConnectorExecution]: true;
  readonly connectorId: string;
  readonly generation: number;
  readonly signal: AbortSignal;
};

export class ConnectorExecutionInterruptedError extends Error {}

const states = new Map<string, ConnectorPoolState>();
const executionRecords = new WeakMap<
  PooledConnectorExecution,
  { state: ConnectorPoolState; record: ConnectorExecutionRecord }
>();
const snapshotConnections = new Set<McpConnection>();
const snapshotClosings = new Map<McpConnection, Promise<void>>();
const connectorAdmission = Semaphore.makeUnsafe(1);

export function withConnectorAdmission<A, E, R>(
  operation: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return connectorAdmission.withPermit(operation);
}

function stateFor(connectorId: string): ConnectorPoolState {
  const existing = states.get(connectorId);
  if (existing) return existing;
  const created: ConnectorPoolState = {
    generation: 0,
    generationController: new AbortController(),
    executions: new Set(),
    pending: new Set(),
  };
  states.set(connectorId, created);
  return created;
}

function removeIdleState(connectorId: string, state: ConnectorPoolState): void {
  if (
    !state.active &&
    !state.creating &&
    !state.closing &&
    state.executions.size === 0 &&
    state.pending.size === 0
  ) {
    states.delete(connectorId);
  }
}

function interrupted(connectorId: string): ConnectorExecutionInterruptedError {
  return new ConnectorExecutionInterruptedError(
    `Connector "${connectorId}" execution was interrupted`,
  );
}

function assertExecution(execution: PooledConnectorExecution): {
  state: ConnectorPoolState;
  record: ConnectorExecutionRecord;
} {
  const tracked = executionRecords.get(execution);
  if (
    !tracked ||
    tracked.record.settled ||
    tracked.record.generation !== execution.generation ||
    tracked.state.generation !== execution.generation ||
    tracked.state.generationController.signal !== execution.signal ||
    execution.signal.aborted
  ) {
    throw interrupted(execution.connectorId);
  }
  return tracked;
}

export function beginPooledConnectorExecution(connectorId: string): PooledConnectorExecution {
  const state = stateFor(connectorId);
  if (state.closing || state.pending.size > 0 || state.generationController.signal.aborted) {
    throw interrupted(connectorId);
  }
  const released = Promise.withResolvers<void>();
  const record: ConnectorExecutionRecord = {
    generation: state.generation,
    released: released.promise,
    release: released.resolve,
    settled: false,
  };
  const execution: PooledConnectorExecution = {
    connectorId,
    generation: state.generation,
    signal: state.generationController.signal,
  } as PooledConnectorExecution;
  state.executions.add(record);
  executionRecords.set(execution, { state, record });
  return execution;
}

export function assertPooledConnectorExecution(execution: PooledConnectorExecution): void {
  assertExecution(execution);
}

export function releasePooledConnectorExecution(execution: PooledConnectorExecution): void {
  const tracked = executionRecords.get(execution);
  if (!tracked || tracked.record.settled) return;
  tracked.record.settled = true;
  tracked.state.executions.delete(tracked.record);
  tracked.record.release();
  removeIdleState(execution.connectorId, tracked.state);
}

export async function getOrCreatePooledConnection(
  connectorId: string,
  create: () => Promise<McpConnection>,
): Promise<McpConnection> {
  while (true) {
    const state = stateFor(connectorId);
    if (state.closing) {
      await state.closing;
      continue;
    }
    if (state.pending.size > 0) {
      await closePooledConnection(connectorId);
      continue;
    }
    if (state.active) return state.active;
    if (state.creating) return state.creating;
    const generation = state.generation;
    let creating: Promise<McpConnection>;
    creating = Promise.resolve()
      .then(create)
      .then((connection) => {
        if (state.generation !== generation || state.closing) {
          state.pending.add(connection);
          throw new Error("Connector closed while connecting");
        }
        state.active = connection;
        return connection;
      })
      .finally(() => {
        if (state.creating === creating) state.creating = undefined;
        removeIdleState(connectorId, state);
      });
    state.creating = creating;
    return creating;
  }
}

export function getOrCreatePooledConnectionForExecution(
  execution: PooledConnectorExecution,
  create: () => Promise<McpConnection>,
): Promise<McpConnection> {
  const { state } = assertExecution(execution);
  if (state.closing || state.pending.size > 0) {
    return Promise.reject(interrupted(execution.connectorId));
  }
  if (state.active) return Promise.resolve(state.active);
  if (state.creating) return state.creating;
  const generation = execution.generation;
  let creating: Promise<McpConnection>;
  creating = Promise.resolve()
    .then(create)
    .then((connection) => {
      if (state.generation !== generation || state.closing || execution.signal.aborted) {
        state.pending.add(connection);
        throw interrupted(execution.connectorId);
      }
      state.active = connection;
      return connection;
    })
    .finally(() => {
      if (state.creating === creating) state.creating = undefined;
      removeIdleState(execution.connectorId, state);
    });
  state.creating = creating;
  return creating;
}

async function drainState(state: ConnectorPoolState): Promise<void> {
  await state.creating?.catch(() => undefined);
  if (state.active) {
    state.pending.add(state.active);
    state.active = undefined;
  }
  const targets = [...state.pending];
  const executions = [...state.executions].map(({ released }) => released);
  const [results] = await Promise.all([
    Promise.allSettled(targets.map((target) => Promise.resolve().then(() => target.close()))),
    Promise.all(executions),
  ]);
  const failures: unknown[] = [];
  results.forEach((result, index) => {
    const target = targets[index];
    if (!target) return;
    if (result.status === "fulfilled") state.pending.delete(target);
    else failures.push(result.reason);
  });
  if (failures.length) throw new AggregateError(failures, "Connector shutdown failed");
}

export async function closePooledConnection(connectorId: string): Promise<void> {
  const state = stateFor(connectorId);
  if (state.closing) return state.closing;
  const generationController = state.generationController;
  state.generation += 1;
  state.generationController = new AbortController();
  generationController.abort(interrupted(connectorId));
  const closing = drainState(state);
  state.closing = closing;
  try {
    await closing;
  } finally {
    if (state.closing === closing) state.closing = undefined;
    removeIdleState(connectorId, state);
  }
}

export async function closePendingPooledConnections(): Promise<void> {
  await Promise.all(
    [...states.entries()]
      .filter(([, state]) => state.pending.size > 0)
      .map(([connectorId]) => closePooledConnection(connectorId)),
  );
}

export function trackSnapshotConnection(connection: McpConnection): void {
  snapshotConnections.add(connection);
}

export async function closeSnapshotConnection(connection: McpConnection): Promise<void> {
  const existing = snapshotClosings.get(connection);
  if (existing) return existing;
  const closing = Promise.resolve()
    .then(() => connection.close())
    .then(() => {
      snapshotConnections.delete(connection);
    });
  snapshotClosings.set(connection, closing);
  try {
    await closing;
  } finally {
    if (snapshotClosings.get(connection) === closing) snapshotClosings.delete(connection);
  }
}

export async function closeSnapshotConnections(): Promise<void> {
  const results = await Promise.allSettled([...snapshotConnections].map(closeSnapshotConnection));
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length) throw new AggregateError(failures, "Connector shutdown failed");
}

export function hasPendingPooledConnections(): boolean {
  return (
    [...states.values()].some((state) =>
      Boolean(state.creating || state.closing || state.pending.size),
    ) || snapshotConnections.size > 0
  );
}
