import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  DockerHandleReferenceV1Schema,
  HandleReferenceV1Schema,
  instanceRefV1Equals,
  listRoutableServedModelNames,
  PinnedHandleReferenceV1Schema,
  ProcessHandleReferenceV1Schema,
  RemoteHandleReferenceV1Schema,
  selectReadyReplica,
  SERVING_ENGINE_IDS_V1,
  ServingStateV1Schema,
} from "@local-studio/contracts/serving-state";
import type { InstanceRefV1, ServingStateV1 } from "@local-studio/contracts/serving-state";
import { ENGINE_IDS } from "../src/modules/compute/contracts";
import {
  SERVED_MODEL_DEEPSEEK as DEEPSEEK,
  SERVED_MODEL_GEMMA as GEMMA,
  SERVING_STATE_N_CRASH_EXITED_V1 as CRASHED,
  SERVING_STATE_N_NAME_MOVED_V1 as MOVED,
  SERVING_STATE_N_PORT_CHANGE_V1 as PORTED,
  SERVING_STATE_N_PRIMARY_REELECTED_V1 as REELECTED,
  SERVING_STATE_N_PRIMARY_UNAVAILABLE_V1 as UNAVAILABLE,
  SERVING_STATE_N_RESTART_V1 as RESTARTED,
  SERVING_STATE_N_STARTING_V1 as STARTING,
  SERVING_STATE_N_STOP_EXITED_V1 as STOPPED,
  SERVING_STATE_N_V1 as N,
  SERVING_STATE_ONE_V1 as ONE,
  SERVING_STATE_TWO_V1 as TWO,
  SERVING_STATE_ZERO_V1 as ZERO,
} from "./fixtures/serving-state-v1";

type Draft<T = ServingStateV1> = { -readonly [K in keyof T]: Draft<T[K]> };

const decodeState = Schema.decodeUnknownSync(ServingStateV1Schema);
const clone = <T>(value: T): Draft<T> => structuredClone(value) as Draft<T>;

const expectRejected = (mutate: (state: Draft) => void, message?: string): void => {
  const state = clone(N);
  mutate(state);
  const run = (): unknown => decodeState(state);
  if (message === undefined) expect(run).toThrow();
  else expect(run).toThrow(message);
};

const inject = (target: unknown): void => {
  (target as Record<string, unknown>)["extra"] = 1;
};

const inject2 = (target: unknown, key: string, value: unknown): void => {
  (target as Record<string, unknown>)[key] = value;
};

const selectedRef = (state: ServingStateV1, name: string): InstanceRefV1 | undefined =>
  selectReadyReplica(state, name)?.instance;

const VALID: readonly (readonly [string, ServingStateV1])[] = [
  ["zero", ZERO],
  ["one", ONE],
  ["two", TWO],
  ["n", N],
  ["n starting", STARTING],
  ["n stop/exited", STOPPED],
  ["n crash/exited", CRASHED],
  ["n port change", PORTED],
  ["n restart", RESTARTED],
  ["n primary unavailable", UNAVAILABLE],
  ["n primary re-elected", REELECTED],
  ["n name moved", MOVED],
];

describe("serving-state v1 decoding", () => {
  for (const [label, fixture] of VALID) {
    test(`decodes the ${label} fixture`, () => {
      expect(decodeState(structuredClone(fixture))).toEqual(fixture);
    });
  }

  test("decodes a null-model instance represented by no served model", () => {
    const state = clone(N);
    state.instances[3]!.servedModelName = null;
    const model = state.servedModels.find((entry) => entry.name === GEMMA)!;
    model.instances = model.instances.filter((ref) => ref.name !== "gemma-b");
    expect(() => decodeState(state)).not.toThrow();
  });

  test("preserves an empty-string served-model name exactly", () => {
    const state = clone(TWO);
    state.instances[1]!.servedModelName = "";
    state.servedModels.find((entry) => entry.name === GEMMA)!.name = "";
    const decoded = decodeState(state);
    expect(decoded.instances[1]?.servedModelName).toBe("");
    expect(listRoutableServedModelNames(decoded)).toEqual(["", DEEPSEEK]);
    expect(selectReadyReplica(decoded, "")?.instance.name).toBe("gemma-a");
  });
});

