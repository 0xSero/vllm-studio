import { Effect } from "effect";
import type { Accelerator, HandleReference, InstanceRecord, LaunchPlan } from "../contracts";
import { runCommandAsyncEffect } from "../../../core/command";
import { dockerFlagsFor } from "../engines/devices";
import { LOG_TAIL_BYTES, spawnFailed, type Launcher } from "./launcher";

const NAME_LABEL = "local-studio.instance";
const NONCE_LABEL = "local-studio.nonce";
const DOCKER_TIMEOUT_MS = 30_000;

const containerName = (instanceName: string): string =>
  `local-studio-${instanceName.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;

const docker = (
  args: readonly string[],
  timeoutMs = DOCKER_TIMEOUT_MS,
): Effect.Effect<{ status: number | null; stdout: string; stderr: string }> =>
  runCommandAsyncEffect("docker", [...args], { timeoutMs });

export const makeDockerLauncher = (accelerator: Accelerator): Launcher => ({
  start: (plan: LaunchPlan, record: InstanceRecord) =>
    Effect.gen(function* () {
      if (!plan.image) return yield* spawnFailed(`no image for ${record.engine} on this host`);
      const name = containerName(record.name);
      const deviceFlags = dockerFlagsFor(accelerator, plan.devices);
      const arguments_: string[] = [
        "run",
        "-d",
        "--name",
        name,
        "--label",
        `${NAME_LABEL}=${record.name}`,
        "--label",
        `${NONCE_LABEL}=${record.nonce}`,
        ...deviceFlags.args,
        ...deviceFlags.groupAdd.flatMap((group) => ["--group-add", group]),
        ...plan.ports.flatMap((binding) => ["-p", `${binding.host}:${binding.container}`]),
        ...plan.mounts.flatMap((mount) => [
          "-v",
          `${mount.from}:${mount.to}${mount.readOnly ? ":ro" : ""}`,
        ]),
        ...Object.entries(plan.env).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
        plan.image,
        ...plan.argv,
      ];
      const result = yield* docker(arguments_, 120_000);
      if (result.status !== 0) {
        return yield* spawnFailed(`docker run failed: ${result.stderr || result.stdout}`);
      }
      return { kind: "docker", container: name } as const;
    }),

  alive: (reference: HandleReference) =>
    reference.kind !== "docker"
      ? Effect.succeed(false)
      : docker(["inspect", "-f", "{{.State.Running}}", reference.container]).pipe(
          Effect.map((result) => result.status === 0 && result.stdout.trim() === "true"),
        ),

  owns: (reference: HandleReference, record: InstanceRecord) =>
    reference.kind !== "docker"
      ? Effect.succeed(false)
      : docker([
          "inspect",
          "-f",
          `{{index .Config.Labels "${NONCE_LABEL}"}}`,
          reference.container,
        ]).pipe(
          Effect.map((result) => result.status === 0 && result.stdout.trim() === record.nonce),
        ),

  stop: (reference: HandleReference, graceMs: number) =>
    reference.kind !== "docker"
      ? Effect.void
      : Effect.gen(function* () {
          yield* docker(
            ["stop", "-t", String(Math.ceil(graceMs / 1000)), reference.container],
            graceMs + DOCKER_TIMEOUT_MS,
          ).pipe(Effect.ignore);
          yield* docker(["rm", "-f", reference.container]).pipe(Effect.ignore);
        }),

  logTail: (reference: HandleReference) =>
    reference.kind !== "docker"
      ? Effect.succeed("")
      : docker(["logs", "--tail", "60", reference.container]).pipe(
          Effect.map((result) =>
            `${result.stdout}\n${result.stderr}`.trim().slice(-LOG_TAIL_BYTES),
          ),
        ),
});
