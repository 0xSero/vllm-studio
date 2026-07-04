import assert from "node:assert/strict";
import test from "node:test";

import { makeFreshTab } from "../src/features/agent/messages/helpers";
import type { Session } from "../src/features/agent/runtime/types";
import {
  activeSession,
  findPaneByPiSessionId,
  paneSessionId,
  referencedSessionIds,
} from "../src/features/agent/runtime/selectors";
import { collectLeaves } from "../src/features/agent/workspace/layout";
import {
  applyUrlNavigation,
  closePane,
  openTerminalPane,
} from "../src/features/agent/workspace/pane-controller";
import {
  PANE_STATE_KEY,
  createInitialState,
  restorePersistedPaneState,
  type WorkspaceStorage,
} from "../src/features/agent/workspace/store";
import { writePaneState } from "../src/features/agent/workspace/persistence";
import {
  runWorkspaceEffect,
  type WorkspaceEffectDeps,
} from "../src/features/agent/workspace/effects";
import type {
  ChatPaneState,
  PaneState,
  TerminalPaneState,
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

function twoChatPaneState(a: Session, b: Session): WorkspaceState {
  return {
    ...createInitialState(),
    sessions: new Map([
      [a.id, a],
      [b.id, b],
    ]),
    layout: {
      kind: "split",
      direction: "vertical",
      ratio: 0.5,
      a: { kind: "leaf", paneId: "p-a" },
      b: { kind: "leaf", paneId: "p-b" },
    },
    panesById: new Map<string, PaneState>([
      ["p-a", { sessionId: a.id }],
      ["p-b", { sessionId: b.id }],
    ]),
    focusedPaneId: "p-a",
  };
}

function asTerminal(pane: PaneState | undefined): TerminalPaneState {
  if (!pane || pane.kind !== "terminal") assert.fail("expected a terminal pane");
  return pane;
}

function asChat(pane: PaneState | undefined): ChatPaneState {
  if (!pane || pane.kind === "terminal") assert.fail("expected a chat pane");
  return pane;
}

function fakeStorage(): { storage: WorkspaceStorage; map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    storage: {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => void map.set(key, value),
      removeItem: (key) => void map.delete(key),
    },
    map,
  };
}

