import type { InstanceRecord } from "../../src/modules/compute/contracts";
import type {
  InstanceRefV1,
  MemoryPoolRefV1,
  NodeRefV1,
  ServedModelV1,
  ServingInstanceV1,
  ServingStateV1,
} from "@local-studio/contracts/serving-state";

export const SERVED_MODEL_DEEPSEEK = "deepseek-v4-flash-0731";
export const SERVED_MODEL_GEMMA = "gemma-4-12b-it";

const STARTED_AT = "2026-08-09T18:00:00.000Z";
const READY_DEADLINE_AT = "2026-08-09T18:10:00.000Z";
const CHECKED_AT = "2026-08-09T18:05:00.000Z";
const UNKNOWN_HEALTH = { status: "unknown", checkedAt: null } as const;
const HEALTHY = { status: "healthy", checkedAt: CHECKED_AT } as const;
const UNHEALTHY = { status: "unhealthy", checkedAt: CHECKED_AT } as const;

const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
};

const makeInstance = (
  nodeId: string,
  name: string,
  servedModelName: string,
  engine: ServingInstanceV1["engine"],
  runtime: ServingInstanceV1["runtime"],
  port: number,
  pid: number,
): ServingInstanceV1 => ({
  instance: { nodeId, name },
  recipeId: `recipe-${servedModelName}`,
  servedModelName,
  engine,
  runtime,
  handle:
    runtime === "docker"
      ? { kind: "docker", container: name }
      : { kind: "process", pid, startToken: String(pid) },
  state: "ready",
  health: HEALTHY,
  endpoint: { scheme: "http", host: nodeId, port, path: "/v1" },
  metricsAddress: { scheme: "http", host: nodeId, port, path: "/metrics" },
  logHandle: { nodeId, name },
  deviceIds: [`gpu-${nodeId}-0`],
  memoryPoolIds: [`pool-${nodeId}-unified`],
  startedAt: STARTED_AT,
  readyDeadlineAt: READY_DEADLINE_AT,
});

const groupServedModels = (instances: readonly ServingInstanceV1[]): ServedModelV1[] => {
  const names = instances
    .map((entry) => entry.servedModelName)
    .filter((name): name is string => name !== null);
  return [...new Set(names)].map((name) => ({
    name,
    instances: instances
      .filter((entry) => entry.servedModelName === name)
      .map((entry) => entry.instance),
  }));
};

const makeState = (
  nodeIds: readonly string[],
  instances: readonly ServingInstanceV1[],
  primaryInstance: InstanceRefV1 | null,
): ServingStateV1 =>
  deepFreeze({
    version: 1,
    primaryInstance,
    nodes: nodeIds.map((nodeId): NodeRefV1 => ({ nodeId })),
    instances,
    servedModels: groupServedModels(instances),
    memoryPools: nodeIds.map(
      (nodeId): MemoryPoolRefV1 => ({
        memoryPoolId: `pool-${nodeId}-unified`,
        nodeId,
        deviceIds: [`gpu-${nodeId}-0`],
      }),
    ),
    visionPairing: null,
  });

const DS = SERVED_MODEL_DEEPSEEK;
const GM = SERVED_MODEL_GEMMA;
const EXITED = { state: "exited", health: UNKNOWN_HEALTH } as const;

const DEEPSEEK_A = makeInstance("spark-a", "deepseek-a", DS, "vllm", "process", 8888, 4101);
const DEEPSEEK_B = makeInstance("spark-b", "deepseek-b", DS, "vllm", "process", 8889, 4102);
const GEMMA_A = makeInstance("spark-a", "gemma-a", GM, "sglang", "process", 8891, 4103);
const GEMMA_B: ServingInstanceV1 = {
  ...makeInstance("spark-b", "gemma-b", GM, "sglang", "docker", 8892, 4104),
  state: "unhealthy",
  health: UNHEALTHY,
};

