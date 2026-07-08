import assert from "node:assert/strict";
import test from "node:test";

import { createSessionReplayQueue } from "../src/features/agent/workspace/replay-queue";
import type { Session, SessionId } from "../src/features/agent/runtime/types";
import type { PaneId, PaneState } from "../src/features/agent/workspace/types";

type Replay = { handleSessionId: string; piSessionId: string };

function makeSession(id: SessionId, patch: Partial<Session> = {}): Session {
  return {
    id,
    piSessionId: null,
    title: "t",
    messages: [],
    status: "running",
    error: "",
    input: "",
    ...patch,
  };
}

function harness() {
  const timers: Array<() => void> = [];
  const handles = new Map<
    PaneId,
    { sessionId: string; loadAndReplay: (piSessionId: string) => void }
  >();
  const panesById = new Map<PaneId, PaneState>();
  const sessions = new Map<SessionId, Session>();
  const replays: Replay[] = [];

  const queue = createSessionReplayQueue({
    getHandle: (paneId) => handles.get(paneId),
    getState: () => ({ panesById, sessions }),
    setTimeout: (handler) => {
      timers.push(handler);
    },
  });

  const flush = () => {
    while (timers.length > 0) {
      const run = timers.shift();
      if (run) run();
    }
  };

  const setHandle = (paneId: PaneId, sessionId: string) => {
    handles.set(paneId, {
      sessionId,
      loadAndReplay: (piSessionId) => {
        replays.push({ handleSessionId: sessionId, piSessionId });
      },
    });
  };

  const setPaneSession = (paneId: PaneId, session: Session) => {
    panesById.set(paneId, { kind: "chat", sessionId: session.id });
    sessions.set(session.id, session);
  };

  return { queue, replays, flush, setHandle, setPaneSession };
}

test("holds the pending replay while the pane still shows the stale handle, then replays once the matching handle registers", () => {
  const h = harness();
  h.setPaneSession("p1", makeSession("new", { piSessionId: "pi-a" }));
  h.setHandle("p1", "old");

  h.queue.queue("p1", "pi-a");
  h.flush();
  assert.equal(h.replays.length, 0);

  h.setHandle("p1", "new");
  h.queue.notifyHandleRegistered("p1");
  h.flush();

  assert.equal(h.replays.length, 1);
  assert.deepEqual(h.replays[0], { handleSessionId: "new", piSessionId: "pi-a" });
});

test("drops the pending replay when the pane's session carries a different piSessionId", () => {
  const h = harness();
  h.setPaneSession("p1", makeSession("t", { piSessionId: "other" }));
  h.setHandle("p1", "t");

  h.queue.queue("p1", "pi-a");
  h.flush();
  assert.equal(h.replays.length, 0);

  h.queue.notifyHandleRegistered("p1");
  h.flush();
  assert.equal(h.replays.length, 0);
});

test("drops the pending replay when the pane's session is a fresh empty starter", () => {
  const h = harness();
  h.setPaneSession("p1", makeSession("t", { piSessionId: null, messages: [], status: "idle" }));
  h.setHandle("p1", "t");

  h.queue.queue("p1", "pi-a");
  h.flush();
  assert.equal(h.replays.length, 0);

  h.queue.notifyHandleRegistered("p1");
  h.flush();
  assert.equal(h.replays.length, 0);
});

test("keeps the pending replay when no handle exists yet, then replays after the matching handle registers", () => {
  const h = harness();
  h.setPaneSession("p1", makeSession("t", { piSessionId: "pi-a" }));

  h.queue.queue("p1", "pi-a");
  h.flush();
  assert.equal(h.replays.length, 0);

  h.setHandle("p1", "t");
  h.queue.notifyHandleRegistered("p1");
  h.flush();

  assert.equal(h.replays.length, 1);
  assert.deepEqual(h.replays[0], { handleSessionId: "t", piSessionId: "pi-a" });
});

test("replays only the last-queued piSessionId per pane", () => {
  const h = harness();
  h.setPaneSession("p1", makeSession("t", { piSessionId: null, status: "running" }));
  h.setHandle("p1", "t");

  h.queue.queue("p1", "pi-a");
  h.queue.queue("p1", "pi-b");
  h.flush();

  assert.equal(h.replays.length, 1);
  assert.equal(h.replays[0]?.piSessionId, "pi-b");
});
