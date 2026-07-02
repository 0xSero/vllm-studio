import assert from "node:assert/strict";
import test from "node:test";
import {
  createSessionRuntimeController,
  type SessionRuntimeBinding,
} from "../src/features/agent/runtime/session-runtime-controller";
import type {
  RuntimeEventPayload,
  RuntimeEventSubscription,
} from "../src/features/agent/runtime/api";
import type { Session } from "../src/features/agent/runtime/types";

// Regression for the first-turn duplication: when pi assigns a session id
// mid-turn, the SSE connection key changes, so reconcile tears down and reopens
// the attachment. The reopened subscription must resume from the highest
// RECEIVED seq, NOT from the (lagging) persisted lastEventSeq — otherwise the
// runtime backlog is re-delivered and messages duplicate/flicker.
test("a mid-turn piSessionId adoption does not rewind the live cursor (no backlog re-replay)", async () => {
  const sessionId = "tab-1";
  const afters: number[] = [];
  const sink: { current?: (payload: RuntimeEventPayload) => void } = {};

  let liveSession: Session = {
    id: sessionId,
    runtimeSessionId: "rt-1",
    // First turn: pi id not assigned yet, nothing persisted.
    piSessionId: null,
    lastEventSeq: undefined,
    title: "Reconnect test",
    messages: [
      { id: "user-1", role: "user", text: "hello" },
      { id: "assistant-1", role: "assistant", text: "", blocks: [] },
    ],
    status: "running",
    error: "",
    input: "",
    activeAssistantId: "assistant-1",
  };

  const controller = createSessionRuntimeController({
    idleReconnectMs: 0,
    api: {
      listRuntimeSessions: async () => [],
      loadRuntimeStatus: async () => null,
      subscribeRuntimeEvents: (
        _runtime,
        after,
        _piSessionId,
        handlers,
      ): RuntimeEventSubscription => {
        afters.push(after);
        sink.current = handlers.onPayload;
        return { close: () => undefined };
      },
    },
  });

  const binding: SessionRuntimeBinding = {
    commit: (targetSessionId, patch) => {
      assert.equal(targetSessionId, sessionId);
      liveSession = patch(liveSession);
    },
    getSession: () => liveSession,
    getSessions: () => [liveSession],
  };
  controller.bind(binding);

  // First attach for a brand-new live session.
  controller.reconcile([liveSession]);
  assert.equal(afters.length, 1, "one attachment opened on first reconcile");
  assert.equal(afters[0], 0, "first attach resumes from 0 (no live cursor yet)");

  // Stream ten events; the live cursor's receivedSeq climbs to 10.
  const send = sink.current;
  if (!send) throw new Error("runtime subscription was not opened");
  for (let seq = 1; seq <= 10; seq += 1) {
    send({
      type: "pi",
      seq,
      event: {
        type: "message_update",
        message: { role: "assistant", content: [{ type: "text", text: `chunk ${seq}` }] },
      },
    });
  }

  // Pi now reports its assigned session id mid-turn -> connection key changes ->
  // reconcile closes the old SSE and opens a new one for the same live session.
  // Meanwhile the committed cursor (7) has been persisted to lastEventSeq and
  // lags the received cursor (10) — the coalescer hasn't flushed the tail.
  liveSession = { ...liveSession, piSessionId: "pi-1", lastEventSeq: 7 };
  controller.reconcile([liveSession]);

  assert.equal(afters.length, 2, "the piSessionId change reopened the attachment");
  assert.equal(
    afters[1],
    10,
    `reopened SSE must resume from the highest received seq (10), not the stale lastEventSeq (7); got ${afters[1]}`,
  );

  controller.closeAll();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

// Regression for finding [8]: two open sessions transiently share a piSessionId
// (forked tab / pref copy / mid-adoption). One runtime entry must not promote and
// repoint BOTH — only the session that actually owns that runtime id.
test("a piSessionId shared by two sessions does not let one runtime entry drive both", async () => {
  let sessionA: Session = {
    id: "tab-A",
    runtimeSessionId: "rt-A",
    piSessionId: "pi-shared",
    title: "A",
    messages: [],
    status: "idle",
    error: "",
    input: "",
  };
  let sessionB: Session = {
    id: "tab-B",
    runtimeSessionId: "rt-B",
    piSessionId: "pi-shared",
    title: "B",
    messages: [],
    status: "idle",
    error: "",
    input: "",
  };
  const sessions = () => [sessionA, sessionB];

  const controller = createSessionRuntimeController({
    idleReconnectMs: 0,
    pollIntervalMs: 1_000_000,
    api: {
      // Only rt-A is actually running, serving pi-shared.
      listRuntimeSessions: async () => [
        { sessionId: "rt-A", status: { active: true, piSessionId: "pi-shared" } },
      ],
      loadRuntimeStatus: async () => null,
      subscribeRuntimeEvents: () => ({ close: () => undefined }),
    },
  });
  controller.bind({
    commit: (id, patch) => {
      if (id === "tab-A") sessionA = patch(sessionA);
      else if (id === "tab-B") sessionB = patch(sessionB);
    },
    getSession: (id) => sessions().find((s) => s.id === id),
    getSessions: sessions,
  });

  controller.pollNow();
  await new Promise((resolve) => setTimeout(resolve, 0));

  // pollNow arms a steady-poll interval; close in a finally so a failing
  // assertion can't leak a pending timer and hang the (force-exit-less) gate.
  try {
    assert.equal(
      sessionA.status,
      "running",
      "the session that owns rt-A is promoted via the direct match",
    );
    assert.equal(
      sessionB.status,
      "idle",
      "the colliding pi-id session must NOT be promoted by rt-A's entry",
    );
    assert.equal(
      sessionB.runtimeSessionId,
      "rt-B",
      "the colliding session must NOT be repointed to rt-A",
    );
  } finally {
    controller.closeAll();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
});
