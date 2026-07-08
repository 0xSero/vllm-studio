import assert from "node:assert/strict";
import test from "node:test";

import { makeFreshTab } from "../src/features/agent/messages/helpers";
import type { Session } from "../src/features/agent/runtime/types";
import {
  clampLayoutToLimits,
  collectLeaves,
  layoutGridSize,
  type Layout,
  type LayoutSplit,
} from "../src/features/agent/workspace/layout";
import {
  applyUrlNavigation,
  openProjectTerminal,
  splitTerminalPane,
} from "../src/features/agent/workspace/pane-controller";
import { reducer } from "../src/features/agent/workspace/reducer";
import {
  createInitialState,
  restorePersistedPaneState,
} from "../src/features/agent/workspace/store";
import type { Project } from "../src/features/agent/projects/types";
import type {
  ChatPaneState,
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

function terminalPane(cwd: string | null): TerminalPaneState {
  return {
    kind: "terminal",
    mountKey: "pane:seed",
    cwd,
    title: "Terminal",
    ownerSessionId: null,
    ownerPiSessionId: null,
  };
}

function stateWithTerminalPane(cwd: string | null): WorkspaceState {
  return {
    ...createInitialState(),
    sessions: new Map(),
    panesById: new Map<string, PaneState>([["p-term", terminalPane(cwd)]]),
    layout: { kind: "leaf", paneId: "p-term" },
    focusedPaneId: "p-term",
  };
}

function asSplit(layout: Layout): LayoutSplit {
  if (layout.kind !== "split") assert.fail("expected a split layout");
  return layout;
}

function asChat(pane: PaneState | undefined): ChatPaneState {
  if (!pane || pane.kind === "terminal") assert.fail("expected a chat pane");
  return pane;
}

function leaf(paneId: string): Layout {
  return { kind: "leaf", paneId };
}

function vsplit(a: Layout, b: Layout): Layout {
  return { kind: "split", direction: "vertical", ratio: 0.5, a, b };
}

function hsplit(a: Layout, b: Layout): Layout {
  return { kind: "split", direction: "horizontal", ratio: 0.5, a, b };
}

test("splitTerminalPane splits a focused terminal into a new terminal leaf that inherits cwd and takes focus", () => {
  const state = stateWithTerminalPane("/repo/src");

  const next = splitTerminalPane(state, {
    sourcePaneId: "p-term",
    newPaneId: "p-term-2",
    direction: "vertical",
  });

  assert.deepEqual(collectLeaves(next.layout), ["p-term", "p-term-2"]);
  const term = asTerminal(next.panesById.get("p-term-2"));
  assert.equal(term.cwd, "/repo/src");
  assert.equal(term.mountKey, "pane:p-term-2");
  assert.equal(term.ownerSessionId, null);
  assert.equal(next.focusedPaneId, "p-term-2");
  assert.deepEqual(next.panesById.get("p-term"), state.panesById.get("p-term"));
});

test("splitTerminalPane honors the requested split direction", () => {
  const state = stateWithTerminalPane("/x");

  const vertical = splitTerminalPane(state, {
    sourcePaneId: "p-term",
    newPaneId: "p-a",
    direction: "vertical",
  });
  const horizontal = splitTerminalPane(state, {
    sourcePaneId: "p-term",
    newPaneId: "p-b",
    direction: "horizontal",
  });

  assert.equal(asSplit(vertical.layout).direction, "vertical");
  assert.equal(asSplit(horizontal.layout).direction, "horizontal");
});

test("splitTerminalPane is a no-op when the source pane is a chat pane", () => {
  const session = chatSession({ piSessionId: "pi-live" });
  const state = stateWithChatPane(session);

  const next = splitTerminalPane(state, {
    sourcePaneId: "p-init",
    newPaneId: "p-term",
    direction: "vertical",
  });

  assert.equal(next, state);
});

test("splitTerminalPane is a no-op when the source terminal is not a layout leaf", () => {
  const state = stateWithTerminalPane("/x");
  const panes = new Map(state.panesById);
  panes.set("p-orphan", terminalPane("/y"));
  const detached: WorkspaceState = { ...state, panesById: panes };

  const next = splitTerminalPane(detached, {
    sourcePaneId: "p-orphan",
    newPaneId: "p-new",
    direction: "vertical",
  });

  assert.equal(next, detached);
  assert.equal(next.panesById.has("p-new"), false);
});

test("splitTerminalPane is a no-op when newPaneId is empty", () => {
  const state = stateWithTerminalPane("/x");

  const next = splitTerminalPane(state, {
    sourcePaneId: "p-term",
    newPaneId: "",
    direction: "vertical",
  });

  assert.equal(next, state);
  assert.deepEqual(collectLeaves(next.layout), ["p-term"]);
});

test("reducer splitTerminalPane action splits the focused terminal through the controller", () => {
  const state = stateWithTerminalPane("/repo/app");

  const next = reducer(state, {
    type: "splitTerminalPane",
    sourcePaneId: "p-term",
    newPaneId: "p-term-2",
    direction: "horizontal",
  });

  assert.deepEqual(collectLeaves(next.layout), ["p-term", "p-term-2"]);
  assert.equal(asTerminal(next.panesById.get("p-term-2")).cwd, "/repo/app");
  assert.equal(asSplit(next.layout).direction, "horizontal");
  assert.equal(next.focusedPaneId, "p-term-2");
});

test("urlNavRequested newSession never replaces a focused terminal and opens the chat in a split", () => {
  const state = stateWithTerminalPane("/repo/app");
  const tab = chatSession();

  const next = reducer(state, {
    type: "urlNavRequested",
    key: "nav-new-1",
    project: project(),
    newSession: true,
    paneId: "p-chat",
    tab,
  });

  assert.deepEqual(next.panesById.get("p-term"), state.panesById.get("p-term"));
  assert.equal(asTerminal(next.panesById.get("p-term")).cwd, "/repo/app");
  assert.deepEqual(collectLeaves(next.layout), ["p-term", "p-chat"]);
  assert.equal(asChat(next.panesById.get("p-chat")).sessionId, tab.id);
  assert.equal(next.focusedPaneId, "p-chat");
  assert.ok(next.sessions.has(tab.id));
});

test("urlNavRequested newSession replaces the sibling chat leaf and leaves the terminal untouched", () => {
  const existing = chatSession({ piSessionId: "pi-1" });
  const state: WorkspaceState = {
    ...createInitialState(),
    sessions: new Map([[existing.id, existing]]),
    panesById: new Map<string, PaneState>([
      ["p-term", terminalPane("/repo/app")],
      ["p-chat", { sessionId: existing.id }],
    ]),
    layout: {
      kind: "split",
      direction: "vertical",
      ratio: 0.5,
      a: { kind: "leaf", paneId: "p-term" },
      b: { kind: "leaf", paneId: "p-chat" },
    },
    focusedPaneId: "p-term",
  };
  const tab = chatSession();

  const next = reducer(state, {
    type: "urlNavRequested",
    key: "nav-new-2",
    project: project(),
    newSession: true,
    paneId: "p-new",
    tab,
  });

  assert.deepEqual(collectLeaves(next.layout), ["p-term", "p-chat"]);
  assert.equal(next.panesById.has("p-new"), false);
  assert.deepEqual(next.panesById.get("p-term"), state.panesById.get("p-term"));
  assert.equal(asChat(next.panesById.get("p-chat")).sessionId, tab.id);
  assert.equal(next.sessions.has(existing.id), false);
  assert.equal(next.focusedPaneId, "p-chat");
});

test("splitTerminalPane allows three side-by-side terminals but refuses a fourth column", () => {
  const state = stateWithTerminalPane("/g");

  const two = splitTerminalPane(state, {
    sourcePaneId: "p-term",
    newPaneId: "p2",
    direction: "vertical",
  });
  const three = splitTerminalPane(two, {
    sourcePaneId: "p2",
    newPaneId: "p3",
    direction: "vertical",
  });

  assert.deepEqual(collectLeaves(three.layout), ["p-term", "p2", "p3"]);
  assert.deepEqual(layoutGridSize(three.layout), { cols: 3, rows: 1 });

  const refused = splitTerminalPane(three, {
    sourcePaneId: "p3",
    newPaneId: "p4",
    direction: "vertical",
  });

  assert.equal(refused, three);
  assert.equal(refused.panesById.has("p4"), false);
  assert.deepEqual(collectLeaves(refused.layout), ["p-term", "p2", "p3"]);
});

test("splitTerminalPane allows two stacked rows but refuses a third row", () => {
  const state = stateWithTerminalPane("/g");

  const two = splitTerminalPane(state, {
    sourcePaneId: "p-term",
    newPaneId: "p2",
    direction: "horizontal",
  });

  assert.deepEqual(layoutGridSize(two.layout), { cols: 1, rows: 2 });

  const refused = splitTerminalPane(two, {
    sourcePaneId: "p2",
    newPaneId: "p3",
    direction: "horizontal",
  });

  assert.equal(refused, two);
  assert.equal(refused.panesById.has("p3"), false);
});

test("layoutGridSize sums along the split axis and maxes across it", () => {
  const cases: { name: string; layout: Layout; cols: number; rows: number }[] = [
    { name: "leaf", layout: leaf("a"), cols: 1, rows: 1 },
    { name: "two columns", layout: vsplit(leaf("a"), leaf("b")), cols: 2, rows: 1 },
    { name: "two rows", layout: hsplit(leaf("a"), leaf("b")), cols: 1, rows: 2 },
    {
      name: "left column beside a stacked pair",
      layout: vsplit(leaf("a"), hsplit(leaf("b"), leaf("c"))),
      cols: 2,
      rows: 2,
    },
    {
      name: "top row above a side-by-side pair",
      layout: hsplit(vsplit(leaf("a"), leaf("b")), leaf("c")),
      cols: 2,
      rows: 2,
    },
    {
      name: "full three by two grid",
      layout: vsplit(
        hsplit(leaf("a"), leaf("b")),
        vsplit(hsplit(leaf("c"), leaf("d")), hsplit(leaf("e"), leaf("f"))),
      ),
      cols: 3,
      rows: 2,
    },
  ];

  for (const testCase of cases) {
    assert.deepEqual(
      layoutGridSize(testCase.layout),
      { cols: testCase.cols, rows: testCase.rows },
      testCase.name,
    );
  }
});

test("openProjectTerminal refuses to split when the grid is already three columns wide", () => {
  const base = stateWithTerminalPane("/g");
  const two = splitTerminalPane(base, {
    sourcePaneId: "p-term",
    newPaneId: "p2",
    direction: "vertical",
  });
  const three = splitTerminalPane(two, {
    sourcePaneId: "p2",
    newPaneId: "p3",
    direction: "vertical",
  });

  const next = openProjectTerminal(three, { cwd: "/repo/new", newPaneId: "p4" });

  assert.equal(next, three);
  assert.equal(next.panesById.has("p4"), false);
});

test("urlNavRequested newSession is refused when a terminal-only grid is already full", () => {
  const base = stateWithTerminalPane("/g");
  const two = splitTerminalPane(base, {
    sourcePaneId: "p-term",
    newPaneId: "p2",
    direction: "vertical",
  });
  const three = splitTerminalPane(two, {
    sourcePaneId: "p2",
    newPaneId: "p3",
    direction: "vertical",
  });
  const tab = chatSession();

  const next = reducer(three, {
    type: "urlNavRequested",
    key: "nav-full",
    project: project(),
    newSession: true,
    paneId: "p-chat",
    tab,
  });

  assert.deepEqual(collectLeaves(next.layout), ["p-term", "p2", "p3"]);
  assert.equal(next.panesById.has("p-chat"), false);
  assert.equal(next.sessions.has(tab.id), false);
  assert.equal(asTerminal(next.panesById.get("p3")).kind, "terminal");
});

test("clampLayoutToLimits drops trailing droppable leaves until the grid fits", () => {
  const layout = vsplit(leaf("p1"), vsplit(leaf("p2"), vsplit(leaf("p3"), leaf("p4"))));

  const clamped = clampLayoutToLimits(layout, () => true);

  assert.deepEqual(collectLeaves(clamped), ["p1", "p2", "p3"]);
  assert.deepEqual(layoutGridSize(clamped), { cols: 3, rows: 1 });
});

test("clampLayoutToLimits leaves an over-cap layout untouched when nothing is droppable", () => {
  const layout = vsplit(leaf("c1"), vsplit(leaf("c2"), vsplit(leaf("c3"), leaf("c4"))));

  const clamped = clampLayoutToLimits(layout, () => false);

  assert.equal(clamped, layout);
  assert.deepEqual(collectLeaves(clamped), ["c1", "c2", "c3", "c4"]);
});

test("clampLayoutToLimits prunes only droppable leaves and preserves protected ones", () => {
  const layout = vsplit(leaf("t1"), vsplit(leaf("c2"), vsplit(leaf("t3"), leaf("t4"))));

  const clamped = clampLayoutToLimits(layout, (paneId) => paneId.startsWith("t"));

  assert.deepEqual(collectLeaves(clamped), ["t1", "c2", "t3"]);
  assert.deepEqual(layoutGridSize(clamped), { cols: 3, rows: 1 });
});

test("restorePersistedPaneState clamps an over-cap terminal layout by dropping trailing terminals", () => {
  const layout = vsplit(leaf("p1"), vsplit(leaf("p2"), vsplit(leaf("p3"), leaf("p4"))));
  const raw = JSON.stringify({
    version: 1,
    focusedPaneId: "p1",
    layout,
    panes: {
      p1: { kind: "terminal", mountKey: "pane:p1" },
      p2: { kind: "terminal", mountKey: "pane:p2" },
      p3: { kind: "terminal", mountKey: "pane:p3" },
      p4: { kind: "terminal", mountKey: "pane:p4" },
    },
  });

  const restored = restorePersistedPaneState(raw);

  assert.ok(restored);
  assert.deepEqual(collectLeaves(restored.layout), ["p1", "p2", "p3"]);
  assert.equal(restored.panesById.has("p4"), false);
  assert.equal(asTerminal(restored.panesById.get("p3")).kind, "terminal");
});

test("restorePersistedPaneState keeps every chat leaf when only chats exceed the grid", () => {
  const layout = vsplit(leaf("c1"), vsplit(leaf("c2"), vsplit(leaf("c3"), leaf("c4"))));
  const raw = JSON.stringify({ version: 1, focusedPaneId: "c1", layout, panes: {} });

  const restored = restorePersistedPaneState(raw);

  assert.ok(restored);
  assert.deepEqual(collectLeaves(restored.layout), ["c1", "c2", "c3", "c4"]);
  assert.equal(restored.panesById.size, 4);
  for (const paneId of ["c1", "c2", "c3", "c4"]) {
    assert.notEqual(restored.panesById.get(paneId)?.kind, "terminal");
  }
});
