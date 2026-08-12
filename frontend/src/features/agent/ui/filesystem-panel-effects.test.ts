import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveFileOpenTarget, resolveWorkspaceFileOpenTarget } from "./filesystem-panel-effects";

const CWD = "/Users/me/projects/app";

describe("resolveFileOpenTarget", () => {
  test("resolves a path inside the session project against the project root", () => {
    assert.deepEqual(resolveFileOpenTarget(`${CWD}/src/index.ts`, CWD), {
      root: CWD,
      rel: "src/index.ts",
      kind: "file",
    });
  });

  test("keeps project-relative references under the project root", () => {
    assert.deepEqual(resolveFileOpenTarget("./src/index.ts", CWD), {
      root: CWD,
      rel: "src/index.ts",
      kind: "file",
    });
  });

  test("opens an absolute path outside the project against its own directory", () => {
    assert.deepEqual(resolveFileOpenTarget("/Users/me/Desktop/report.pdf", CWD), {
      root: "/Users/me/Desktop",
      rel: "report.pdf",
      kind: "file",
    });
  });

  test("still resolves when there is no session project", () => {
    assert.deepEqual(resolveFileOpenTarget("/tmp/out/log.txt", null), {
      root: "/tmp/out",
      rel: "log.txt",
      kind: "file",
    });
  });

  test("strips file:// scheme, backticks, and line/column suffixes", () => {
    assert.deepEqual(resolveFileOpenTarget("file:///Users/me/Desktop/a%20b.md:42:7", CWD), {
      root: "/Users/me/Desktop",
      rel: "a b.md",
      kind: "file",
    });
    assert.deepEqual(resolveFileOpenTarget("`src/index.ts:10`", CWD), {
      root: CWD,
      rel: "src/index.ts",
      kind: "file",
    });
  });

  test("expands ~ using the home implied by the session cwd", () => {
    assert.deepEqual(resolveFileOpenTarget("~/Desktop/report.pdf", CWD), {
      root: "/Users/me/Desktop",
      rel: "report.pdf",
      kind: "file",
    });
  });

  test("leaves ~ unexpanded when no cwd reveals the home directory", () => {
    assert.equal(resolveFileOpenTarget("~/Desktop/report.pdf", null), null);
  });

  test("treats trailing-slash references as directories to browse", () => {
    assert.deepEqual(resolveFileOpenTarget("src/features/", CWD), {
      root: CWD,
      rel: "src/features",
      kind: "directory",
    });
    assert.deepEqual(resolveFileOpenTarget("/Users/me/Desktop/", CWD), {
      root: "/Users/me/Desktop",
      rel: "",
      kind: "directory",
    });
  });

  test("rejects empty, escaping, and NUL-bearing references", () => {
    assert.equal(resolveFileOpenTarget("   ", CWD), null);
    assert.equal(resolveFileOpenTarget("../outside.ts", CWD), null);
    assert.equal(resolveFileOpenTarget("src/in\0dex.ts", CWD), null);
    assert.equal(resolveFileOpenTarget("src/index.ts", null), null);
  });
});

describe("resolveWorkspaceFileOpenTarget", () => {
  test("normalizes contained paths and rejects lexical escapes", () => {
    assert.deepEqual(resolveWorkspaceFileOpenTarget("src/lib/../index.ts", CWD), {
      root: CWD,
      rel: "src/index.ts",
      kind: "file",
    });
    assert.equal(resolveWorkspaceFileOpenTarget("src/../../secret.ts", CWD), null);
    assert.equal(resolveWorkspaceFileOpenTarget(`${CWD}2/secret.ts`, CWD), null);
    assert.equal(
      resolveWorkspaceFileOpenTarget(`file://${CWD}/src/%2E%2E/%2E%2E/secret.ts`, CWD),
      null,
    );
  });
});
