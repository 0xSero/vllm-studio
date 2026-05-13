import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addComment, deleteComment, listComments } from "./comments-store";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "vllm-comments-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-12T00:00:00.000Z"));
  vi.spyOn(Math, "random").mockReturnValue(0.123456);
});

describe("comments store", () => {
  it("adds, lists, and deletes comments per relative file", () => {
    const root = makeRoot();

    const comment = addComment(root, "src/app.ts", 7, "  tighten this  ");

    expect(comment).toMatchObject({
      id: expect.stringMatching(/^c-[a-z0-9]+-4fzyo8$/),
      line: 7,
      body: "tighten this",
      createdAt: "2026-05-12T00:00:00.000Z",
    });
    expect(listComments(root, "src/app.ts")).toEqual([comment]);
    expect(listComments(root, "src/other.ts")).toEqual([]);

    deleteComment(root, "src/app.ts", comment.id);

    expect(listComments(root, "src/app.ts")).toEqual([]);
  });

  it("recovers from a malformed document and validates write inputs", () => {
    const root = makeRoot();
    mkdirSync(path.join(root, ".vllm-studio"));
    writeFileSync(path.join(root, ".vllm-studio", "comments.json"), "not json");

    expect(listComments(root, "README.md")).toEqual([]);
    expect(() => listComments(root, "../README.md")).toThrow("Invalid file path");
    expect(() => addComment(root, "README.md", 1, "   ")).toThrow("Comment body is required");

    addComment(root, "README.md", 1, "ok");
    const persisted = JSON.parse(
      readFileSync(path.join(root, ".vllm-studio", "comments.json"), "utf8"),
    ) as { files: Record<string, unknown[]> };
    expect(Object.keys(persisted.files)).toEqual(["README.md"]);
  });
});
