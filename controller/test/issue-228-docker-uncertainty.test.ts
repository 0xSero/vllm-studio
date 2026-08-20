import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { AsyncCommandResult } from "../src/core/command";
import type { HandleReference, InstanceRecord, LaunchPlan } from "../src/modules/compute/contracts";
import {
  makeDockerLauncher,
  type DockerLauncherRuntime,
} from "../src/modules/compute/launchers/docker";

const containerId = "a".repeat(64);
const record: InstanceRecord = {
  name: "model",
  nodeId: "self",
  engine: "vllm",
  recipeId: "recipe",
  runtime: "docker",
  ref: null,
  port: 8000,
  devices: [],
  nonce: "nonce",
  startedAt: new Date(0).toISOString(),
  readyDeadlineAt: new Date(60_000).toISOString(),
};
const plan: LaunchPlan = {
  kind: "docker",
  argv: ["server"],
  env: {},
  ports: [],
  mounts: [],
  devices: [],
  health: { path: "/health", readyDeadlineMs: 60_000, intervalMs: 100 },
  image: "image",
};
const result = (stdout = "", status: number | null = 0, stderr = ""): AsyncCommandResult => ({
  status,
  stdout,
  stderr,
  timedOut: status === null,
  signal: null,
});

test("ambiguous docker run discovers and retains the exact cleanup reference", async () => {
  const actions: string[] = [];
  const runtime: DockerLauncherRuntime = {
    resolveExecutable: () => ({ path: "/docker", token: "exec" }),
    run: (_executable, args) => {
      const action = args[0] ?? "";
      actions.push(action);
      if (action === "info") return Effect.succeed(result("daemon"));
      if (action === "run") return Effect.succeed(result("", null, "request timed out"));
      if (action === "inspect") {
        return Effect.succeed(result(`${containerId}\nnonce\nmodel\ntrue`));
      }
      return Effect.succeed(result());
    },
  };
  const launcher = makeDockerLauncher("cuda", runtime);
  const failure = await Effect.runPromise(
    Effect.flip(launcher.start(plan, record)),
  );

  expect(failure.kind).toBe("spawn-failed");
  expect(failure.kind === "spawn-failed" ? failure.startedReference : null).toEqual({
    kind: "docker",
    containerId,
    daemonId: "daemon",
    executablePath: "/docker",
    executableToken: "exec",
  } satisfies HandleReference);
  expect(actions).toEqual(["info", "run", "inspect", "info", "inspect"]);
});

const pendingReference = (): Extract<HandleReference, { kind: "docker-pending" }> => ({
  kind: "docker-pending",
  containerName: "local-studio-model",
  nonce: "nonce",
  daemonId: "daemon",
  executablePath: "/docker",
  executableToken: "exec",
});

const exactInspect = (id = containerId, nonce = "nonce", name = "model"): string =>
  `${id}\n${nonce}\n${name}\ntrue`;

test("bounded docker recovery finds a container that appears after the first inspect", async () => {
  const actions: string[] = [];
  let inspectCount = 0;
  const runtime: DockerLauncherRuntime = {
    resolveExecutable: () => ({ path: "/docker", token: "exec" }),
    run: (_executable, args) => {
      const action = args[0] ?? "";
      actions.push(action);
      if (action === "info") return Effect.succeed(result("daemon"));
      if (action === "run") return Effect.succeed(result("", null, "request timed out"));
      if (action === "inspect") {
        inspectCount += 1;
        return Effect.succeed(
          inspectCount < 3 ? result("", 1, "No such object") : result(exactInspect()),
        );
      }
      return Effect.succeed(result());
    },
  };
  const launcher = makeDockerLauncher("cuda", runtime);
  const failure = await Effect.runPromise(Effect.flip(launcher.start(plan, record)));

  expect(failure.kind).toBe("spawn-failed");
  expect(failure.kind === "spawn-failed" ? failure.startedReference : null).toEqual({
    kind: "docker",
    containerId,
    daemonId: "daemon",
    executablePath: "/docker",
    executableToken: "exec",
  });
  expect(inspectCount).toBe(4);
  expect(actions).toEqual(["info", "run", "inspect", "inspect", "inspect", "info", "inspect"]);
});

