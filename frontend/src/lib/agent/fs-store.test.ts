import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listDirectory, readFileSnippet } from "./fs-store";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "vllm-fs-store-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("agent fs store", () => {
  it("lists visible directories before files and ignores generated or hidden entries", () => {
    const root = makeRoot();
    mkdirSync(path.join(root, "src"));
    mkdirSync(path.join(root, "node_modules"));
    mkdirSync(path.join(root, ".hidden"));
    writeFileSync(path.join(root, "b.txt"), "b");
    writeFileSync(path.join(root, "a.txt"), "a");
    writeFileSync(path.join(root, ".env.example"), "EXAMPLE=1");
    writeFileSync(path.join(root, ".hidden", "secret"), "nope");

    const entries = listDirectory(root, ".");

    expect(entries.map((entry) => [entry.kind, entry.name])).toEqual([
      ["directory", "src"],
      ["file", ".env.example"],
      ["file", "a.txt"],
      ["file", "b.txt"],
    ]);
    expect(entries.find((entry) => entry.name === "a.txt")).toMatchObject({
      rel: "a.txt",
      size: 1,
    });
  });

  it("reads text snippets and refuses directories, large files, binaries, and escapes", async () => {
    const root = makeRoot();
    writeFileSync(path.join(root, "note.txt"), "hello");
    writeFileSync(path.join(root, "large.txt"), "abcdef");
    writeFileSync(path.join(root, "binary.bin"), Buffer.from([65, 0, 66]));
    mkdirSync(path.join(root, "dir"));

    await expect(readFileSnippet(root, "../outside.txt")).rejects.toThrow(
      "Path escapes project root",
    );
    await expect(readFileSnippet(root, "dir")).rejects.toThrow("Not a file");
    await expect(readFileSnippet(root, "note.txt")).resolves.toEqual({
      content: "hello",
      truncated: false,
      size: 5,
    });
    await expect(readFileSnippet(root, "large.txt", 3)).resolves.toMatchObject({
      content: "",
      truncated: true,
      size: 6,
    });
    await expect(readFileSnippet(root, "binary.bin")).resolves.toMatchObject({
      content: "",
      truncated: true,
      size: 3,
    });
  });

  it("does not follow a symlink out of the project when listing direct children", () => {
    const root = makeRoot();
    const outside = makeRoot();
    writeFileSync(path.join(outside, "secret.txt"), "secret");
    symlinkSync(outside, path.join(root, "linked-out"));

    expect(listDirectory(root, ".")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "linked-out", kind: "directory", rel: "linked-out" }),
      ]),
    );
  });
});
