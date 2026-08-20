import { realpathSync, statSync } from "node:fs";
import { Effect } from "effect";
import type {
  Accelerator,
  HandleReference,
  InstanceRecord,
  LaunchFailure,
  LaunchPlan,
} from "../contracts";
import { resolveBinary, runCommandAsyncEffect, type AsyncCommandResult } from "../../../core/command";
import { dockerFlagsFor } from "../engines/devices";
import { LOG_TAIL_BYTES, spawnFailed, type Launcher } from "./launcher";

const NAME_LABEL = "local-studio.instance";
const NONCE_LABEL = "local-studio.nonce";
const DOCKER_TIMEOUT_MS = 30_000;
const RECOVERY_ATTEMPTS = 4;
const RECOVERY_DELAY_MS = 50;
const RECOVERY_DEADLINE_MS = 30_000;
const INSPECT_FORMAT = `{{.Id}}\n{{index .Config.Labels "${NONCE_LABEL}"}}\n{{index .Config.Labels "${NAME_LABEL}"}}\n{{.State.Running}}`;

const containerName = (instanceName: string): string =>
  `local-studio-${instanceName.replace(/[^a-zA-Z0-9_.-]/g, "_")}`;

export interface DockerExecutable {
  readonly path: string;
  readonly token: string;
}

export interface DockerLauncherRuntime {
  readonly resolveExecutable: () => DockerExecutable | null;
  readonly run: (
    executable: string,
    args: readonly string[],
    timeoutMs: number,
  ) => Effect.Effect<AsyncCommandResult>;
}

export interface DockerLauncherOptions {
  readonly recoveryDeadlineMs?: number;
}

type DockerReference = Extract<HandleReference, { readonly kind: "docker" }>;
type PendingDockerReference = Extract<HandleReference, { readonly kind: "docker-pending" }>;
type DockerState = "owned" | "stopped" | "gone" | "unknown";

const realRuntime: DockerLauncherRuntime = {
  resolveExecutable: () => {
    try {
      const resolved = resolveBinary("docker");
      if (!resolved) return null;
      const path = realpathSync.native(resolved);
      const stat = statSync(path);
      return { path, token: `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}` };
    } catch {
      return null;
    }
  },
  run: (executable, args, timeoutMs) => runCommandAsyncEffect(executable, [...args], { timeoutMs }),
};

const docker = (
  runtime: DockerLauncherRuntime,
  executable: string,
  args: readonly string[],
  timeoutMs = DOCKER_TIMEOUT_MS,
): Effect.Effect<AsyncCommandResult> => runtime.run(executable, args, timeoutMs);

const sameExecutable = (reference: HandleReference, executable: DockerExecutable | null): boolean =>
  reference.kind === "docker" &&
  executable?.path === reference.executablePath &&
  executable.token === reference.executableToken;

const sameDockerReference = (reference: HandleReference, record: InstanceRecord): boolean => {
  const stored = record.ref;
  return reference.kind === "docker" &&
    stored?.kind === "docker" &&
    reference.containerId === stored.containerId &&
    reference.daemonId === stored.daemonId &&
    reference.executablePath === stored.executablePath &&
    reference.executableToken === stored.executableToken;
};

const samePendingReference = (reference: HandleReference, record: InstanceRecord): boolean => {
  const stored = record.ref;
  return reference.kind === "docker-pending" &&
    stored?.kind === "docker-pending" &&
    reference.containerName === stored.containerName &&
    reference.containerName === containerName(record.name) &&
    reference.nonce === stored.nonce &&
    reference.nonce === record.nonce &&
    reference.daemonId === stored.daemonId &&
    reference.executablePath === stored.executablePath &&
    reference.executableToken === stored.executableToken;
};

const ownershipExact = (
  reference: HandleReference,
  record: InstanceRecord,
  runtime: DockerLauncherRuntime,
): Effect.Effect<DockerState> =>
  Effect.gen(function* () {
    if (
      reference.kind !== "docker" ||
      !sameDockerReference(reference, record) ||
      !/^[a-f0-9]{64}$/.test(reference.containerId)
    ) return "unknown";
    const executable = runtime.resolveExecutable();
    if (!sameExecutable(reference, executable) || !executable) return "unknown";
    const daemon = yield* docker(runtime, executable.path, ["info", "--format", "{{.ID}}"]);
    if (daemon.status !== 0 || daemon.stdout.trim() !== reference.daemonId) return "unknown";
    const inspected = yield* docker(runtime, executable.path, [
      "inspect",
      "--format",
      INSPECT_FORMAT,
      reference.containerId,
    ]);
    if (inspected.status !== 0) {
      return inspected.stderr.trim() === `Error: No such object: ${reference.containerId}`
        ? "gone"
        : "unknown";
    }
    const [containerId, nonce, name, running, ...extra] = inspected.stdout.trim().split(/\r?\n/);
    const exact = extra.length === 0 &&
      containerId === reference.containerId &&
      nonce === record.nonce &&
      name === record.name;
    return exact && running === "true" ? "owned" : exact && running === "false" ? "stopped" : "unknown";
  });