const INVALID: readonly (readonly [string, (state: Draft) => void, string?])[] = [
  ["a duplicate nodeId", (s): void => void s.nodes.push({ nodeId: "spark-a" }), "duplicate nodeId spark-a"],
  [
    "a duplicate instance tuple",
    (s): void => void s.instances.push(clone(s.instances[0]!)),
    "duplicate instance",
  ],
  [
    "a duplicate exact served-model name",
    (s): void => void s.servedModels.push({ name: DEEPSEEK, instances: [] }),
    "duplicate served-model name",
  ],
  [
    "a duplicate memory-pool id",
    (s): void =>
      void s.memoryPools.push({
        memoryPoolId: "pool-spark-a-unified",
        nodeId: "spark-b",
        deviceIds: ["gpu-spark-b-1"],
      }),
    "duplicate memory-pool id",
  ],
  [
    "a duplicate reference inside a served model",
    (s): void => {
      const model = s.servedModels.find((entry) => entry.name === DEEPSEEK)!;
      model.instances.push(clone(model.instances[0]!));
    },
    "duplicate instance reference",
  ],
  [
    "duplicate device ids inside a memory pool",
    (s): void => void s.memoryPools[0]!.deviceIds.push("gpu-spark-a-0"),
    "duplicate device gpu-spark-a-0",
  ],
  [
    "an instance whose node is absent",
    (s): void => {
      s.nodes = s.nodes.filter((entry) => entry.nodeId !== "spark-b");
    },
    "references absent node spark-b",
  ],
  [
    "a memory pool whose node is absent",
    (s): void =>
      void s.memoryPools.push({
        memoryPoolId: "pool-spark-c-unified",
        nodeId: "spark-c",
        deviceIds: ["gpu-spark-c-0"],
      }),
    "memory pool pool-spark-c-unified references absent node spark-c",
  ],
  [
    "an absent instance memory-pool reference",
    (s): void => {
      s.instances[0]!.memoryPoolIds = ["missing-pool"];
    },
    "references absent memory pool missing-pool",
  ],
  [
    "an instance memory-pool reference on another node",
    (s): void => {
      s.instances[0]!.memoryPoolIds = ["pool-spark-b-unified"];
    },
    "references memory pool pool-spark-b-unified on node spark-b",
  ],
  [
    "a served-model reference to an absent instance",
    (s): void => void s.servedModels[0]!.instances.push({ nodeId: "spark-a", name: "ghost" }),
    "references absent instance",
  ],
  [
    "a served-model reference with a different exact name",
    (s): void =>
      void s.servedModels
        .find((entry) => entry.name === GEMMA)!
        .instances.push({ nodeId: "spark-a", name: "deepseek-a" }),
    `serving "${DEEPSEEK}"`,
  ],
  [
    "a null-model instance referenced by a served model",
    (s): void => {
      s.instances[3]!.servedModelName = null;
    },
    "serving null",
  ],
  [
    "a model-bearing instance missing from its served-model entry",
    (s): void => {
      const model = s.servedModels.find((entry) => entry.name === DEEPSEEK)!;
      model.instances = model.instances.filter((ref) => ref.name !== "deepseek-b");
    },
    "must appear exactly once in served model",
  ],
  [
    "a model-bearing instance with no served-model entry at all",
    (s): void => {
      s.servedModels = s.servedModels.filter((entry) => entry.name !== DEEPSEEK);
    },
    "must appear exactly once in served model",
  ],
  [
    "a primary reference that does not resolve",
    (s): void => {
      s.primaryInstance = { nodeId: "spark-a", name: "ghost" };
    },
    "primary instance",
  ],
  [
    "a ready instance with unknown health",
    (s): void => {
      s.instances[0]!.health = { status: "unknown", checkedAt: null };
    },
    "ready instance must be healthy",
  ],
  [
    "an unhealthy instance with healthy health",
    (s): void => {
      s.instances[3]!.health = { status: "healthy", checkedAt: null };
    },
    "unhealthy instance must be unhealthy",
  ],
  [
    "a reserving instance with non-unknown health",
    (s): void => {
      s.instances[0]!.state = "reserving";
    },
    "reserving instance must have unknown health",
  ],
  [
    "a starting instance with non-unknown health",
    (s): void => {
      s.instances[0]!.state = "starting";
    },
    "starting instance must have unknown health",
  ],
  [
    "an exited instance with non-unknown health",
    (s): void => {
      s.instances[0]!.state = "exited";
    },
    "exited instance must have unknown health",
  ],
  [
    "a model-bearing instance without an endpoint",
    (s): void => {
      s.instances[0]!.endpoint = null;
    },
    "requires an endpoint",
  ],
  [
    "a model-bearing instance without a logical log handle",
    (s): void => {
      s.instances[0]!.logHandle = null;
    },
    "requires a log handle",
  ],
  ["a non-null visionPairing", (s): void => inject2(s, "visionPairing", {})],
  ["a version other than 1", (s): void => inject2(s, "version", 2)],
  ["an excess property on the root", (s): void => inject(s)],
  ["an excess property on a node ref", (s): void => inject(s.nodes[0])],
  ["an excess property on the primary ref", (s): void => inject(s.primaryInstance)],
  ["an excess property on an instance", (s): void => inject(s.instances[0])],
  ["an excess property on an instance identity ref", (s): void => inject(s.instances[0]!.instance)],
  ["an excess property on instance health", (s): void => inject(s.instances[0]!.health)],
  ["an excess property on an endpoint", (s): void => inject(s.instances[0]!.endpoint)],
  ["an excess property on a served model", (s): void => inject(s.servedModels[0])],
  ["an excess property on a memory pool", (s): void => inject(s.memoryPools[0])],
];

