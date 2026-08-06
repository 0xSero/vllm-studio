import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import type { AsyncCommandResult } from "../src/core/command";
import { logProxyModuleUrl } from "../src/core/log-proxy";
import type { HandleReference, InstanceRecord, LaunchPlan } from "../src/modules/compute/contracts";
import { makeDockerLauncher, type DockerLauncherRuntime } from "../src/modules/compute/launchers/docker";
import { makeProcessLauncher, type ProcessIdentity, type ProcessLauncherRuntime } from "../src/modules/compute/launchers/process";
import { makeInstanceStore } from "../src/modules/compute/instances/store";

const root = mkdtempSync(join(tmpdir(), "process-launcher-test-"));
const logPath = join(root, "model.log");

afterAll(() => rmSync(root, { recursive: true, force: true }));

const record: InstanceRecord = {
  name: "model",
  nodeId: "self",
  engine: "vllm",
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
  argv: ["/bin/sh", "-c", "printf fresh"],
  env: {},
  ports: [],
  mounts: [],
  devices: [],
  health: { path: "/health", readyDeadlineMs: 60_000, intervalMs: 100 },
};

const waitForExit = async (
  launcher: ReturnType<typeof makeProcessLauncher>,
  reference: HandleReference,
): Promise<void> => {
  const durable = { ...record, ref: reference };
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!(await Effect.runPromise(launcher.alive(reference, durable)))) return;
    await Bun.sleep(10);
  }
};

describe("process launcher logs", () => {
  test("a new launch cannot inherit a previous failure", async () => {
    writeFileSync(logPath, "stale failure\n");
    const launcher = makeProcessLauncher(() => logPath);
    const reference = await Effect.runPromise(launcher.start(plan, record));
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (!(await Effect.runPromise(launcher.alive(reference, { ...record, ref: reference })))) break;
      await Bun.sleep(10);
    }
    const tail = await Effect.runPromise(launcher.logTail(reference, record));
    expect(tail).toBe("fresh");
    expect(readFileSync(logPath, "utf8")).toBe("fresh");
  });

  test("redacts fragmented engine credentials before persistence", async () => {
    const secret = "synthetic-engine-secret";
    const launcher = makeProcessLauncher(() => logPath);
    const reference = await Effect.runPromise(
      launcher.start(
        {
          ...plan,
          argv: [
            process.execPath,
            "-e",
            `process.stdout.write("OPENAI_API_"); setTimeout(() => process.stderr.write("KEY=${secret}"), 50)`,
          ],
        },
        record,
      ),
    );
    await waitForExit(launcher, reference);
    const persisted = readFileSync(logPath, "utf8");
    const tail = await Effect.runPromise(launcher.logTail(reference, { ...record, ref: reference }));
    expect(persisted).not.toContain(secret);
    expect(persisted).toContain("OPENAI_API_KEY=[redacted]");
    expect(tail).toBe(persisted);
    if (process.platform !== "win32") expect(statSync(logPath).mode & 0o777).toBe(0o600);
  });

  test("keeps redacting after the detached launch parent exits", async () => {
    if (process.platform === "win32") return;
    const detachedLog = join(root, "detached.log");
    const harness = join(root, "detach-harness.mjs");
    const secret = "detached-engine-secret";
    const engine = `process.stdout.write("OPENAI_API_"); setTimeout(() => process.stderr.write("KEY=${secret}"), 100)`;
    writeFileSync(
      harness,
      `import { spawn } from "node:child_process"; const child = spawn(${JSON.stringify(process.execPath)}, [${JSON.stringify(fileURLToPath(logProxyModuleUrl))}, ${JSON.stringify(detachedLog)}, ${JSON.stringify(process.execPath)}, "-e", ${JSON.stringify(engine)}], { detached: true, stdio: "ignore" }); child.unref();`,
    );
    expect(spawnSync(process.execPath, [harness]).status).toBe(0);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const output = existsSync(detachedLog) ? readFileSync(detachedLog, "utf8") : "";
      if (output.includes("[redacted]")) break;
      await Bun.sleep(10);
    }
    const persisted = readFileSync(detachedLog, "utf8");
    expect(persisted).not.toContain(secret);
    expect(persisted).toContain("OPENAI_API_KEY=[redacted]");
  });

  test("does not tail a replaced log symlink", async () => {
    if (process.platform === "win32") return;
    const target = join(root, "sensitive.txt");
    rmSync(logPath, { force: true });
    writeFileSync(target, "sensitive-content");
    symlinkSync(target, logPath);
    const launcher = makeProcessLauncher(() => logPath);
    expect(
      await Effect.runPromise(
        launcher.logTail(
          {
            kind: "process",
            pid: process.pid,
            processGroupId: null,
            sessionId: null,
            startToken: null,
          },
          record,
        ),
      ),
    ).toBe("");
    expect(readFileSync(target, "utf8")).toBe("sensitive-content");
  });
});

