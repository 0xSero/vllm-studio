import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { Effect, Semaphore } from "effect";
import { serviceUnavailable } from "../../core/errors";

const notebookCommitLock = Semaphore.makeUnsafe(1);

export const withNotebookCommitLock = <A, E, R>(
  operation: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => notebookCommitLock.withPermit(operation);

export const verifyNotebookImage = (
  value: string,
  runtime: "Node" | "Python",
  localOnly: boolean,
): Effect.Effect<string, unknown> => {
  const match = /^(.*)@sha256:([a-f0-9]{64})$/u.exec(value);
  if (!match?.[1] || !match[2]) {
    return Effect.fail(
      serviceUnavailable(`${runtime} notebook image must be pinned by sha256 digest`),
    );
  }
  const imagePath = match[1];
  if (!imagePath.endsWith(".tar")) {
    return localOnly
      ? Effect.fail(serviceUnavailable(`${runtime} notebook image must be a local tar archive`))
      : Effect.succeed(value);
  }
  return Effect.tryPromise({
    try: () => readFile(imagePath),
    catch: (error) =>
      serviceUnavailable(`${runtime} notebook image verification failed: ${String(error)}`),
  }).pipe(
    Effect.flatMap((content) =>
      createHash("sha256").update(content).digest("hex") === match[2]
        ? Effect.succeed(imagePath)
        : Effect.fail(serviceUnavailable(`${runtime} notebook image digest does not match`)),
    ),
  );
};

export const runNotebookVm = (
  executable: string,
  args: string[],
  timeoutSeconds: number,
): Effect.Effect<string, unknown> =>
  Effect.callback<string, unknown>((resume, signal) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    let settled = false;
    let outputBytes = 0;
    let terminationFailure: ReturnType<typeof serviceUnavailable> | undefined;
    const abort = (): void => {
      child.kill("SIGTERM");
    };
    const finish = (effect: Effect.Effect<string, unknown>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resume(effect);
    };
    const capture =
      (target: Buffer[]) =>
      (chunk: Buffer): void => {
        outputBytes += chunk.byteLength;
        if (outputBytes > 1_048_576) {
          if (terminationFailure) return;
          terminationFailure = serviceUnavailable("SmolVM notebook output exceeded 1 MiB");
          child.kill("SIGKILL");
          return;
        }
        target.push(chunk);
      };
    const timer = setTimeout(
      () => {
        terminationFailure = serviceUnavailable("SmolVM notebook operation timed out");
        child.kill("SIGKILL");
      },
      (timeoutSeconds + 5) * 1000,
    );
    child.stdout.on("data", capture(chunks));
    child.stderr.on("data", capture(errors));
    child.on("error", (error) =>
      finish(Effect.fail(serviceUnavailable(`SmolVM notebook failed: ${String(error)}`))),
    );
    child.on("close", (code) => {
      if (terminationFailure) {
        finish(Effect.fail(terminationFailure));
        return;
      }
      if (code === 0) {
        finish(Effect.succeed(Buffer.concat(chunks).toString("utf8")));
        return;
      }
      finish(
        Effect.fail(
          serviceUnavailable(
            `SmolVM notebook failed: ${Buffer.concat(errors).toString("utf8").slice(-2000)}`,
          ),
        ),
      );
    });
    signal.addEventListener("abort", abort, { once: true });
  });
