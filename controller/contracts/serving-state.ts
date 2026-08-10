import { Schema } from "effect";
import type {
  DeviceId,
  EngineId,
  EngineRuntimeKind,
  HandleReference,
  InstanceState,
  NodeId,
} from "../src/modules/compute/contracts";

const SERVING_STATE_PARSE_OPTIONS = {
  errors: "all",
  onExcessProperty: "error",
} as const;

const strictV1 = <S extends Schema.Top>(schema: S): S["Rebuild"] =>
  Schema.annotate<S>({ parseOptions: SERVING_STATE_PARSE_OPTIONS })(schema);

const IdentityStringSchema = Schema.NonEmptyString;
const TimestampV1Schema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/)),
);
const PortV1Schema = Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0)));
const SlashPathV1Schema = Schema.String.pipe(Schema.check(Schema.isPattern(/^\//)));

export const SERVING_STATE_VERSION_V1 = 1 as const;
export const ServingStateVersionV1Schema = Schema.Literal(SERVING_STATE_VERSION_V1);

export const SERVING_ADDRESS_SCHEMES_V1 = ["http", "https"] as const;
export const ServingAddressSchemeV1Schema = Schema.Literals(SERVING_ADDRESS_SCHEMES_V1);

export const SERVING_INSTANCE_HEALTH_STATUSES_V1 = ["unknown", "healthy", "unhealthy"] as const;
export const ServingInstanceHealthStatusV1Schema = Schema.Literals(
  SERVING_INSTANCE_HEALTH_STATUSES_V1,
);

export const SERVING_ENGINE_IDS_V1 = [
  "vllm",
  "sglang",
  "llamacpp",
  "mlx",
  "exllamav3",
] as const satisfies readonly EngineId[];
export const ServingEngineIdV1Schema = Schema.Literals(SERVING_ENGINE_IDS_V1);

export const SERVING_ENGINE_RUNTIME_KINDS_V1 = [
  "process",
  "docker",
] as const satisfies readonly EngineRuntimeKind[];
export const ServingEngineRuntimeKindV1Schema = Schema.Literals(SERVING_ENGINE_RUNTIME_KINDS_V1);

export const SERVING_INSTANCE_STATES_V1 = [
  "reserving",
  "starting",
  "ready",
  "unhealthy",
  "exited",
] as const satisfies readonly InstanceState[];
export const ServingInstanceStateV1Schema = Schema.Literals(SERVING_INSTANCE_STATES_V1);

export const SERVING_HANDLE_KIND_PROCESS_V1 = "process" as const;
export const SERVING_HANDLE_KIND_DOCKER_V1 = "docker" as const;
export const SERVING_HANDLE_KIND_REMOTE_V1 = "remote" as const;
export const SERVING_HANDLE_KIND_PINNED_V1 = "pinned" as const;
export const ServingHandleKindProcessV1Schema = Schema.Literal(SERVING_HANDLE_KIND_PROCESS_V1);
export const ServingHandleKindDockerV1Schema = Schema.Literal(SERVING_HANDLE_KIND_DOCKER_V1);
export const ServingHandleKindRemoteV1Schema = Schema.Literal(SERVING_HANDLE_KIND_REMOTE_V1);
export const ServingHandleKindPinnedV1Schema = Schema.Literal(SERVING_HANDLE_KIND_PINNED_V1);

export const ProcessHandleReferenceV1Schema = Schema.Struct({
  kind: ServingHandleKindProcessV1Schema,
  pid: Schema.Number.pipe(Schema.check(Schema.isInt())),
  startToken: Schema.NullOr(Schema.String),
}).pipe(strictV1);

export const DockerHandleReferenceV1Schema = Schema.Struct({
  kind: ServingHandleKindDockerV1Schema,
  container: IdentityStringSchema,
}).pipe(strictV1);

export const RemoteHandleReferenceV1Schema = Schema.Struct({
  kind: ServingHandleKindRemoteV1Schema,
  nodeId: IdentityStringSchema,
  name: IdentityStringSchema,
}).pipe(strictV1);

export const PinnedHandleReferenceV1Schema = Schema.Struct({
  kind: ServingHandleKindPinnedV1Schema,
  holder: IdentityStringSchema,
}).pipe(strictV1);

export const HandleReferenceV1Schema = Schema.Union([
  ProcessHandleReferenceV1Schema,
  DockerHandleReferenceV1Schema,
  RemoteHandleReferenceV1Schema,
  PinnedHandleReferenceV1Schema,
]);

export const NodeRefV1Schema = Schema.Struct({
  nodeId: IdentityStringSchema,
}).pipe(strictV1);
export type NodeRefV1 = typeof NodeRefV1Schema.Type;

export const InstanceRefV1Schema = Schema.Struct({
  nodeId: IdentityStringSchema,
  name: IdentityStringSchema,
}).pipe(strictV1);
export type InstanceRefV1 = typeof InstanceRefV1Schema.Type;

export const instanceRefV1Equals = (left: InstanceRefV1, right: InstanceRefV1): boolean =>
  left.nodeId === right.nodeId && left.name === right.name;

const instanceRefKey = (ref: InstanceRefV1): string => JSON.stringify([ref.nodeId, ref.name]);

const firstDuplicate = <T>(values: readonly T[], keyOf: (value: T) => string): T | undefined => {
  const seen = new Set<string>();
  for (const value of values) {
    const key = keyOf(value);
    if (seen.has(key)) return value;
    seen.add(key);
  }
  return undefined;
};

export const ServingAddressV1Schema = Schema.Struct({
  scheme: ServingAddressSchemeV1Schema,
  host: IdentityStringSchema,
  port: PortV1Schema,
  path: SlashPathV1Schema,
}).pipe(strictV1);
export type ServingAddressV1 = typeof ServingAddressV1Schema.Type;

export const InstanceHealthV1Schema = Schema.Struct({
  status: ServingInstanceHealthStatusV1Schema,
  checkedAt: Schema.NullOr(TimestampV1Schema),
}).pipe(strictV1);
export type InstanceHealthV1 = typeof InstanceHealthV1Schema.Type;

const ServingInstanceV1Struct = Schema.Struct({
  instance: InstanceRefV1Schema,
  recipeId: IdentityStringSchema,
  servedModelName: Schema.NullOr(Schema.String),
  engine: ServingEngineIdV1Schema,
  runtime: ServingEngineRuntimeKindV1Schema,
  handle: Schema.NullOr(HandleReferenceV1Schema),
  state: ServingInstanceStateV1Schema,
  health: InstanceHealthV1Schema,
  endpoint: Schema.NullOr(ServingAddressV1Schema),
  metricsAddress: Schema.NullOr(ServingAddressV1Schema),
  logHandle: Schema.NullOr(InstanceRefV1Schema),
  deviceIds: Schema.Array(IdentityStringSchema),
  memoryPoolIds: Schema.Array(IdentityStringSchema),
  startedAt: TimestampV1Schema,
  readyDeadlineAt: TimestampV1Schema,
});

const lifecycleHealthViolation = (
  state: InstanceState,
  status: (typeof SERVING_INSTANCE_HEALTH_STATUSES_V1)[number],
): string | undefined => {
  switch (state) {
    case "ready":
      return status === "healthy" ? undefined : `ready instance must be healthy, saw ${status}`;
    case "unhealthy":
      return status === "unhealthy"
        ? undefined
        : `unhealthy instance must be unhealthy, saw ${status}`;
    case "reserving":
    case "starting":
    case "exited":
      return status === "unknown"
        ? undefined
        : `${state} instance must have unknown health, saw ${status}`;
  }
};

const servingInstanceViolation = (
  entry: typeof ServingInstanceV1Struct.Type,
): string | undefined => {
  const coupling = lifecycleHealthViolation(entry.state, entry.health.status);
  if (coupling !== undefined) return coupling;
  if (entry.servedModelName !== null && entry.endpoint === null) {
    return `model-bearing instance ${instanceRefKey(entry.instance)} requires an endpoint`;
  }
  if (entry.servedModelName !== null && entry.logHandle === null) {
    return `model-bearing instance ${instanceRefKey(entry.instance)} requires a log handle`;
  }
  return undefined;
};

export const ServingInstanceV1Schema = ServingInstanceV1Struct.pipe(
  Schema.check(Schema.makeFilter(servingInstanceViolation)),
  strictV1,
);
export type ServingInstanceV1 = typeof ServingInstanceV1Schema.Type;

const ServedModelV1Struct = Schema.Struct({
  name: Schema.String,
  instances: Schema.Array(InstanceRefV1Schema),
});

const servedModelViolation = (model: typeof ServedModelV1Struct.Type): string | undefined => {
  const duplicate = firstDuplicate(model.instances, instanceRefKey);
  return duplicate === undefined
    ? undefined
    : `duplicate instance reference ${instanceRefKey(duplicate)} in served model ${JSON.stringify(model.name)}`;
};

export const ServedModelV1Schema = ServedModelV1Struct.pipe(
  Schema.check(Schema.makeFilter(servedModelViolation)),
  strictV1,
);
export type ServedModelV1 = typeof ServedModelV1Schema.Type;

const MemoryPoolRefV1Struct = Schema.Struct({
  memoryPoolId: IdentityStringSchema,
  nodeId: IdentityStringSchema,
  deviceIds: Schema.Array(IdentityStringSchema),
});

const memoryPoolViolation = (pool: typeof MemoryPoolRefV1Struct.Type): string | undefined => {
  const duplicate = firstDuplicate(pool.deviceIds, (deviceId: string): string => deviceId);
  return duplicate === undefined
    ? undefined
    : `duplicate device ${duplicate} in memory pool ${pool.memoryPoolId}`;
};

export const MemoryPoolRefV1Schema = MemoryPoolRefV1Struct.pipe(
  Schema.check(Schema.makeFilter(memoryPoolViolation)),
  strictV1,
);
export type MemoryPoolRefV1 = typeof MemoryPoolRefV1Schema.Type;

export const VisionPairingV1Schema = Schema.Null;

const ServingStateV1Struct = Schema.Struct({
  version: ServingStateVersionV1Schema,
  primaryInstance: Schema.NullOr(InstanceRefV1Schema),
  nodes: Schema.Array(NodeRefV1Schema),
  instances: Schema.Array(ServingInstanceV1Schema),
  servedModels: Schema.Array(ServedModelV1Schema),
  memoryPools: Schema.Array(MemoryPoolRefV1Schema),
  visionPairing: VisionPairingV1Schema,
});

const servingStateViolation = (state: typeof ServingStateV1Struct.Type): string | undefined => {
  const duplicateNode = firstDuplicate(state.nodes, (node): string => node.nodeId);
  if (duplicateNode !== undefined) return `duplicate nodeId ${duplicateNode.nodeId}`;
  const duplicateInstance = firstDuplicate(state.instances, (entry): string =>
    instanceRefKey(entry.instance),
  );
  if (duplicateInstance !== undefined) {
    return `duplicate instance ${instanceRefKey(duplicateInstance.instance)}`;
  }
  const duplicateModel = firstDuplicate(state.servedModels, (model): string => model.name);
  if (duplicateModel !== undefined) {
    return `duplicate served-model name ${JSON.stringify(duplicateModel.name)}`;
  }
  const duplicatePool = firstDuplicate(state.memoryPools, (pool): string => pool.memoryPoolId);
  if (duplicatePool !== undefined) {
    return `duplicate memory-pool id ${duplicatePool.memoryPoolId}`;
  }
  const nodeIds = new Set(state.nodes.map((node): string => node.nodeId));
  const poolsById = new Map(
    state.memoryPools.map((pool): readonly [string, MemoryPoolRefV1] => [pool.memoryPoolId, pool]),
  );
  const instancesByRef = new Map(
    state.instances.map((entry): readonly [string, ServingInstanceV1] => [
      instanceRefKey(entry.instance),
      entry,
    ]),
  );
  for (const entry of state.instances) {
    if (!nodeIds.has(entry.instance.nodeId)) {
      return `instance ${instanceRefKey(entry.instance)} references absent node ${entry.instance.nodeId}`;
    }
  }
  for (const pool of state.memoryPools) {
    if (!nodeIds.has(pool.nodeId)) {
      return `memory pool ${pool.memoryPoolId} references absent node ${pool.nodeId}`;
    }
  }
  for (const entry of state.instances) {
    for (const memoryPoolId of entry.memoryPoolIds) {
      const pool = poolsById.get(memoryPoolId);
      if (pool === undefined) {
        return `instance ${instanceRefKey(entry.instance)} references absent memory pool ${memoryPoolId}`;
      }
      if (pool.nodeId !== entry.instance.nodeId) {
        return `instance ${instanceRefKey(entry.instance)} references memory pool ${memoryPoolId} on node ${pool.nodeId}`;
      }
    }
  }
  for (const model of state.servedModels) {
    for (const ref of model.instances) {
      const entry = instancesByRef.get(instanceRefKey(ref));
      if (entry === undefined) {
        return `served model ${JSON.stringify(model.name)} references absent instance ${instanceRefKey(ref)}`;
      }
      if (entry.servedModelName !== model.name) {
        return `served model ${JSON.stringify(model.name)} references instance ${instanceRefKey(ref)} serving ${JSON.stringify(entry.servedModelName)}`;
      }
    }
  }
  for (const entry of state.instances) {
    if (entry.servedModelName === null) continue;
    const owner = state.servedModels.find(
      (model): boolean => model.name === entry.servedModelName,
    );
    const represented =
      owner === undefined
        ? 0
        : owner.instances.filter((ref): boolean => instanceRefV1Equals(ref, entry.instance)).length;
    if (represented !== 1) {
      return `instance ${instanceRefKey(entry.instance)} must appear exactly once in served model ${JSON.stringify(entry.servedModelName)}`;
    }
  }
  if (state.primaryInstance !== null && !instancesByRef.has(instanceRefKey(state.primaryInstance))) {
    return `primary instance ${instanceRefKey(state.primaryInstance)} does not resolve`;
  }
  return undefined;
};

export const ServingStateV1Schema = ServingStateV1Struct.pipe(
  Schema.check(Schema.makeFilter(servingStateViolation)),
  strictV1,
);
export type ServingStateV1 = typeof ServingStateV1Schema.Type;

const compareCodeUnits = (left: string, right: string): number => {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const compareInstanceOrder = (left: ServingInstanceV1, right: ServingInstanceV1): number => {
  const byNode = compareCodeUnits(left.instance.nodeId, right.instance.nodeId);
  return byNode === 0 ? compareCodeUnits(left.instance.name, right.instance.name) : byNode;
};

export const selectReadyReplica = (
  state: ServingStateV1,
  exactModelName: string,
): ServingInstanceV1 | null => {
  const candidates = state.instances.filter(
    (entry): boolean =>
      entry.servedModelName === exactModelName &&
      entry.state === "ready" &&
      entry.health.status === "healthy" &&
      entry.endpoint !== null,
  );
  const primary = state.primaryInstance;
  if (primary !== null) {
    const elected = candidates.find((entry): boolean =>
      instanceRefV1Equals(entry.instance, primary),
    );
    if (elected !== undefined) return elected;
  }
  return candidates.sort(compareInstanceOrder)[0] ?? null;
};

export const listRoutableServedModelNames = (state: ServingStateV1): readonly string[] =>
  state.servedModels
    .filter((model): boolean => selectReadyReplica(state, model.name) !== null)
    .map((model): string => model.name)
    .sort(compareCodeUnits);

type IsSame<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
  ? true
  : false;
type MustBeTrue<T extends true> = T;

export type NodeRefV1NodeIdParity = MustBeTrue<IsSame<NodeRefV1["nodeId"], NodeId>>;
export type InstanceRefV1NodeIdParity = MustBeTrue<IsSame<InstanceRefV1["nodeId"], NodeId>>;
export type MemoryPoolRefV1NodeIdParity = MustBeTrue<IsSame<MemoryPoolRefV1["nodeId"], NodeId>>;
export type ServingInstanceV1DeviceIdParity = MustBeTrue<
  IsSame<ServingInstanceV1["deviceIds"][number], DeviceId>
>;
export type MemoryPoolRefV1DeviceIdParity = MustBeTrue<
  IsSame<MemoryPoolRefV1["deviceIds"][number], DeviceId>
>;
export type HandleReferenceV1Parity = MustBeTrue<
  IsSame<typeof HandleReferenceV1Schema.Type, HandleReference>
>;
export type ServingInstanceV1HandleParity = MustBeTrue<
  IsSame<ServingInstanceV1["handle"], HandleReference | null>
>;
export type ServingInstanceV1EngineParity = MustBeTrue<
  IsSame<ServingInstanceV1["engine"], EngineId>
>;
export type ServingInstanceV1RuntimeParity = MustBeTrue<
  IsSame<ServingInstanceV1["runtime"], EngineRuntimeKind>
>;
export type ServingInstanceV1StateParity = MustBeTrue<
  IsSame<ServingInstanceV1["state"], InstanceState>
>;
export type ServingEngineIdVocabularyParity = MustBeTrue<
  IsSame<(typeof SERVING_ENGINE_IDS_V1)[number], EngineId>
>;
export type ServingEngineRuntimeKindVocabularyParity = MustBeTrue<
  IsSame<(typeof SERVING_ENGINE_RUNTIME_KINDS_V1)[number], EngineRuntimeKind>
>;
export type ServingInstanceStateVocabularyParity = MustBeTrue<
  IsSame<(typeof SERVING_INSTANCE_STATES_V1)[number], InstanceState>
>;
export type ServingHandleKindVocabularyParity = MustBeTrue<
  IsSame<
    | typeof SERVING_HANDLE_KIND_PROCESS_V1
    | typeof SERVING_HANDLE_KIND_DOCKER_V1
    | typeof SERVING_HANDLE_KIND_REMOTE_V1
    | typeof SERVING_HANDLE_KIND_PINNED_V1,
    HandleReference["kind"]
  >
>;
export type ServingStateV1VisionPairingImmutability = MustBeTrue<
  IsSame<ServingStateV1["visionPairing"], null>
>;