test("bounded docker recovery retries a temporarily unavailable daemon", async () => {
  const actions: string[] = [];
  let infoCount = 0;
  const runtime: DockerLauncherRuntime = {
    resolveExecutable: () => ({ path: "/docker", token: "exec" }),
    run: (_executable, args) => {
      const action = args[0] ?? "";
      actions.push(action);
      if (action === "info") {
        infoCount += 1;
        return Effect.succeed(infoCount === 2 ? result("", 1, "daemon unavailable") : result("daemon"));
      }
      if (action === "run") return Effect.succeed(result("", null, "request timed out"));
      if (action === "inspect") return Effect.succeed(result(exactInspect()));
      return Effect.succeed(result());
    },
  };
  const launcher = makeDockerLauncher("cuda", runtime);
  const failure = await Effect.runPromise(Effect.flip(launcher.start(plan, record)));

  expect(failure.kind).toBe("spawn-failed");
  expect(failure.kind === "spawn-failed" ? failure.startedReference : null).toEqual({
    kind: "docker",
    containerId,
    daemonId: "daemon",
    executablePath: "/docker",
    executableToken: "exec",
  });
  expect(infoCount).toBe(3);
  expect(actions).toEqual(["info", "run", "inspect", "info", "inspect", "info", "inspect"]);
});

test("unresolved docker ambiguity persists a label-bound reference for later cleanup", async () => {
  const actions: string[] = [];
  const commands: string[][] = [];
  let available = false;
  const runtime: DockerLauncherRuntime = {
    resolveExecutable: () => ({ path: "/docker", token: "exec" }),
    run: (_executable, args) => {
      const action = args[0] ?? "";
      actions.push(action);
      commands.push([...args]);
      if (action === "info") return Effect.succeed(result("daemon"));
      if (action === "run") return Effect.succeed(result("", null, "request timed out"));
      if (action === "inspect") {
        return Effect.succeed(available ? result(exactInspect()) : result("", 1, "No such object"));
      }
      return Effect.succeed(result());
    },
  };
  const launcher = makeDockerLauncher("cuda", runtime);
  const failure = await Effect.runPromise(Effect.flip(launcher.start(plan, record)));

  expect(failure.kind).toBe("spawn-failed");
  const retained = failure.kind === "spawn-failed" ? failure.startedReference : undefined;
  expect(retained).toEqual(pendingReference());
  if (!retained) return;

  available = true;
  const persisted = { ...record, ref: retained };
  expect(await Effect.runPromise(launcher.owns(retained, persisted))).toBe(true);
  await Effect.runPromise(launcher.stop(retained, persisted, 0));
  expect(actions).toContain("stop");
  expect(actions).toContain("rm");
  expect(commands.find(([action]) => action === "stop")?.at(-1)).toBe(containerId);
  expect(commands.find(([action]) => action === "rm")?.at(-1)).toBe(containerId);
});

test("foreign same-name docker labels cannot satisfy or trigger pending cleanup", async () => {
  const actions: string[] = [];
  const foreignId = "b".repeat(64);
  const runtime: DockerLauncherRuntime = {
    resolveExecutable: () => ({ path: "/docker", token: "exec" }),
    run: (_executable, args) => {
      const action = args[0] ?? "";
      actions.push(action);
      if (action === "info") return Effect.succeed(result("daemon"));
      if (action === "run") return Effect.succeed(result("", null, "request timed out"));
      if (action === "inspect") return Effect.succeed(result(exactInspect(foreignId, "foreign", "model")));
      return Effect.succeed(result());
    },
  };
  const launcher = makeDockerLauncher("cuda", runtime);
  const failure = await Effect.runPromise(Effect.flip(launcher.start(plan, record)));

  expect(failure.kind).toBe("spawn-failed");
  const retained = failure.kind === "spawn-failed" ? failure.startedReference : undefined;
  expect(retained).toEqual(pendingReference());
  if (!retained) return;
  const persisted = { ...record, ref: retained };
  expect(await Effect.runPromise(launcher.owns(retained, persisted))).toBe(false);
  await Effect.runPromise(launcher.stop(retained, persisted, 0));
  expect(actions).not.toContain("stop");
  expect(actions).not.toContain("rm");
});