describe("serving-state v1 rejections", () => {
  for (const [label, mutate, message] of INVALID) {
    test(`rejects ${label}`, () => {
      expectRejected(mutate, message);
    });
  }
});

describe("serving-state v1 handle variants", () => {
  const expectStrictVariant = (
    decode: (input: unknown) => unknown,
    valid: Record<string, unknown>,
  ): void => {
    expect(decode(structuredClone(valid))).toEqual(valid);
    expect(() => decode({ ...valid, extra: 1 })).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(HandleReferenceV1Schema)({ ...valid, extra: 1 }),
    ).toThrow();
  };

  test("process handle variant rejects excess properties independently", () => {
    expectStrictVariant(Schema.decodeUnknownSync(ProcessHandleReferenceV1Schema), {
      kind: "process",
      pid: 4101,
      startToken: "4101",
    });
  });

  test("docker handle variant rejects excess properties independently", () => {
    expectStrictVariant(Schema.decodeUnknownSync(DockerHandleReferenceV1Schema), {
      kind: "docker",
      container: "gemma-b",
    });
  });

  test("remote handle variant rejects excess properties independently", () => {
    expectStrictVariant(Schema.decodeUnknownSync(RemoteHandleReferenceV1Schema), {
      kind: "remote",
      nodeId: "spark-b",
      name: "deepseek-b",
    });
  });

  test("pinned handle variant rejects excess properties independently", () => {
    expectStrictVariant(Schema.decodeUnknownSync(PinnedHandleReferenceV1Schema), {
      kind: "pinned",
      holder: "speech",
    });
  });
});

