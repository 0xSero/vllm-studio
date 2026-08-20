import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { HandleReference, InstanceRecord, LaunchPlan } from "../src/modules/compute/contracts";
import { makeInstanceStore } from "../src/modules/compute/instances/store";
import {
  makeProcessLauncher,
  type ProcessIdentity,
  type ProcessLauncherRuntime,
} from "../src/modules/compute/launchers/process";

const root = mkdtempSync(join(tmpdir(), "process-launcher-regression-"));
const record: InstanceRecord = {
  name: "model",
  nodeId: "self",
  engine: "llamacpp",
  recipeId: "recipe",
  runtime: "process",
  ref: null,
  port: 8000,
  devices: [],
  nonce: "nonce",
  startedAt: new Date(0).toISOString(),
  readyDeadlineAt: new Date(60_000).toISOString(),
};
const plan: LaunchPlan = {
  kind: "process",
  argv: [process.execPath, "-e", "setTimeout(() => {}, 10000)"],
  env: {},
  ports: [],
  mounts: [],
  devices: [],
  health: { path: "/health", readyDeadlineMs: 60_000, intervalMs: 100 },
};

afterAll(() => rmSync(root, { recursive: true, force: true }));

test("failed process proof returns a retryable cleanup handle", async () => {
  const signals: string[] = [];
  const runtime: ProcessLauncherRuntime = {
    platform: "linux",
    readIdentity: () => null,
    readGroup: () => [],
    signalGroup: (group, signal) => {
      signals.push(signal);
      try {
        process.kill(-group, signal);
      } catch {}
    },
  };
  const launcher = makeProcessLauncher(() => join(root, "model.log"), runtime);
  const failure = await Effect.runPromise(Effect.flip(launcher.start(plan, record)));

  expect(failure.kind).toBe("spawn-failed");
  expect(signals).toEqual([]);
  expect(failure.kind === "spawn-failed" ? failure.startedReference : null).toEqual({
    kind: "process",
    pid: expect.any(Number),
    processGroupId: expect.any(Number),
    sessionId: expect.any(Number),
    startToken: null,
  } satisfies HandleReference);
  if (failure.kind !== "spawn-failed" || !failure.startedReference) return;
  await Effect.runPromise(
    launcher.stop(failure.startedReference, { ...record, ref: failure.startedReference }, 0),
  );
  expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
});

const durableIdentity = (pid: number, startToken = "mac-start"): ProcessIdentity => ({
  pid,
  processGroupId: pid,
  sessionId: pid,
  startToken,
  launchMarker: null,
});

test("persisted macOS identity remains owned after launcher recreation", async () => {
  const signals: string[] = [];
  const runtime: ProcessLauncherRuntime = {
    platform: "darwin",
    readIdentity: (pid) => durableIdentity(pid),
    readGroup: (group) => [durableIdentity(group)],
    signalGroup: (group, signal) => {
      signals.push(signal);
      try {
        process.kill(-group, signal);
      } catch {}
    },
  };
  const launcher = makeProcessLauncher(() => join(root, "model.log"), runtime);
  const started = await Effect.runPromise(launcher.start(plan, record));
  const store = makeInstanceStore(join(root, "state"));
  store.write({ ...record, ref: started });
  const persisted = store.read(record.name);
  expect(persisted?.ref).toEqual(started);
  if (!persisted?.ref) return;
  const restartedLauncher = makeProcessLauncher(() => join(root, "model.log"), runtime);
  expect(await Effect.runPromise(restartedLauncher.owns(persisted.ref, persisted))).toBe(true);
  await Effect.runPromise(restartedLauncher.stop(persisted.ref, persisted, 0));
  expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
});

test("non-Linux cleanup signals the owned process group", async () => {
  const signals: string[] = [];
  const reference = {
    kind: "process",
    pid: 100,
    processGroupId: 100,
    sessionId: 100,
    startToken: "start",
  } as const;
  const member = (pid: number): ProcessIdentity => ({
    ...durableIdentity(pid, "start"),
    processGroupId: 100,
    sessionId: 100,
  });
  const runtime: ProcessLauncherRuntime = {
    platform: "darwin",
    readIdentity: (pid) => member(pid),
    readGroup: () => [member(100), member(101)],
    signalGroup: (_group, signal) => signals.push(signal),
  };
  const launcher = makeProcessLauncher(() => join(root, "model.log"), runtime);
  await Effect.runPromise(launcher.stop(reference, { ...record, ref: reference }, 0));
  expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
});

test("Windows cleanup signals only the proven process tree", async () => {
  const signals: string[] = [];
  const reference = {
    kind: "process",
    pid: 300,
    processGroupId: 300,
    sessionId: 300,
    startToken: "windows-start",
  } as const;
  const member = (pid: number): ProcessIdentity => ({
    ...durableIdentity(pid, "windows-start"),
    processGroupId: 300,
    sessionId: 300,
  });
  const runtime: ProcessLauncherRuntime = {
    platform: "win32",
    readIdentity: (pid) => member(pid),
    readGroup: () => [member(300), member(301)],
    signalGroup: (_group, signal) => signals.push(signal),
  };
  const launcher = makeProcessLauncher(() => join(root, "model.log"), runtime);
  await Effect.runPromise(launcher.stop(reference, { ...record, ref: reference }, 0));
  expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
});

test("foreign process generations are never signalled", async () => {
  const signals: string[] = [];
  const reference = {
    kind: "process",
    pid: 400,
    processGroupId: 400,
    sessionId: 400,
    startToken: "expected-start",
  } as const;
  const runtime: ProcessLauncherRuntime = {
    platform: "darwin",
    readIdentity: () => durableIdentity(400, "foreign-start"),
    readGroup: () => [durableIdentity(400, "foreign-start")],
    signalGroup: (_group, signal) => signals.push(signal),
  };
  const launcher = makeProcessLauncher(() => join(root, "model.log"), runtime);
  expect(await Effect.runPromise(launcher.owns(reference, { ...record, ref: reference }))).toBe(false);
  await Effect.runPromise(launcher.stop(reference, { ...record, ref: reference }, 0));
  expect(signals).toEqual([]);
});

test("a reused pid cannot bypass durable same-process proof", async () => {
  const signals: string[] = [];
  let phase: "launch" | "reused" = "launch";
  const runtime: ProcessLauncherRuntime = {
    platform: "darwin",
    readIdentity: (pid) => durableIdentity(pid, phase === "launch" ? "owned-start" : "foreign-start"),
    readGroup: (group) => [durableIdentity(group, "foreign-start")],
    signalGroup: (_group, signal) => signals.push(signal),
  };
  const launcher = makeProcessLauncher(() => join(root, "model.log"), runtime);
  const started = await Effect.runPromise(launcher.start(plan, record));
  phase = "reused";
  expect(await Effect.runPromise(launcher.owns(started, { ...record, ref: started }))).toBe(false);
  await Effect.runPromise(launcher.stop(started, { ...record, ref: started }, 0));
  expect(signals).toEqual([]);
  if (started.kind === "process") {
    try {
      process.kill(started.pid, "SIGKILL");
    } catch {}
  }
});