const processReference = { kind: "process", pid: 100, processGroupId: 100, sessionId: 100, startToken: "start" } as const satisfies HandleReference;
const processRecord = { ...record, ref: processReference };
const member = (overrides: Partial<ProcessIdentity> = {}): ProcessIdentity =>
  ({ pid: 100, processGroupId: 100, sessionId: 100, startToken: "start", launchMarker: record.nonce, ...overrides });
const processRuntime = (
  platform: NodeJS.Platform,
  group: readonly ProcessIdentity[] | null,
  signals: string[],
): ProcessLauncherRuntime => ({
  platform,
  readIdentity: () => null,
  readGroup: () => group,
  signalGroup: (_group, signal) => void signals.push(signal),
});

test("native cleanup fails closed for every unproved identity", async () => {
  const cases: ReadonlyArray<readonly [NodeJS.Platform, readonly ProcessIdentity[] | null, InstanceRecord?]> = [
    ["darwin", [member()]],
    ["linux", null],
    ["linux", [member({ launchMarker: null })]],
    ["linux", [member({ startToken: "reused" })]],
    ["linux", [member(), member({ pid: 101, launchMarker: "other" })]],
    ["linux", [member(), member({ pid: 101, sessionId: 9 })]],
    ["linux", [member()], { ...processRecord, ref: { ...processReference, startToken: "other" } }],
  ];
  for (const [platform, group, durable = processRecord] of cases) {
    const signals: string[] = [];
    const launcher = makeProcessLauncher(() => logPath, processRuntime(platform, group, signals));
    await Effect.runPromise(launcher.stop(processReference, durable, 0));
    expect(signals).toEqual([]);
  }
});

test("native restart proof owns an orphan group and revalidates before escalation", async () => {
  const complete: string[] = [];
  await Effect.runPromise(makeProcessLauncher(() => logPath, processRuntime("linux", [member({ pid: 101 })], complete)).stop(processReference, processRecord, 0));
  expect(complete).toEqual(["SIGTERM", "SIGKILL"]);
  let group = [member({ pid: 101 })];
  const signals: string[] = [];
  const runtime = processRuntime("linux", group, signals);
  const launcher = makeProcessLauncher(() => logPath, {
    ...runtime,
    readGroup: () => group,
    signalGroup: (_group, signal) => {
      signals.push(signal);
      if (signal === "SIGTERM") group = [member({ pid: 101, launchMarker: "drift" })];
    },
  });
  expect(await Effect.runPromise(launcher.owns(processReference, processRecord))).toBe(true);
  await Effect.runPromise(launcher.stop(processReference, processRecord, 0));
  expect(signals).toEqual(["SIGTERM"]);
});

test("native launch retries durable proof and keeps non-Linux cleanup in memory", async () => {
  let reads = 0; const linux = processRuntime("linux", [], []);
  const proved = await Effect.runPromise(makeProcessLauncher(() => logPath, { ...linux, readIdentity: (pid) => ++reads === 3 ? member({ pid, processGroupId: pid, sessionId: pid }) : null }).start(plan, record));
  expect([proved.kind === "process" ? proved.startToken : null, reads]).toEqual(["start", 3]);
  const fallbackLauncher = makeProcessLauncher(() => logPath, processRuntime("darwin", [], []));
  const fallback = await Effect.runPromise(fallbackLauncher.start({ ...plan, argv: [process.execPath, "-e", "setTimeout(()=>{},10000)"] }, record)); const durable = { ...record, ref: fallback };
  expect(await Effect.runPromise(fallbackLauncher.owns(fallback, durable))).toBe(true); await Effect.runPromise(fallbackLauncher.stop(fallback, durable, 0));
  expect(await Effect.runPromise(fallbackLauncher.owns(fallback, durable))).toBe(false);
});