const discoveredReference = (
  inspected: AsyncCommandResult,
  record: InstanceRecord,
  executable: DockerExecutable,
  daemonId: string,
): DockerReference | null => {
  if (inspected.status !== 0) return null;
  const [containerId, nonce, name, running, ...extra] = inspected.stdout.trim().split(/\r?\n/);
  if (
    extra.length !== 0 ||
    !containerId ||
    !/^[a-f0-9]{64}$/.test(containerId) ||
    nonce !== record.nonce ||
    name !== record.name ||
    (running !== "true" && running !== "false")
  ) return null;
  return {
    kind: "docker",
    containerId,
    daemonId,
    executablePath: executable.path,
    executableToken: executable.token,
  };
};

const pendingReference = (
  record: InstanceRecord,
  executable: DockerExecutable,
  daemonId: string,
): PendingDockerReference => ({
  kind: "docker-pending",
  containerName: containerName(record.name),
  nonce: record.nonce,
  daemonId,
  executablePath: executable.path,
  executableToken: executable.token,
});

const resolvePending = (
  reference: PendingDockerReference,
  record: InstanceRecord,
  runtime: DockerLauncherRuntime,
): Effect.Effect<{ readonly reference: DockerReference; readonly state: "owned" | "stopped" } | null> =>
  Effect.gen(function* () {
    if (!samePendingReference(reference, record)) return null;
    const executable = runtime.resolveExecutable();
    if (
      !executable ||
      executable.path !== reference.executablePath ||
      executable.token !== reference.executableToken
    ) return null;
    const daemon = yield* docker(runtime, executable.path, ["info", "--format", "{{.ID}}"]);
    if (daemon.status !== 0 || daemon.stdout.trim() !== reference.daemonId) return null;
    const inspected = yield* docker(runtime, executable.path, [
      "inspect",
      "--format",
      INSPECT_FORMAT,
      reference.containerName,
    ]);
    const resolved = discoveredReference(inspected, record, executable, reference.daemonId);
    if (!resolved) return null;
    const state = yield* ownershipExact(resolved, { ...record, ref: resolved }, runtime);
    return state === "owned" || state === "stopped" ? { reference: resolved, state } : null;
  });

const ownership = (
  reference: HandleReference,
  record: InstanceRecord,
  runtime: DockerLauncherRuntime,
): Effect.Effect<DockerState> => {
  if (reference.kind === "docker-pending") {
    return resolvePending(reference, record, runtime).pipe(
      Effect.map((resolved) => resolved?.state ?? "unknown"),
    );
  }
  return ownershipExact(reference, record, runtime);
};

const discoverStartedContainer = (
  runtime: DockerLauncherRuntime,
  record: InstanceRecord,
  executable: DockerExecutable,
  daemonId: string,
): Effect.Effect<HandleReference | null> =>
  Effect.gen(function* () {
    const inspected = yield* docker(runtime, executable.path, [
      "inspect",
      "--format",
      INSPECT_FORMAT,
      containerName(record.name),
    ]);
    const reference = discoveredReference(inspected, record, executable, daemonId);
    if (!reference || reference.kind !== "docker") return null;
    const proof = yield* ownershipExact(reference, { ...record, ref: reference }, runtime);
    return proof === "owned" || proof === "stopped" ? reference : null;
  });

const recoverStartedContainer = (
  runtime: DockerLauncherRuntime,
  record: InstanceRecord,
  executable: DockerExecutable,
  daemonId: string,
  recoveryDeadlineMs: number,
): Effect.Effect<HandleReference | null> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < RECOVERY_ATTEMPTS; attempt += 1) {
      const reference = yield* discoverStartedContainer(runtime, record, executable, daemonId);
      if (reference) return reference;
      if (attempt + 1 < RECOVERY_ATTEMPTS) yield* Effect.sleep(RECOVERY_DELAY_MS);
    }
    return null;
  }).pipe(
    Effect.timeoutOrElse({
      duration: recoveryDeadlineMs,
      orElse: () => Effect.succeed(null),
    }),
  );

