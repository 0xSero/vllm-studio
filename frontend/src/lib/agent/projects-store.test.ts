import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addProjectToStore, listProjectsFromStore, removeProjectFromStore } from "./projects-store";

const roots: string[] = [];
const originalEnv = { ...process.env };

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "vllm-projects-store-"));
  roots.push(root);
  return root;
}

beforeEach(() => {
  process.env = { ...originalEnv };
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-12T02:00:00.000Z"));
  vi.spyOn(Math, "random").mockReturnValue(0.654321);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("projects store", () => {
  it("adds existing directories once and enriches them with git metadata", () => {
    const root = makeRoot();
    const storeFile = path.join(root, "data", "projects.json");
    const projectPath = path.join(root, "workspace", "demo");
    process.env.VLLM_STUDIO_PROJECTS_FILE = storeFile;
    mkdirSync(path.join(projectPath, ".git"), { recursive: true });
    writeFileSync(path.join(projectPath, ".git", "HEAD"), "ref: refs/heads/feature/refactor\n");

    const created = addProjectToStore(`${projectPath}/`);
    const duplicate = addProjectToStore(projectPath);

    expect(created).toMatchObject({
      id: expect.stringMatching(/^proj-[a-z0-9]+-[a-z0-9]+$/),
      name: "demo",
      path: projectPath,
      addedAt: "2026-05-12T02:00:00.000Z",
      exists: true,
      hasGit: true,
      branch: "feature/refactor",
    });
    expect(duplicate).toEqual(created);
    expect(listProjectsFromStore()).toEqual([created]);
    expect(JSON.parse(readFileSync(storeFile, "utf8"))).toMatchObject({
      projects: [expect.objectContaining({ path: projectPath })],
    });
  });

  it("removes projects, tolerates malformed stores, and validates paths", () => {
    const root = makeRoot();
    const storeFile = path.join(root, "data", "projects.json");
    const projectPath = path.join(root, "detached");
    process.env.VLLM_STUDIO_PROJECTS_FILE = storeFile;
    mkdirSync(projectPath, { recursive: true });
    mkdirSync(path.dirname(storeFile), { recursive: true });
    writeFileSync(storeFile, "not json");

    expect(listProjectsFromStore()).toEqual([]);
    expect(() => addProjectToStore("   ")).toThrow("path is required");
    expect(() => addProjectToStore(path.join(root, "missing"))).toThrow("Path is not a directory");

    const created = addProjectToStore(projectPath);
    removeProjectFromStore("missing");
    expect(listProjectsFromStore()).toHaveLength(1);
    removeProjectFromStore(created.id);
    expect(listProjectsFromStore()).toEqual([]);
  });
});
