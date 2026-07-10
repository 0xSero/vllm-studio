import { expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import { runCommandAsync, runCommandAsyncEffect } from "./command";

test("retains only bounded stdout and stderr tails", async () => {
  const result = await runCommandAsync(
    process.execPath,
    [
      "-e",
      'process.stdout.write("a".repeat(512)+"stdout-tail");process.stderr.write("b".repeat(512)+"stderr-tail")',
    ],
    { timeoutMs: 5_000, maxOutputBytes: 32 },
  );

  expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(32);
  expect(Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(32);
  expect(result.stdout.endsWith("stdout-tail")).toBe(true);
  expect(result.stderr.endsWith("stderr-tail")).toBe(true);
});

test("abort waits for the child process to exit", async () => {
  const controller = new AbortController();
  let closed = false;
  const command = runCommandAsync(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    timeoutMs: 60_000,
    signal: controller.signal,
    onSpawn: (child): void => {
      child.once("close", () => {
        closed = true;
      });
    },
  });

  controller.abort();
  await command;
  expect(closed).toBe(true);
});

test("effect interruption kills and settles the child process", async () => {
  let closed = false;
  const fiber = Effect.runFork(
    runCommandAsyncEffect(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      timeoutMs: 60_000,
      onSpawn: (child): void => {
        child.once("close", () => {
          closed = true;
        });
      },
    }),
  );

  await Effect.runPromise(Fiber.interrupt(fiber));
  expect(closed).toBe(true);
});