function effectDeps(): { deps: WorkspaceEffectDeps; closed: string[] } {
  const closed: string[] = [];
  const deps: WorkspaceEffectDeps = {
    storage: fakeStorage().storage,
    window: {
      Event,
      CustomEvent,
      dispatchEvent: () => true,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    api: {},
    queueReplay: () => {},
    closeTerminalOwner: (mountKey) => {
      closed.push(mountKey);
    },
  };
  return { deps, closed };
}

test("openTerminalPane splits a single chat pane and inherits owner identity from the source session", () => {
  const session = chatSession({ cwd: "/repo/demo", piSessionId: "pi-source" });
  const state = stateWithChatPane(session);

  const next = openTerminalPane(state, { sourcePaneId: "p-init", newPaneId: "p-term" });

  assert.deepEqual(collectLeaves(next.layout), ["p-init", "p-term"]);
  const term = asTerminal(next.panesById.get("p-term"));
  assert.equal(term.mountKey, "pane:p-term");
  assert.equal(term.cwd, "/repo/demo");
  assert.equal(term.ownerSessionId, session.id);
  assert.equal(term.ownerPiSessionId, "pi-source");
  assert.equal(next.focusedPaneId, "p-term");
  assert.equal(asChat(next.panesById.get("p-init")).sessionId, session.id);
  assert.equal(next.sessions.get(session.id), session);
});

test("openTerminalPane with two leaves replaces the sibling pane and prunes its orphaned session", () => {
  const a = chatSession({ cwd: "/repo/a", piSessionId: "pi-a" });
  const b = chatSession({ piSessionId: "pi-b" });
  const state = twoChatPaneState(a, b);

  const next = openTerminalPane(state, { sourcePaneId: "p-a", newPaneId: "p-fresh" });

  assert.deepEqual(collectLeaves(next.layout), ["p-a", "p-b"]);
  assert.equal(next.panesById.has("p-fresh"), false);
  const term = asTerminal(next.panesById.get("p-b"));
  assert.equal(term.mountKey, "pane:p-fresh");
  assert.equal(term.cwd, "/repo/a");
  assert.equal(term.ownerSessionId, a.id);
  assert.equal(term.ownerPiSessionId, "pi-a");
  assert.equal(next.focusedPaneId, "p-b");
  assert.equal(next.sessions.has(b.id), false);
  assert.equal(next.sessions.get(a.id), a);
});

test("openTerminalPane with an invalid source pane returns the state unchanged", () => {
  const state = stateWithChatPane(chatSession());
  assert.equal(openTerminalPane(state, { sourcePaneId: "p-missing", newPaneId: "p-term" }), state);
});

test("closing the terminal pane triggers closeTerminalOwner exactly once with its mountKey", () => {
  const session = chatSession({ cwd: "/repo/demo", piSessionId: "pi-owner" });
  const prev = openTerminalPane(stateWithChatPane(session), {
    sourcePaneId: "p-init",
    newPaneId: "p-term",
  });
  const next = closePane(prev, { paneId: "p-term" });
  const { deps, closed } = effectDeps();

  runWorkspaceEffect({ type: "closePane", paneId: "p-term" }, prev, next, deps);

  assert.deepEqual(closed, ["pane:p-term"]);
});

test("closing the chat pane leaves the surviving terminal's owner untouched", () => {
  const session = chatSession({ cwd: "/repo/demo", piSessionId: "pi-owner" });
  const prev = openTerminalPane(stateWithChatPane(session), {
    sourcePaneId: "p-init",
    newPaneId: "p-term",
  });
  const next = closePane(prev, { paneId: "p-init" });
  const { deps, closed } = effectDeps();

  runWorkspaceEffect({ type: "closePane", paneId: "p-init" }, prev, next, deps);

  assert.equal(asTerminal(next.panesById.get("p-term")).mountKey, "pane:p-term");
  assert.deepEqual(closed, []);
});

test("url ?new=1 navigation while a terminal pane is focused retargets the chat leaf", () => {
  const original = chatSession({ piSessionId: "pi-original" });
  const withTerminal = openTerminalPane(stateWithChatPane(original), {
    sourcePaneId: "p-init",
    newPaneId: "p-term",
  });
  assert.equal(withTerminal.focusedPaneId, "p-term");
  const fresh = chatSession();

  const next = applyUrlNavigation(withTerminal, {
    key: "nav-new-1",
    project: null,
    newSession: true,
    tab: fresh,
  });

  assert.equal(next.panesById.get("p-term"), withTerminal.panesById.get("p-term"));
  assert.deepEqual(collectLeaves(next.layout), ["p-init", "p-term"]);
  assert.equal(asChat(next.panesById.get("p-init")).sessionId, fresh.id);
  assert.equal(next.focusedPaneId, "p-init");
  assert.ok(next.sessions.has(fresh.id));
  assert.equal(next.sessions.has(original.id), false);
});

test("writePaneState/restorePersistedPaneState round-trips a mixed chat+terminal workspace", () => {
  const session = chatSession({
    cwd: "/repo/work",
    piSessionId: "pi-round",
    title: "Round trip",
  });
  const state = openTerminalPane(stateWithChatPane(session), {
    sourcePaneId: "p-init",
    newPaneId: "p-term",
  });
  const { storage, map } = fakeStorage();

  writePaneState(storage, state);
  const raw = map.get(PANE_STATE_KEY) ?? assert.fail("pane state was not persisted");

  const persisted = JSON.parse(raw) as { panes: Record<string, unknown> };
  assert.deepEqual(persisted.panes["p-term"], state.panesById.get("p-term"));

  const restored = restorePersistedPaneState(raw) ?? assert.fail("restore returned null");
  assert.deepEqual(collectLeaves(restored.layout), ["p-init", "p-term"]);
  assert.equal(restored.focusedPaneId, "p-term");
  assert.deepEqual(restored.panesById.get("p-term"), state.panesById.get("p-term"));
  assert.equal(asChat(restored.panesById.get("p-init")).sessionId, session.id);
  const restoredSession =
    restored.sessions.get(session.id) ?? assert.fail("chat session was not restored");
  assert.equal(restoredSession.piSessionId, "pi-round");
  assert.equal(restoredSession.cwd, "/repo/work");
  assert.equal(restoredSession.title, "Round trip");
});

test("legacy chat-only persisted payloads still restore as chat panes", () => {
  const raw = JSON.stringify({
    version: 1,
    layout: { kind: "leaf", paneId: "p-legacy" },
    focusedPaneId: "p-legacy",
    panes: {
      "p-legacy": {
        activeTabId: "tab-old",
        tabs: [
          {
            id: "tab-old",
            piSessionId: "pi-old",
            title: "Old chat",
            status: "idle",
            cwd: "/old-project",
          },
        ],
      },
    },
  });

  const restored = restorePersistedPaneState(raw) ?? assert.fail("restore returned null");

  assert.equal(asChat(restored.panesById.get("p-legacy")).sessionId, "tab-old");
  const session =
    restored.sessions.get("tab-old") ?? assert.fail("legacy session was not restored");
  assert.equal(session.piSessionId, "pi-old");
  assert.equal(session.cwd, "/old-project");
  assert.equal(session.title, "Old chat");
});

test("session selectors ignore terminal panes and their owner references", () => {
  const session = chatSession({ piSessionId: "pi-chat" });
  const terminal: TerminalPaneState = {
    kind: "terminal",
    mountKey: "pane:p-term",
    cwd: "/repo/demo",
    title: "Terminal",
    ownerSessionId: "ghost-session",
    ownerPiSessionId: "pi-ghost",
  };
  const state: WorkspaceState = {
    ...stateWithChatPane(session),
    layout: {
      kind: "split",
      direction: "vertical",
      ratio: 0.5,
      a: { kind: "leaf", paneId: "p-init" },
      b: { kind: "leaf", paneId: "p-term" },
    },
    panesById: new Map<string, PaneState>([
      ["p-init", { sessionId: session.id }],
      ["p-term", terminal],
    ]),
    focusedPaneId: "p-term",
  };

  assert.equal(paneSessionId(terminal), null);
  assert.equal(activeSession(state, "p-term"), null);
  assert.equal(activeSession(state, "p-init")?.id, session.id);
  assert.deepEqual(referencedSessionIds(state), new Set([session.id]));
  assert.equal(findPaneByPiSessionId(state, "pi-ghost"), null);
  assert.equal(findPaneByPiSessionId(state, "pi-chat")?.paneId, "p-init");
});
