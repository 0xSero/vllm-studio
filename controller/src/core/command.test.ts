import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Effect, Fiber } from "effect";

import { resolveBinary, runCommandAsync, runCommandAsyncEffect } from "./command";

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

const executableName = (name: string): string =>
  process.platform === "win32" ? `${name}.exe` : name;

const createExecutable = (directory: string, name: string): string => {
  const filePath = join(directory, executableName(name));
  writeFileSync(filePath, "");
  chmodSync(filePath, 0o755);
  return filePath;
};

describe("resolveBinary", () => {
  let temporaryDirectory: string;
  let savedPath: string | undefined;
  let savedRuntimeBin: string | undefined;
  let savedSnap: string | undefined;
  let savedHome: string | undefined;

  const restoreEnvironment = (key: string, value: string | undefined): void => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "resolve-binary-"));
    savedPath = process.env["PATH"];
    savedRuntimeBin = process.env["LOCAL_STUDIO_RUNTIME_BIN"];
    savedSnap = process.env["SNAP"];
    savedHome = process.env["HOME"];
    delete process.env["LOCAL_STUDIO_RUNTIME_BIN"];
    delete process.env["SNAP"];
  });

  afterEach(() => {
    restoreEnvironment("PATH", savedPath);
    restoreEnvironment("LOCAL_STUDIO_RUNTIME_BIN", savedRuntimeBin);
    restoreEnvironment("SNAP", savedSnap);
    restoreEnvironment("HOME", savedHome);
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  test("resolves a bare name from PATH using the platform delimiter", () => {
    const expected = createExecutable(temporaryDirectory, "local-studio-test-tool");
    process.env["PATH"] = temporaryDirectory;
    expect(resolveBinary("local-studio-test-tool")).toBe(expected);
  });

  test("searches every PATH entry, not just the first", () => {
    const emptyDirectory = join(temporaryDirectory, "empty");
    const toolDirectory = join(temporaryDirectory, "tools");
    mkdirSync(emptyDirectory);
    mkdirSync(toolDirectory);
    const expected = createExecutable(toolDirectory, "local-studio-test-tool");
    process.env["PATH"] = [emptyDirectory, toolDirectory].join(delimiter);
    expect(resolveBinary("local-studio-test-tool")).toBe(expected);
  });

  test("resolves from a PATH entry wrapped in quotes", () => {
    const expected = createExecutable(temporaryDirectory, "local-studio-test-tool");
    process.env["PATH"] = `"${temporaryDirectory}"`;
    expect(resolveBinary("local-studio-test-tool")).toBe(expected);
  });

  test("returns null when the binary is not on PATH", () => {
    process.env["PATH"] = temporaryDirectory;
    expect(resolveBinary("local-studio-missing-tool")).toBeNull();
  });

  test("returns null for an empty name", () => {
    expect(resolveBinary("")).toBeNull();
  });

  test("resolves an explicit path directly", () => {
    const expected = createExecutable(temporaryDirectory, "local-studio-test-tool");
    expect(resolveBinary(expected)).toBe(expected);
  });

  test("returns null for an explicit path that does not exist", () => {
    expect(
      resolveBinary(join(temporaryDirectory, executableName("local-studio-missing-tool"))),
    ).toBeNull();
  });

  test("prefers LOCAL_STUDIO_RUNTIME_BIN over PATH", () => {
    const runtimeDirectory = join(temporaryDirectory, "runtime-bin");
    const pathDirectory = join(temporaryDirectory, "path-bin");
    mkdirSync(runtimeDirectory);
    mkdirSync(pathDirectory);
    const expected = createExecutable(runtimeDirectory, "local-studio-test-tool");
    createExecutable(pathDirectory, "local-studio-test-tool");
    process.env["LOCAL_STUDIO_RUNTIME_BIN"] = runtimeDirectory;
    process.env["PATH"] = pathDirectory;
    expect(resolveBinary("local-studio-test-tool")).toBe(expected);
  });

  test("falls back to HOME local bin after PATH", () => {
    const homeDirectory = join(temporaryDirectory, "home");
    const localBin = join(homeDirectory, ".local", "bin");
    mkdirSync(localBin, { recursive: true });
    const expected = createExecutable(localBin, "local-studio-test-tool");
    process.env["HOME"] = homeDirectory;
    process.env["PATH"] = join(temporaryDirectory, "does-not-exist");
    expect(resolveBinary("local-studio-test-tool")).toBe(expected);
  });

  test("returns null for a file without the execute bit", () => {
    if (process.platform === "win32") return;
    const filePath = join(temporaryDirectory, "local-studio-test-tool");
    writeFileSync(filePath, "");
    chmodSync(filePath, 0o644);
    process.env["PATH"] = temporaryDirectory;
    expect(resolveBinary("local-studio-test-tool")).toBeNull();
  });
});
