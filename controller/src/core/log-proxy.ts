import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { closeSync, writeSync } from "node:fs";
import { Readable } from "node:stream";
import { Effect, Stream } from "effect";
import { openPrivateLogFile } from "./log-files";
import { redactLogLine } from "./log-redaction";

const maximumPendingCharacters = 64 * 1024;
type RedactionState = { readonly pending: string; readonly dropping: boolean };
type VoidEffect = Effect.Effect<void>;

export const logProxyModuleUrl = import.meta.url;

const decodeOutput = (readable: Readable): Stream.Stream<string> =>
  Stream.fromReadableStream({
    evaluate: () => Readable.toWeb(readable) as unknown as ReadableStream<Uint8Array>,
    onError: (cause) => cause,
  }).pipe(
    Stream.decodeText,
    Stream.catchCause(() => Stream.empty),
  );

const redactOutput = (stdout: Readable, stderr: Readable, descriptor: number): VoidEffect =>
  Stream.merge(decodeOutput(stdout), decodeOutput(stderr)).pipe(
    Stream.mapAccum(
      (): RedactionState => ({ pending: "", dropping: false }),
      (state, chunk) => {
        let output = "";
        let value = chunk;
        if (state.dropping) {
          const newline = value.indexOf("\n");
          if (newline < 0) return [state, []] as const;
          output = "\n";
          value = value.slice(newline + 1);
        }
        const combined = `${state.pending}${value}`;
        const newline = combined.lastIndexOf("\n");
        const complete = newline < 0 ? "" : combined.slice(0, newline + 1);
        const pending = newline < 0 ? combined : combined.slice(newline + 1);
        output += redactLogLine(complete);
        if (pending.length > maximumPendingCharacters) {
          return [{ pending: "", dropping: true }, [output, "[redacted]"]] as const;
        }
        return [{ pending, dropping: false }, output ? [output] : []] as const;
      },
      {
        onHalt: (state) => (state.pending && !state.dropping ? [redactLogLine(state.pending)] : []),
      },
    ),
    Stream.runForEach((output) =>
      Effect.sync(() => {
        try {
          writeSync(descriptor, output);
        } catch {}
      }),
    ),
  );

const waitForChild = (child: ChildProcess): Effect.Effect<void, Error> =>
  Effect.tryPromise({
    try: async () => {
      await once(child, "close");
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });

const runLogProxy = (): Effect.Effect<void, unknown> =>
  Effect.scoped(
    Effect.gen(function* () {
      const path = process.argv[2];
      const binary = process.argv[3];
      if (!path || !binary) return yield* Effect.fail(new Error("Missing launch arguments"));
      const descriptor = yield* Effect.acquireRelease(
        Effect.try({
          try: () => openPrivateLogFile(path),
          catch: (cause) => cause,
        }),
        (openDescriptor) => Effect.sync(() => closeSync(openDescriptor)),
      );
      const child = yield* Effect.try({
        try: () => spawn(binary, process.argv.slice(4), { stdio: ["ignore", "pipe", "pipe"] }),
        catch: (cause) => cause,
      });
      yield* Effect.all(
        [redactOutput(child.stdout, child.stderr, descriptor), waitForChild(child)],
        { concurrency: "unbounded", discard: true },
      );
    }),
  );

if (import.meta.main) {
  void Effect.runPromise(runLogProxy()).catch(() => (process.exitCode = 1));
}
