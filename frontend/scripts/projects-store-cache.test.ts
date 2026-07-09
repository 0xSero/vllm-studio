import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { createProjectsStore } from "../src/features/agent/projects/store";
import type { Project } from "../src/features/agent/projects/types";

const PROJECTS_CACHE_KEY = "local-studio.agent.projects.cache.v1";

function project(id: string): Project {
  return {
    id,
    name: id,
    path: `/repo/${id}`,
    addedAt: "2026-01-01T00:00:00.000Z",
    exists: true,
    hasGit: false,
    branch: null,
  };
}

function installFakeWindow(): Map<string, string> {
  const map = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    },
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return map;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

test("projects store seeds from the localStorage cache before the first fetch resolves", () => {
  const map = installFakeWindow();
  map.set(PROJECTS_CACHE_KEY, JSON.stringify([project("cached-a"), project("cached-b")]));

  let resolveLoad: (projects: Project[]) => void = () => {};
  const store = createProjectsStore({
    api: {
      loadProjects: () => new Promise<Project[]>((resolve) => (resolveLoad = resolve)),
      initGit: async () => {},
      loadGitSummary: async () => null,
      removeProject: async () => {},
    },
  });

  const unsubscribe = store.subscribe(() => {});
  // The fetch has NOT resolved — the cached list is already available so the
  // sidebar and ?project= URL navigation don't block on the network.
  const seeded = store.getSnapshot();
  assert.deepEqual(
    seeded.projects.map((entry) => entry.id),
    ["cached-a", "cached-b"],
  );
  assert.equal(seeded.loaded, false);
  resolveLoad([]);
  unsubscribe();
});

test("projects store writes the cache after a successful load and keeps the seed on failure", async () => {
  const map = installFakeWindow();
  const fresh = [project("fresh")];
  let fail = false;
  const store = createProjectsStore({
    api: {
      loadProjects: async () => {
        if (fail) throw new Error("network down");
        return fresh;
      },
      initGit: async () => {},
      loadGitSummary: async () => null,
      removeProject: async () => {},
    },
  });

  await store.refresh();
  assert.deepEqual(JSON.parse(map.get(PROJECTS_CACHE_KEY) ?? "[]"), fresh);

  fail = true;
  await store.refresh();
  // A failed refresh keeps the last-known list instead of blanking the sidebar.
  assert.deepEqual(
    store.getSnapshot().projects.map((entry) => entry.id),
    ["fresh"],
  );
  assert.equal(store.getSnapshot().loaded, true);
});