const containerId = "a".repeat(64);
const dockerReference = { kind: "docker", containerId, daemonId: "daemon", executablePath: "/docker", executableToken: "exec" } as const satisfies HandleReference;
const dockerRecord = { ...record, runtime: "docker" as const, ref: dockerReference };
const commandResult = (stdout = "", status = 0, stderr = record.nonce): AsyncCommandResult => ({ status, stdout, stderr, timedOut: false, signal: null });
const dockerRuntime = () => {
  const state: { executable: { path: string; token: string } | null; daemon: string; inspect: string; inspectStatus: number; inspectError: string; runStatus: number; driftAfterStop: boolean } = {
    executable: { path: "/docker", token: "exec" },
    daemon: "daemon",
    inspect: `${containerId}\n${record.nonce}\n${record.name}\ntrue`,
    inspectStatus: 0, inspectError: record.nonce, runStatus: 0, driftAfterStop: false,
  };
  const actions: string[] = [];
  const runtime: DockerLauncherRuntime = {
    resolveExecutable: () => state.executable,
    run: (_executable, args) => {
      const action = args[0] ?? "";
      if (action === "info") return Effect.succeed(commandResult(state.daemon));
      if (action === "inspect") return Effect.succeed(commandResult(state.inspect, state.inspectStatus, state.inspectError));
      actions.push(action);
      if (action === "run" && state.driftAfterStop) state.daemon = "other";
      if (action === "stop" && state.driftAfterStop) state.inspect = "drift";
      return Effect.succeed(commandResult(action === "run" ? containerId : "", state.runStatus));
    },
  };
  return { state, actions, runtime };
};

test("Docker launch never removes a name and persists only post-launch proof", async () => {
  const fake = dockerRuntime();
  const launcher = makeDockerLauncher("cuda", fake.runtime);
  const reference = await Effect.runPromise(launcher.start({ ...plan, kind: "docker", image: "image" }, { ...dockerRecord, ref: null }));
  expect(reference).toEqual(dockerReference);
  expect(fake.actions).toEqual(["run"]);
  fake.state.driftAfterStop = true;
  expect((await Effect.runPromiseExit(launcher.start({ ...plan, kind: "docker", image: "image" }, { ...dockerRecord, ref: null })))._tag).toBe("Failure");
});

test("Docker cleanup revalidates every exact identity before actions", async () => {
  const owned = dockerRuntime();
  await Effect.runPromise(makeDockerLauncher("cuda", owned.runtime).stop(dockerReference, dockerRecord, 0));
  expect(owned.actions).toEqual(["stop", "rm"]);
  const drift = dockerRuntime(); drift.state.driftAfterStop = true;
  await Effect.runPromise(makeDockerLauncher("cuda", drift.runtime).stop(dockerReference, dockerRecord, 0));
  expect(drift.actions).toEqual(["stop"]);
  const changes = [
    (fake: ReturnType<typeof dockerRuntime>) => (fake.state.executable = null),
    (fake: ReturnType<typeof dockerRuntime>) => (fake.state.executable = { path: "/docker", token: "drift" }),
    (fake: ReturnType<typeof dockerRuntime>) => (fake.state.daemon = "other"),
    (fake: ReturnType<typeof dockerRuntime>) => (fake.state.inspect = `b${containerId.slice(1)}\n${record.nonce}\n${record.name}\ntrue`),
    (fake: ReturnType<typeof dockerRuntime>) => (fake.state.inspect = `${containerId}\nother\n${record.name}\ntrue`),
    (fake: ReturnType<typeof dockerRuntime>) => (fake.state.inspectStatus = 1),
  ];
  for (const change of changes) {
    const fake = dockerRuntime();
    change(fake);
    await Effect.runPromise(makeDockerLauncher("cuda", fake.runtime).stop(dockerReference, dockerRecord, 0));
    expect(fake.actions).toEqual([]);
    expect(await Effect.runPromise(makeDockerLauncher("cuda", fake.runtime).alive(dockerReference, dockerRecord))).toBe(true);
  }
  const gone = dockerRuntime(); gone.state.inspectStatus = 1;
  gone.state.inspectError = `Error: No such object: ${containerId}`;
  expect(await Effect.runPromise(makeDockerLauncher("cuda", gone.runtime).alive(dockerReference, dockerRecord))).toBe(false);
  const stopped = dockerRuntime(); stopped.state.inspect = `${containerId}\n${record.nonce}\n${record.name}\nfalse`;
  expect(await Effect.runPromise(makeDockerLauncher("cuda", stopped.runtime).alive(dockerReference, dockerRecord))).toBe(false);
  await Effect.runPromise(makeDockerLauncher("cuda", stopped.runtime).stop(dockerReference, dockerRecord, 0)); expect(stopped.actions).toEqual(["stop", "rm"]);
});

test("instance records are schema-valid, atomic, and owner-only", () => {
  const store = makeInstanceStore(join(root, "data"));
  store.write(processRecord);
  const path = join(store.directory, "model.json");
  expect(statSync(store.directory).mode & 0o777).toBe(0o700);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  writeFileSync(path, "{}");
  expect(() => store.read("model")).toThrow();
});
