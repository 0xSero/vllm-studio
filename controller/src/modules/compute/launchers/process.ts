import { spawn, type SpawnOptions } from "node:child_process";
import { openSync, readFileSync, statSync, openSync as open, closeSync, readSync } from "node:fs";
import { Effect } from "effect";
import type { HandleReference, InstanceRecord, LaunchPlan } from "../contracts";
import { realProcessRunner } from "../../../core/command";
import { LOG_TAIL_BYTES, spawnFailed, type Launcher } from "./launcher";

/**
 * Detached-daemon launcher, exo-style: stdout+stderr straight into a log file, the whole
 * process *group* signalled on stop (vLLM forks an EngineCore that holds the VRAM — the
 * leader dying does not free the GPU), and ownership proven before any signal is sent.
 */

const STOP_POLL_MS = 250;

const pidAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const signal = (pid: number, sig: NodeJS.Signals): void => {
  try {
    process.kill(pid, sig);
  } catch {
  }
};

/**
 * Linux: /proc/<pid>/stat field 22 is the process start time in clock ticks — a pid plus
 * its start token survives pid reuse across reboots. Elsewhere there is no equivalent
 * cheap token; ownership falls back to the command-line check alone.
 */
export const processStartToken = (pid: number): string | null => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // Field 2 is the comm, which may contain spaces/parens; everything after the last
    // ')' is fixed-position.
    const afterComm = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return afterComm[19] ?? null;
  } catch {
    return null;
  }
};

const pidCommandLine = (pid: number): string => {
  const result = realProcessRunner.runSync("ps", ["-o", "command=", "-p", String(pid)], {
    timeoutMs: 3_000,
  });
  return result.status === 0 ? result.stdout : "";
};

const readTailBytes = (path: string, bytes: number): string => {
  try {
    const size = statSync(path).size;
    const start = Math.max(0, size - bytes);
    const length = size - start;
    if (length <= 0) return "";
    const buffer = Buffer.alloc(length);
    const fd = open(path, "r");
    try {
      readSync(fd, buffer, 0, length, start);
    } finally {
      closeSync(fd);
    }
    return buffer.toString("utf8");
  } catch {
    return "";
  }
};

export const makeProcessLauncher = (logPathFor: (name: string) => string): Launcher => ({
  start: (plan: LaunchPlan, record: InstanceRecord) =>
    Effect.gen(function* () {
      const [binary, ...args] = plan.argv;
      if (!binary) return yield* spawnFailed("plan.argv is empty");
      const logFd = yield* Effect.try({
        try: () => openSync(logPathFor(record.name), "w"),
        catch: (error) => error,
      }).pipe(
        Effect.catch((error) =>
          spawnFailed(`cannot open log file for ${record.name}: ${String(error)}`),
        ),
      );
      const baseSpawnOptions: SpawnOptions = {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: { ...process.env, ...plan.env },
      };
      const spawnOptions = plan.workdir
        ? { ...baseSpawnOptions, cwd: plan.workdir }
        : baseSpawnOptions;
      const child = spawn(binary, args, spawnOptions);
      const pid = yield* Effect.callback<number, never>((resume) => {
        child.on("error", () => resume(Effect.succeed(-1)));
        child.on("spawn", () => resume(Effect.succeed(child.pid ?? -1)));
      });
      closeSync(logFd);
      if (pid <= 0) return yield* spawnFailed(`failed to spawn ${binary}`);
      child.unref();
      return { kind: "process", pid, startToken: processStartToken(pid) } as const;
    }),

  alive: (reference: HandleReference) =>
    Effect.sync(() => (reference.kind === "process" ? pidAlive(reference.pid) : false)),

  owns: (reference: HandleReference, record: InstanceRecord) =>
    Effect.sync(() => {
      if (reference.kind !== "process") return false;
      if (!pidAlive(reference.pid)) return false;
      // Start token is decisive where the OS provides one (Linux).
      if (reference.startToken !== null) return processStartToken(reference.pid) === reference.startToken;
      // Elsewhere the pid's command line must still carry our unmistakable argument:
      // every plan passes `--port <port>`, and the port is unique per node. A recycled
      // pid belonging to something else will not be serving on our port.
      return pidCommandLine(reference.pid).includes(`--port ${record.port}`);
    }),

  stop: (reference: HandleReference, graceMs: number) =>
    Effect.gen(function* () {
      if (reference.kind !== "process") return;
      const { pid } = reference;
      // The group first: -pid reaches children even when the leader is already gone.
      signal(-pid, "SIGTERM");
      signal(pid, "SIGTERM");
      const deadline = Date.now() + graceMs;
      while (pidAlive(pid) && Date.now() < deadline) {
        yield* Effect.sleep(STOP_POLL_MS);
      }
      signal(-pid, "SIGKILL");
      signal(pid, "SIGKILL");
    }),

  logTail: (reference: HandleReference, record: InstanceRecord) =>
    Effect.sync(() => readTailBytes(logPathFor(record.name), LOG_TAIL_BYTES)),
});
