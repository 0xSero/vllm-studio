import assert from "node:assert/strict";
import test from "node:test";

import { makeFreshTab } from "../src/features/agent/messages/helpers";
import type { Session } from "../src/features/agent/runtime/types";
import { collectLeaves } from "../src/features/agent/workspace/layout";
import {
  applyUrlNavigation,
  openProjectTerminal,
} from "../src/features/agent/workspace/pane-controller";
import { reducer } from "../src/features/agent/workspace/reducer";
import { createInitialState } from "../src/features/agent/workspace/store";
import type { Project } from "../src/features/agent/projects/types";
import type {
  PaneState,
  TerminalPaneState,
  WorkspaceAction,
  WorkspaceState,
} from "../src/features/agent/workspace/types";

function chatSession(patch: Partial<Session> = {}): Session {
  return { ...makeFreshTab(), ...patch };
}

function stateWithChatPane(session: Session): WorkspaceState {
  return {
    ...createInitialState(),
    sessions: new Map([[session.id, session]]),
    panesById: new Map<string, PaneState>([["p-init", { sessionId: session.id }]]),
    focusedPaneId: "p-init",
  };
}

function asTerminal(pane: PaneState | undefined): TerminalPaneState {
  if (!pane || pane.kind !== "terminal") assert.fail("expected a terminal pane");
  return pane;
}

function project(patch: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "proj",
    path: "/repo/proj",
    addedAt: "2026-01-01T00:00:00.000Z",
    exists: true,
    hasGit: false,
    branch: null,
    ...patch,
  };
}

test("openProjectTerminal converts a focused empty starter pane in place and prunes the orphaned session", () => {
  const state = createInitialState();
  const focusedId = state.focusedPaneId;
  const starterId = [...state.sessions.keys()][0];

  const next = openProjectTerminal(state, { cwd: "/repo/demo", newPaneId: "p-unused" });

  assert.deepEqual(collectLeaves(next.layout), [focusedId]);
  const term = asTerminal(next.panesById.get(focusedId));
  assert.equal(term.cwd, "/repo/demo");
  assert.equal(term.mountKey, `pane:${focusedId}`);
  assert.equal(term.ownerSessionId, null);
  assert.equal(next.focusedPaneId, focusedId);
  assert.equal(next.panesById.has("p-unused"), false);
  assert.equal(next.sessions.has(starterId), false);
});

test("openProjectTerminal splits a focused non-empty chat pane into a new terminal leaf and leaves the chat intact", () => {
  const session = chatSession({ cwd: "/repo/orig", piSessionId: "pi-live" });
  const state = stateWithChatPane(session);

  const next = openProjectTerminal(state, { cwd: "/repo/bar", newPaneId: "p-term" });

  assert.deepEqual(collectLeaves(next.layout), ["p-init", "p-term"]);
  const term = asTerminal(next.panesById.get("p-term"));
  assert.equal(term.cwd, "/repo/bar");
  assert.equal(term.mountKey, "pane:p-term");
  assert.equal(term.ownerSessionId, null);
  assert.equal(next.focusedPaneId, "p-term");
  assert.deepEqual(next.panesById.get("p-init"), { sessionId: session.id });
  assert.equal(next.sessions.get(session.id), session);
});

test("openProjectTerminal is a no-op when the focused pane is not a layout leaf", () => {
  const session = chatSession({ piSessionId: "pi-live" });
  const state: WorkspaceState = { ...stateWithChatPane(session), focusedPaneId: "p-ghost" };

  const next = openProjectTerminal(state, { cwd: "/repo/bar", newPaneId: "p-term" });

  assert.equal(next, state);
});

test("urlNavRequested with terminal:true opens a terminal at the project path without creating a chat session, and dedupes by key", () => {
  const session = chatSession({ cwd: "/repo/orig", piSessionId: "pi-live" });
  const state = stateWithChatPane(session);

  const action: WorkspaceAction = {
    type: "urlNavRequested",
    key: "nav-term-1",
    project: project({ path: "/repo/proj" }),
    paneId: "p-term",
    tab: chatSession(),
    terminal: true,
  };

  const next = reducer(state, action);

  const term = asTerminal(next.panesById.get("p-term"));
  assert.equal(term.cwd, "/repo/proj");
  assert.equal(next.focusedPaneId, "p-term");
  assert.equal(next.lastHandledNavKey, "nav-term-1");
  assert.deepEqual(collectLeaves(next.layout), ["p-init", "p-term"]);
  assert.equal(next.sessions.size, 1);
  assert.ok(next.sessions.has(session.id));

  assert.equal(reducer(next, action), next);
});

test("applyUrlNavigation with terminal:true but no paneId marks the nav key without converting the focused pane", () => {
  const state = createInitialState();
  const focusedId = state.focusedPaneId;

  const next = applyUrlNavigation(state, {
    key: "nav-term-guard",
    project: project(),
    terminal: true,
  });

  assert.equal(next.lastHandledNavKey, "nav-term-guard");
  assert.notEqual(next.panesById.get(focusedId)?.kind, "terminal");
  assert.equal(next.sessions.size, state.sessions.size);
});
