import assert from "node:assert/strict";
import { test } from "node:test";
import { createProjectsStore } from "./store";

const project = {
  id: "project-01",
  name: "Research",
  path: "/workspace/research",
  addedAt: "2026-07-28T00:00:00.000Z",
  exists: true,
  hasGit: true,
  branch: "feat/scientific-workbench",
};

test("projects store construction is deterministic before subscription hydration", async () => {
  const store = createProjectsStore({
    api: {
      loadProjects: async () => [project],
      loadGitSummary: async () => null,
      initGit: async () => undefined,
      removeProject: async () => undefined,
    },
    readSelectedProjectId: () => project.id,
    writeSelectedProjectId: () => undefined,
    getWindow: () => null,
  });

  assert.deepEqual(
    {
      projects: store.getSnapshot().projects,
      loaded: store.getSnapshot().loaded,
      selectedId: store.getSnapshot().selectedId,
    },
    { projects: [], loaded: false, selectedId: null },
  );

  const unsubscribe = store.subscribe(() => undefined);
  assert.equal(store.getSnapshot().selectedId, project.id);
  await store.refresh();
  assert.deepEqual(store.getSnapshot().projects, [project]);
  assert.equal(store.getSnapshot().loaded, true);
  assert.equal(store.getSnapshot().selectedId, project.id);
  unsubscribe();
});
