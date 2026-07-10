import assert from "node:assert/strict";
import test from "node:test";

import { makeFreshTab } from "../src/features/agent/messages/helpers";
import type { Project } from "../src/features/agent/projects/types";
import { terminalOwnerFor } from "../src/features/agent/terminal-owners";
import { collectLeaves } from "../src/features/agent/workspace/layout";
import { restorePersistedPaneState } from "../src/features/agent/workspace/store";

function persistedWorkspace(
  panes: Record<string, unknown>,
  layout: unknown,
  focusedPaneId: string,
) {
  return JSON.stringify({ version: 1, panes, layout, focusedPaneId });
}

test("legacy terminal panes are removed while restoring chat tasks", () => {
  const restored = restorePersistedPaneState(
    persistedWorkspace(
      {
        "p-chat": {
          activeTabId: "session-1",
          tabs: [{ id: "session-1", title: "Task", cwd: "/repo" }],
        },
        "p-terminal": {
          kind: "terminal",
          mountKey: "project:repo",
          cwd: "/repo",
        },
      },
      {
        kind: "split",
        direction: "vertical",
        ratio: 0.5,
        a: { kind: "leaf", paneId: "p-chat" },
        b: { kind: "leaf", paneId: "p-terminal" },
      },
      "p-terminal",
    ),
  );

  assert.ok(restored);
  assert.deepEqual(collectLeaves(restored.layout), ["p-chat"]);
  assert.deepEqual([...restored.panesById.keys()], ["p-chat"]);
  assert.equal(restored.focusedPaneId, "p-chat");
});

test("a legacy terminal-only workspace falls back to a fresh task", () => {
  const restored = restorePersistedPaneState(
    persistedWorkspace(
      {
        "p-terminal": {
          kind: "terminal",
          mountKey: "project:repo",
          cwd: "/repo",
        },
      },
      { kind: "leaf", paneId: "p-terminal" },
      "p-terminal",
    ),
  );

  assert.equal(restored, null);
});

test("a task owns one stable terminal across runtime adoption", () => {
  const project: Project = {
    id: "project-1",
    name: "Studio",
    path: "/repo/studio",
    addedAt: "2026-07-10T00:00:00.000Z",
    exists: true,
    hasGit: true,
    branch: "sol",
  };
  const session = {
    ...makeFreshTab(),
    id: "task-1",
    title: "Session cleanup",
    projectId: project.id,
    cwd: project.path,
  };

  const before = terminalOwnerFor(project, session);
  const after = terminalOwnerFor(project, { ...session, piSessionId: "pi-1" });

  assert.equal(before?.mountKey, "session:task-1");
  assert.equal(after?.mountKey, before?.mountKey);
  assert.deepEqual(after?.matchKeys, ["session:task-1", "pi:pi-1"]);
  assert.equal(after?.cwd, project.path);
});