const N_NODES = ["spark-a", "spark-b"] as const;
const N_LIST = [DEEPSEEK_A, DEEPSEEK_B, GEMMA_A, GEMMA_B] as const;

const nVariant = (
  primary: InstanceRefV1 | null,
  ...replacements: readonly ServingInstanceV1[]
): ServingStateV1 =>
  makeState(
    N_NODES,
    N_LIST.map(
      (entry) =>
        replacements.find((candidate) => candidate.instance.name === entry.instance.name) ?? entry,
    ),
    primary,
  );

export const SERVING_STATE_ZERO_V1 = makeState([], [], null);

export const SERVING_STATE_ONE_V1 = makeState(["spark-a"], [DEEPSEEK_A], DEEPSEEK_A.instance);

export const SERVING_STATE_TWO_V1 = makeState(
  ["spark-a"],
  [DEEPSEEK_A, GEMMA_A],
  DEEPSEEK_A.instance,
);

export const SERVING_STATE_N_V1 = nVariant(DEEPSEEK_B.instance);

export const SERVING_STATE_N_STARTING_V1 = nVariant(DEEPSEEK_B.instance, {
  ...DEEPSEEK_B,
  state: "starting",
  health: UNKNOWN_HEALTH,
});

export const SERVING_STATE_N_STOP_EXITED_V1 = nVariant(
  DEEPSEEK_B.instance,
  { ...DEEPSEEK_A, ...EXITED, handle: null },
  { ...DEEPSEEK_B, ...EXITED, handle: null },
);

export const SERVING_STATE_N_CRASH_EXITED_V1 = nVariant(DEEPSEEK_B.instance, {
  ...GEMMA_A,
  ...EXITED,
});

export const SERVING_STATE_N_PORT_CHANGE_V1 = nVariant(DEEPSEEK_B.instance, {
  ...DEEPSEEK_B,
  endpoint: { scheme: "http", host: "spark-b", port: 8899, path: "/v1" },
  metricsAddress: { scheme: "http", host: "spark-b", port: 8899, path: "/metrics" },
});

export const SERVING_STATE_N_RESTART_V1 = nVariant(DEEPSEEK_B.instance, {
  ...DEEPSEEK_B,
  handle: { kind: "process", pid: 5202, startToken: "5202" },
  startedAt: "2026-08-09T19:00:00.000Z",
  readyDeadlineAt: "2026-08-09T19:10:00.000Z",
});

export const SERVING_STATE_N_PRIMARY_UNAVAILABLE_V1 = nVariant(
  DEEPSEEK_B.instance,
  { ...DEEPSEEK_B, state: "unhealthy", health: UNHEALTHY },
  { ...GEMMA_B, state: "ready", health: HEALTHY },
);

export const SERVING_STATE_N_PRIMARY_REELECTED_V1 = nVariant(DEEPSEEK_A.instance);

export const SERVING_STATE_N_NAME_MOVED_V1 = makeState(
  N_NODES,
  [
    DEEPSEEK_A,
    makeInstance("spark-b", "deepseek-b-2", DS, "vllm", "process", 8890, 5303),
    GEMMA_A,
    GEMMA_B,
  ],
  { nodeId: "spark-b", name: "deepseek-b-2" },
);

const LEGACY_RECORD_BASE = {
  name: "legacy-deepseek",
  nodeId: "self",
  engine: "vllm",
  recipeId: "recipe-legacy",
  runtime: "process",
  ref: { kind: "process", pid: 6101, startToken: "6101" },
  port: 8000,
  devices: ["gpu-self-0"],
  nonce: "legacy-nonce",
  startedAt: STARTED_AT,
  readyDeadlineAt: READY_DEADLINE_AT,
} as const;

export const LEGACY_INSTANCE_RECORD_JSON: Record<string, unknown> = deepFreeze({
  ...LEGACY_RECORD_BASE,
});

export const LEGACY_INSTANCE_RECORD_DECODED: InstanceRecord = deepFreeze({
  ...LEGACY_RECORD_BASE,
  servedModelName: null,
});