const ambiguousRunFailure = (
  runtime: DockerLauncherRuntime,
  record: InstanceRecord,
  executable: DockerExecutable,
  daemonId: string,
  recoveryDeadlineMs: number,
  detail: string,
): Effect.Effect<never, LaunchFailure> =>
  recoverStartedContainer(runtime, record, executable, daemonId, recoveryDeadlineMs).pipe(
    Effect.flatMap((reference) =>
      spawnFailed(detail, reference ?? pendingReference(record, executable, daemonId))),
  );

const stopExact = (
  runtime: DockerLauncherRuntime,
  reference: DockerReference,
  record: InstanceRecord,
  graceMs: number,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const initial = yield* ownershipExact(reference, record, runtime);
    if (initial !== "owned" && initial !== "stopped") return;
    yield* docker(
      runtime,
      reference.executablePath,
      ["stop", "-t", String(Math.ceil(graceMs / 1000)), reference.containerId],
      graceMs + DOCKER_TIMEOUT_MS,
    ).pipe(Effect.ignore);
    const final = yield* ownershipExact(reference, record, runtime);
    if (final !== "owned" && final !== "stopped") return;
    yield* docker(runtime, reference.executablePath, ["rm", "-f", reference.containerId]).pipe(
      Effect.ignore,
    );
  });

export const makeDockerLauncher = (
  accelerator: Accelerator,
  runtime: DockerLauncherRuntime = realRuntime,
  options: DockerLauncherOptions = {},
): Launcher => {
  const recoveryDeadlineMs = options.recoveryDeadlineMs ?? RECOVERY_DEADLINE_MS;

  return {
  start: (plan: LaunchPlan, record: InstanceRecord) =>
    Effect.gen(function* () {
      if (!plan.image) return yield* spawnFailed(`no image for ${record.engine} on this host`);
      const executable = runtime.resolveExecutable();
      if (!executable) return yield* spawnFailed("docker executable identity unavailable");
      const daemon = yield* docker(runtime, executable.path, ["info", "--format", "{{.ID}}"]);
      const daemonId = daemon.status === 0 ? daemon.stdout.trim() : "";
      if (!daemonId) return yield* spawnFailed("docker daemon identity unavailable");
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
      const result = yield* docker(runtime, executable.path, arguments_, 120_000);
      if (result.status !== 0) {
        return yield* ambiguousRunFailure(
          runtime,
          record,
          executable,
          daemonId,
          recoveryDeadlineMs,
          "docker run outcome uncertain",
        );
      }
      const containerId = result.stdout.trim();
      if (!/^[a-f0-9]{64}$/.test(containerId)) {
        return yield* ambiguousRunFailure(
          runtime,
          record,
          executable,
          daemonId,
          recoveryDeadlineMs,
          "docker run outcome uncertain",
        );
      }
      const reference = {
        kind: "docker",
        containerId,
        daemonId,
        executablePath: executable.path,
        executableToken: executable.token,
      } as const;
      const proof = yield* ownership(reference, { ...record, ref: reference }, runtime);
      if (proof !== "owned" && proof !== "stopped") {
        return yield* spawnFailed("docker identity changed during launch", reference);
      }
      return reference;
    }),

  alive: (reference, record) =>
    ownership(reference, record, runtime).pipe(
      Effect.map((state) => state !== "gone" && state !== "stopped"),
    ),

  owns: (reference, record) =>
    ownership(reference, record, runtime).pipe(
      Effect.map((state) => state === "owned" || state === "stopped"),
    ),

  stop: (reference, record, graceMs): Effect.Effect<void> => {
    if (reference.kind === "docker-pending") {
      return Effect.gen(function* () {
        const resolved = yield* resolvePending(reference, record, runtime);
        if (!resolved) return;
        yield* stopExact(runtime, resolved.reference, { ...record, ref: resolved.reference }, graceMs);
      });
    }
    return reference.kind !== "docker"
      ? Effect.void
      : stopExact(runtime, reference, record, graceMs);
  },

  logTail: (reference, record): Effect.Effect<string> => {
    if (reference.kind === "docker-pending") {
      return resolvePending(reference, record, runtime).pipe(
        Effect.flatMap((resolved) =>
          resolved
            ? docker(runtime, resolved.reference.executablePath, [
                "logs",
                "--tail",
                "60",
                resolved.reference.containerId,
              ])
            : Effect.succeed(null),
        ),
        Effect.map((result) =>
          result ? `${result.stdout}\n${result.stderr}`.trim().slice(-LOG_TAIL_BYTES) : "",
        ),
      );
    }
    return reference.kind !== "docker"
      ? Effect.succeed("")
      : docker(runtime, reference.executablePath, [
          "logs",
          "--tail",
          "60",
          reference.containerId,
        ]).pipe(
          Effect.map((result) =>
            `${result.stdout}\n${result.stderr}`.trim().slice(-LOG_TAIL_BYTES),
          ),
        );
  },
  };
};
