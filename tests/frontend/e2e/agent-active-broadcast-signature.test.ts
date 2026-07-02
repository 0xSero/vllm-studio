import assert from "node:assert/strict";
import test from "node:test";

import { activeBroadcastSignature } from "@/features/agent/workspace/effects";
import type { WorkspaceState } from "@/features/agent/workspace/types";
import type { Session } from "@/features/agent/runtime/types";

function session(patch: Partial<Session> = {}): Session {
  return {
    id: "s-1",
    piSessionId: "pi-1",
    title: "Build a site",
    status: "running",
    error: "",
    input: "",
    startedAt: "2026-06-23T00:00:00.000Z",
    messages: [
      { id: "u1", role: "user", text: "go" },
      { id: "a1", role: "assistant", text: "wor", blocks: [{ kind: "text", id: "t", text: "wor" }] },
    ],
    ...patch,
  };
}

function state(tab: Session): WorkspaceState {
  return {
    sessions: new Map([[tab.id, tab]]),
    models: [],
    selectedModel: "deepseek-v4-flash",
    modelsLoading: false,
    layout: { kind: "leaf", paneId: "p-main" },
    panesById: new Map([["p-main", { sessionId: tab.id }]]),
    focusedPaneId: "p-main",
    setupWarning: "",
    error: "",
    hydrated: true,
    lastHandledNavKey: "",
  };
}

test("a streaming text delta (last message grows in place) leaves the broadcast signature unchanged", () => {
  const before = state(session());
  // Same session, last assistant message text grew — the streaming hot path.
  const grown = session({
    messages: [
      { id: "u1", role: "user", text: "go" },
      {
        id: "a1",
        role: "assistant",
        text: "working on it now",
        blocks: [{ kind: "text", id: "t", text: "working on it now" }],
      },
    ],
  });
  const after = state(grown);
  assert.equal(
    activeBroadcastSignature(before),
    activeBroadcastSignature(after),
    "text-only delta must not change the signature (so the broadcast recompute is skipped)",
  );
});

test("broadcast-relevant changes DO change the signature", () => {
  const base = activeBroadcastSignature(state(session()));
  assert.notEqual(base, activeBroadcastSignature(state(session({ status: "idle" }))), "status");
  assert.notEqual(base, activeBroadcastSignature(state(session({ title: "Other" }))), "title");
  assert.notEqual(base, activeBroadcastSignature(state(session({ piSessionId: "pi-2" }))), "piId");
  assert.notEqual(base, activeBroadcastSignature(state(session({ cwd: "/tmp/x" }))), "cwd");
  // A genuinely new message (length change) — e.g. a follow-up user turn.
  const withMore = session({
    messages: [
      { id: "u1", role: "user", text: "go" },
      { id: "a1", role: "assistant", text: "wor" },
      { id: "u2", role: "user", text: "again" },
    ],
  });
  assert.notEqual(base, activeBroadcastSignature(state(withMore)), "new message");
});

test("an unhydrated workspace collapses to a constant signature distinct from any hydrated one", () => {
  const unhydratedA = activeBroadcastSignature({ ...state(session()), hydrated: false });
  const unhydratedB = activeBroadcastSignature({ ...state(session({ title: "x" })), hydrated: false });
  assert.equal(unhydratedA, unhydratedB, "unhydrated signature ignores session contents");
  assert.notEqual(
    unhydratedA,
    activeBroadcastSignature(state(session())),
    "unhydrated must differ from a hydrated signature",
  );
});