describe("serving-state v1 projections", () => {
  test("both exact names survive independently in the two-model fixture", () => {
    const decoded = decodeState(structuredClone(TWO));
    expect(decoded.instances.map((entry) => entry.servedModelName)).toEqual([DEEPSEEK, GEMMA]);
    expect(decoded.servedModels.map((model) => model.name)).toEqual([DEEPSEEK, GEMMA]);
    expect(listRoutableServedModelNames(decoded)).toEqual([DEEPSEEK, GEMMA]);
  });

  test("replicas stay separate instances under one served-model entry", () => {
    expect(N.instances.filter((entry) => entry.servedModelName === DEEPSEEK)).toHaveLength(2);
    expect(N.servedModels.find((model) => model.name === DEEPSEEK)?.instances).toEqual([
      { nodeId: "spark-a", name: "deepseek-a" },
      { nodeId: "spark-b", name: "deepseek-b" },
    ]);
    expect(listRoutableServedModelNames(N)).toEqual([DEEPSEEK, GEMMA]);
  });

  test("the persisted primary beats the lexically earlier ready replica", () => {
    expect(selectedRef(N, DEEPSEEK)).toEqual({ nodeId: "spark-b", name: "deepseek-b" });
    expect(selectedRef(N, GEMMA)).toEqual({ nodeId: "spark-a", name: "gemma-a" });
    expect(selectedRef(ONE, DEEPSEEK)).toEqual({ nodeId: "spark-a", name: "deepseek-a" });
  });

  test("an unavailable primary falls back in stable code-unit order", () => {
    expect(selectedRef(UNAVAILABLE, DEEPSEEK)).toEqual({ nodeId: "spark-a", name: "deepseek-a" });
    expect(selectedRef(UNAVAILABLE, GEMMA)).toEqual({ nodeId: "spark-a", name: "gemma-a" });
  });

  test("a starting primary falls back and an explicit re-election is honored", () => {
    expect(selectedRef(STARTING, DEEPSEEK)).toEqual({ nodeId: "spark-a", name: "deepseek-a" });
    expect(selectedRef(REELECTED, DEEPSEEK)).toEqual({ nodeId: "spark-a", name: "deepseek-a" });
  });

  test("stopped and crashed served models stay in inventory but leave the routable list", () => {
    expect(STOPPED.servedModels.map((model) => model.name)).toContain(DEEPSEEK);
    expect(listRoutableServedModelNames(STOPPED)).toEqual([GEMMA]);
    expect(selectReadyReplica(STOPPED, DEEPSEEK)).toBeNull();
    expect(listRoutableServedModelNames(CRASHED)).toEqual([DEEPSEEK]);
  });

  test("port change and restart resolve to the moved replica", () => {
    expect(selectReadyReplica(PORTED, DEEPSEEK)?.endpoint?.port).toBe(8899);
    const restarted = selectReadyReplica(RESTARTED, DEEPSEEK);
    expect(restarted?.handle).toEqual({ kind: "process", pid: 5202, startToken: "5202" });
    expect(restarted?.startedAt).toBe("2026-08-09T19:00:00.000Z");
  });

  test("a served name moved to a new instance resolves there", () => {
    expect(selectedRef(MOVED, DEEPSEEK)).toEqual({ nodeId: "spark-b", name: "deepseek-b-2" });
    expect(listRoutableServedModelNames(MOVED)).toEqual([DEEPSEEK, GEMMA]);
  });

  test("unknown, wrong-case, and zero-state lookups return null", () => {
    expect(selectReadyReplica(N, "unknown-model")).toBeNull();
    expect(selectReadyReplica(N, "DeepSeek-V4-Flash-0731")).toBeNull();
    expect(selectReadyReplica(ZERO, DEEPSEEK)).toBeNull();
    expect(listRoutableServedModelNames(ZERO)).toEqual([]);
  });

  test("instance tuple equality is exact and case-sensitive", () => {
    const base = { nodeId: "spark-a", name: "x" };
    expect(instanceRefV1Equals(base, { nodeId: "spark-a", name: "x" })).toBe(true);
    expect(instanceRefV1Equals(base, { nodeId: "spark-b", name: "x" })).toBe(false);
    expect(instanceRefV1Equals(base, { nodeId: "spark-a", name: "X" })).toBe(false);
  });

  test("projections never mutate their inputs", () => {
    const before = JSON.stringify(N);
    selectReadyReplica(N, DEEPSEEK);
    listRoutableServedModelNames(N);
    expect(JSON.stringify(N)).toBe(before);
    expect(Object.isFrozen(N)).toBe(true);
    expect(Object.isFrozen(N.instances)).toBe(true);
  });

  test("the engine vocabulary matches the canonical compute list", () => {
    expect([...SERVING_ENGINE_IDS_V1]).toEqual([...ENGINE_IDS]);
  });
});
