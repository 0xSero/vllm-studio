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
