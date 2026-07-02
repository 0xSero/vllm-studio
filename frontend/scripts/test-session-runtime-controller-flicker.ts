import assert from "node:assert/strict";
import test from "node:test";
import {
  createSessionRuntimeController,
  type SessionRuntimeBinding,
} from "../src/features/agent/runtime/session-runtime-controller";
import type {
  RuntimeEventPayload,
  RuntimeEventSubscription,
  RuntimeSessionSummary,
} from "../src/features/agent/runtime/api";
import type { Session } from "../src/features/agent/runtime/types";

// Regression for the post-first-turn flicker: after the SSE delivers the
// authoritative `agent_end` (status -> idle), the server's runtime list still
// reports the just-finished runtime as active for a few seconds (it drops
// lazily). The poll's active branch must NOT re-promote the session to
// "running" off that stale snapshot — doing so oscillates status running<->idle
// and reopens the SSE on every tick (visible flicker + disconnect churn).

type Harness = {
  controller: ReturnType<typeof createSessionRuntimeController>;
  getSession: () => Session;
  sendAgentEnd: (seq: number) => void;
};

function makeHarness(opts: {
  runtimeList: RuntimeSessionSummary[];
  pollIdleGraceMs?: number;
}): Harness {
  let session: Session = {
    id: "tab-1",
    runtimeSessionId: "rt-1",
    piSessionId: "pi-1",
    lastEventSeq: undefined,
    title: "Flicker test",
    messages: [
      { id: "user-1", role: "user", text: "hello" },
      { id: "assistant-1", role: "assistant", text: "", blocks: [] },
    ],
    status: "running",
    error: "",
    input: "",
    activeAssistantId: "assistant-1",
  };
  const sink: { current?: (payload: RuntimeEventPayload) => void } = {};

  const controller = createSessionRuntimeController({
    idleReconnectMs: 0,
    pollIntervalMs: 1_000_000,
    pollIdleGraceMs: opts.pollIdleGraceMs,
    api: {
      listRuntimeSessions: async () => opts.runtimeList,
      loadRuntimeStatus: async () => null,
      subscribeRuntimeEvents: (
        _runtime,
        _after,
        _piSessionId,
        handlers,
      ): RuntimeEventSubscription => {
        sink.current = handlers.onPayload;
        return { close: () => undefined };
      },
    },
  });

  const binding: SessionRuntimeBinding = {
    commit: (id, patch) => {
      if (id === "tab-1") session = patch(session);
    },
    getSession: (id) => (id === "tab-1" ? session : undefined),
    getSessions: () => [session],
  };
  controller.bind(binding);
  controller.reconcile([session]);

  return {
    controller,
    getSession: () => session,
    sendAgentEnd: (seq) => {
      const send = sink.current;
      if (!send) throw new Error("runtime subscription was not opened");
      send({ type: "pi", seq, event: { type: "agent_end" } });
    },
  };
}

const STALE_ACTIVE: RuntimeSessionSummary[] = [
  { sessionId: "rt-1", status: { active: true, piSessionId: "pi-1" } },
];

test("a stale still-active poll snapshot does not resurrect 'running' after agent_end", async () => {
  const h = makeHarness({ runtimeList: STALE_ACTIVE });

  h.sendAgentEnd(1);
  assert.equal(h.getSession().status, "idle", "agent_end settles the turn to idle");

  // The runtime list still reports rt-1 active; the poll must honor the finish
  // grace and leave the session idle.
  h.controller.pollNow();
  await new Promise((resolve) => setTimeout(resolve, 0));

  try {
    assert.equal(
      h.getSession().status,
      "idle",
      "poll must NOT re-promote a just-finished session off a stale active snapshot",
    );
  } finally {
    h.controller.closeAll();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("once the finish grace elapses, a still-active runtime IS re-promoted (recovery preserved)", async () => {
  // grace = 0 -> the finish window is already expired by the time the poll runs.
  const h = makeHarness({ runtimeList: STALE_ACTIVE, pollIdleGraceMs: 0 });

  h.sendAgentEnd(1);
  assert.equal(h.getSession().status, "idle");

  h.controller.pollNow();
  await new Promise((resolve) => setTimeout(resolve, 0));

  try {
    assert.equal(
      h.getSession().status,
      "running",
      "past the grace window the active branch must still recover a genuinely-running session",
    );
  } finally {
    h.controller.closeAll();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("a new turn accepted after agent_end is promoted by the poll (restart supersedes the finish)", async () => {
  const h = makeHarness({ runtimeList: STALE_ACTIVE });

  h.sendAgentEnd(1);
  assert.equal(h.getSession().status, "idle");

  // User sends another turn inside the grace window: noteTurnAccepted clears the
  // finish stamp, so the poll's active branch must promote it, not suppress it.
  h.controller.noteTurnAccepted("tab-1", "assistant-2");
  h.controller.pollNow();
  await new Promise((resolve) => setTimeout(resolve, 0));

  try {
    assert.equal(
      h.getSession().status,
      "running",
      "a turn accepted after the finish must not be swallowed by the finish grace",
    );
  } finally {
    h.controller.closeAll();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
});
