import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type {
  HandleReference,
  HostProfile,
  InstanceRecord,
  LaunchFailure,
  ServingOptions,
} from "../src/modules/compute/contracts";
import type { InstanceStore } from "../src/modules/compute/instances/store";
import type { Launcher } from "../src/modules/compute/launchers/launcher";
import { makeComputeService, type ComputeLaunchInput } from "../src/modules/compute/lifecycle";

const root = mkdtempSync(join(tmpdir(), "compute-lifecycle-regression-"));
const host: HostProfile = {
  nodeId: "self",
  platform: "linux",
  arch: "x64",
  accelerator: "cuda",
  unifiedMemory: false,
  wsl: false,
  docker: false,
  dockerGpu: false,
  deviceCount: 1,
};
const options: ServingOptions = {
  tensorParallel: 1,
  pipelineParallel: 1,
  maxContextLength: 4096,
  memoryFraction: 0.9,
  maxConcurrentRequests: 32,
  kvCacheDtype: null,
  dtype: null,
  quantization: null,
  trustRemoteCode: false,
  toolCallParser: null,
  reasoningParser: null,
};
const input: ComputeLaunchInput = {
  name: "model",
  engine: "llamacpp",
  recipeId: "recipe",
  runtime: "process",
  deviceCount: 1,
  modelPath: "/models/model.gguf",
  servedModelName: "model",
  options,
  extraArgs: [],
  env: {},
  dockerImage: null,
  binary: "llama-server",
};
const startedReference: HandleReference = {
  kind: "process",
  pid: 2000,
  processGroupId: 2000,
  sessionId: 2000,
  startToken: null,
};

const makeStore = (): InstanceStore => {
  const records = new Map<string, InstanceRecord>();
  return {
    directory: root,
    read: (name) => records.get(name) ?? null,
    all: () => [...records.values()],
    write: (record) => void records.set(record.name, record),
    drop: (name) => void records.delete(name),
    logPath: (name) => join(root, `${name}.log`),
    reserve: (reservation): Effect.Effect<InstanceRecord, LaunchFailure> => {
      const now = Date.now();
      const record: InstanceRecord = {
        name: reservation.name,
        nodeId: reservation.nodeId,
        engine: reservation.engine,
        recipeId: reservation.recipeId,
        runtime: reservation.runtime,
        ref: null,
        port: reservation.basePort,
        devices: reservation.candidates.slice(0, reservation.need),
        nonce: "nonce",
        startedAt: new Date(now).toISOString(),
        readyDeadlineAt: new Date(now + reservation.readyDeadlineMs).toISOString(),
      };
      records.set(record.name, record);
      return Effect.succeed(record);
    },
    heldDevices: () => Effect.succeed(new Set()),
    allocatePort: (basePort) => basePort,
  };
};

const launcher = (failure: LaunchFailure): Launcher => ({
  start: () => Effect.fail(failure),
  alive: (reference) =>
    Effect.succeed(reference.kind === "process" && reference.pid === startedReference.pid),
  owns: () => Effect.succeed(false),
  stop: () => Effect.sync(() => undefined),
  logTail: () => Effect.succeed(""),
});

test("post-spawn proof failure retains an unproved live handle", async () => {
  const store = makeStore();
  const compute = makeComputeService({
    store,
    launcherFor: () =>
      launcher({
        kind: "spawn-failed",
        detail: "spawned process identity could not be proved",
        startedReference,
      }),
    host: () => Effect.succeed(host),
    freeDevices: () => Effect.succeed(["GPU-a"]),
    onEvent: () => Effect.void,
  });

  const exit = await Effect.runPromiseExit(compute.launch(input));

  expect(exit._tag).toBe("Failure");
  expect(store.read(input.name)?.ref).toEqual(startedReference);
  rmSync(root, { recursive: true, force: true });
});
