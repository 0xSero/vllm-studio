import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { loadGitState, numstatStats } from "./service";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function git(cwd: string, args: string[]): Promise<void> {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_PREFIX;
  await execFileAsync("git", args, { cwd, env });
}

async function makeRepo(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "vllm-studio-git-state-"));
  tempDirs.push(cwd);
  await git(cwd, ["init"]);
  await git(cwd, ["config", "user.email", "test@example.com"]);
  await git(cwd, ["config", "user.name", "Test User"]);
  await writeFile(path.join(cwd, "tracked.txt"), "one\n");
  await git(cwd, ["add", "tracked.txt"]);
  await git(cwd, ["commit", "-m", "initial"]);
  return cwd;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("git service", () => {
  it("parses git numstat output and ignores binary placeholders", () => {
    expect(numstatStats("2\t1\tsrc/a.ts\n-\t-\timage.png\n")).toEqual({
      additions: 2,
      deletions: 1,
    });
  });

  it("counts staged, unstaged, and untracked file changes in git state totals", async () => {
    const cwd = await makeRepo();
    await writeFile(path.join(cwd, "tracked.txt"), "one\ntwo\n");
    await writeFile(path.join(cwd, "staged.txt"), "alpha\nbeta\n");
    await git(cwd, ["add", "staged.txt"]);
    await writeFile(path.join(cwd, "untracked.txt"), "red\ngreen\nblue\n");

    const state = await loadGitState(cwd);

    expect(state.additions).toBe(6);
    expect(state.deletions).toBe(0);
    expect(state.status).toEqual(
      expect.arrayContaining([" M tracked.txt", "A  staged.txt", "?? untracked.txt"]),
    );
  });
});
