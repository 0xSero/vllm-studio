import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  runNotebookVm,
  verifyNotebookImage,
} from "../src/modules/workbench/notebook-smolvm-runtime";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("SmolVM runner rejects combined output above one MiB", async () => {
  await expect(
    Effect.runPromise(
      runNotebookVm(
        process.execPath,
        ["-e", "process.stdout.write('x'.repeat(600000));process.stderr.write('y'.repeat(600000))"],
        1,
      ),
    ),
  ).rejects.toMatchObject({ detail: "SmolVM notebook output exceeded 1 MiB" });
});

test("SmolVM runner enforces its host-side timeout", async () => {
  const root = await mkdtemp(join(tmpdir(), "local-studio-timeout-"));
  roots.push(root);
  const pidFile = join(root, "pid");
  await expect(
    Effect.runPromise(
      runNotebookVm(
        process.execPath,
        [
          "-e",
          "require('fs').writeFileSync(process.argv[1],String(process.pid));setTimeout(()=>{},10000)",
          pidFile,
        ],
        -4.95,
      ),
    ),
  ).rejects.toMatchObject({ detail: "SmolVM notebook operation timed out" });
  const pid = Number(await readFile(pidFile, "utf8"));
  expect(() => process.kill(pid, 0)).toThrow();
});

test("Python images fail closed unless they are local and digest pinned", async () => {
  await expect(
    Effect.runPromise(verifyNotebookImage(`python:3.12@sha256:${"0".repeat(64)}`, "Python", true)),
  ).rejects.toMatchObject({ detail: "Python notebook image must be a local tar archive" });
});

test("local notebook images reject a mismatched digest", async () => {
  const root = await mkdtemp(join(tmpdir(), "local-studio-image-"));
  roots.push(root);
  const image = join(root, "python.tar");
  await writeFile(image, "verified-content");

  await expect(
    Effect.runPromise(verifyNotebookImage(`${image}@sha256:${"0".repeat(64)}`, "Python", true)),
  ).rejects.toMatchObject({ detail: "Python notebook image digest does not match" });
});

test("Node image references retain remote digest compatibility", async () => {
  const digest = createHash("sha256").update("node").digest("hex");
  await expect(
    Effect.runPromise(verifyNotebookImage(`node:22@sha256:${digest}`, "Node", false)),
  ).resolves.toBe(`node:22@sha256:${digest}`);
});
