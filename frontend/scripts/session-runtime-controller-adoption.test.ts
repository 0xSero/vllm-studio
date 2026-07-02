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

type OpenedSubscription = {
  runtime: string;
  after: number;
  send: (payload: RuntimeEventPayload) => void;
  closed: boolean;
};

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "tab-1",
    piSessionId: "pi-1",
    title: "Adoption test",
    messages: [
      { id: "user-1", role: "user", text: "hello" },
      { id: "assistant-1", role: "assistant", text: "", blocks: [] },
    ],
    status: "running",
    error: "",
    input: "",
    activeAssistantId: "assistant-1",
    ...overrides,
  };
}

function createAdoptionHarness(initial: Session) {
  let liveSession = initial;
  const opened: OpenedSubscription[] = [];
  const pendingFetches: ((entries: RuntimeSessionSummary[]) => void)[] = [];

  const controller = createSessionRuntimeController({
    idleReconnectMs: 0,
    pollIntervalMs: 1_000_000,
    api: {
      listRuntimeSessions: () =>
        new Promise<RuntimeSessionSummary[]>((resolve) => {
          pendingFetches.push(resolve);
        }),
      loadRuntimeStatus: async () => null,
      subscribeRuntimeEvents: (runtime, after, _piSessionId, handlers): RuntimeEventSubscription => {
        const entry: OpenedSubscription = {
          runtime,
          after,
          send: handlers.onPayload,
          closed: false,
        };
        opened.push(entry);
        return {
          close: () => {
            entry.closed = true;
          },
        };
      },
    },
  });

  const binding: SessionRuntimeBinding = {
    commit: (sessionId, patch) => {
      if (sessionId === liveSession.id) liveSession = patch(liveSession);
    },
    getSession: (sessionId) => (sessionId === liveSession.id ? liveSession : undefined),
    getSessions: () => [liveSession],
  };
  controller.bind(binding);

  return {
    controller,
    opened,
    session: () => liveSession,
    setSession: (next: Session) => {
      liveSession = next;
    },
    resolveFetch: async (index: number, entries: RuntimeSessionSummary[]) => {
      pendingFetches[index]?.(entries);
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

// Server restart mid-session: the poll's pi match finds the session's runtime
// under a NEW server key. Adoption is a controller-internal connection-key
// override — session state is untouched, the cursor resets, the SSE reopens on
// the new key from seq 0, and events keep flowing into the transcript.
test("restart adoption reopens the SSE under the override key with a reset cursor", async () => {
  const harness = createAdoptionHarness(makeSession());

  try {
    harness.controller.reconcile([harness.session()]);
    assert.equal(harness.opened.length, 1, "one attachment on first reconcile");
    assert.equal(harness.opened[0].runtime, "tab-1", "first attach uses the session id as key");

    // Stream a few events so the live cursor climbs.
    for (let seq = 1; seq <= 5; seq += 1) {
      harness.opened[0].send({
        type: "pi",
        seq,
        event: {
          type: "message_update",
          message: { role: "assistant", content: [{ type: "text", text: `chunk ${seq}` }] },
        },
      });
    }
    harness.controller.flush("tab-1");
    assert.equal(harness.session().lastEventSeq, 5, "cursor committed before the restart");

    // The server restarts; the runtime now lives under "srv-2" (same pi id).
    harness.controller.pollNow();
    await harness.resolveFetch(0, [
      { sessionId: "srv-2", status: { active: true, piSessionId: "pi-1" } },
    ]);

    assert.equal(harness.controller.connectionKey("tab-1"), "srv-2", "override recorded");
    assert.equal(harness.opened[0].closed, true, "stale attachment closed");
    assert.equal(harness.opened.length, 2, "attachment reopened by the controller itself");
    assert.equal(harness.opened[1].runtime, "srv-2", "reopened under the adopted server key");
    assert.equal(
      harness.opened[1].after,
      0,
      "cursor reset on adoption — the fresh runtime's seq restarts from 0",
    );

    // Events from the adopted runtime keep flowing into the same session.
    harness.opened[1].send({
      type: "pi",
      seq: 1,
      event: {
        type: "message_update",
        message: { role: "assistant", content: [{ type: "text", text: "after restart" }] },
      },
    });
    harness.controller.flush("tab-1");
    const assistant = harness.session().messages.find((m) => m.id === "assistant-1");
    assert.ok(
      assistant?.blocks?.some((b) => b.kind === "text" && b.text.includes("after restart")),
      "post-adoption events land in the transcript",
    );
    assert.equal(harness.session().lastEventSeq, 1, "cursor tracks the new runtime's seq");
  } finally {
    harness.controller.closeAll();
    harness.controller.unbind();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
});

// Upgrade path: a session persisted as RUNNING under a legacy pre-alias rt-*
// key is reattached via the one-shot connection-key seed read from old
// localStorage state; the SSE opens on the legacy key from the persisted
// cursor.
test("legacy rt-* seed reattaches a restored running session to its old runtime key", async () => {
  const harness = createAdoptionHarness(makeSession({ lastEventSeq: 7 }));

  try {
    harness.controller.seedConnectionKey("tab-1", "rt-legacy");
    harness.controller.reconcile([harness.session()]);

    assert.equal(harness.opened.length, 1);
    assert.equal(harness.opened[0].runtime, "rt-legacy", "attached under the legacy runtime key");
    assert.equal(harness.opened[0].after, 7, "resumes from the persisted cursor");
    assert.equal(harness.controller.connectionKey("tab-1"), "rt-legacy");

    // A seed never clobbers itself or downgrades an existing override.
    harness.controller.seedConnectionKey("tab-1", "rt-other");
    assert.equal(harness.controller.connectionKey("tab-1"), "rt-legacy");
  } finally {
    harness.controller.closeAll();
    harness.controller.unbind();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
});

// Crosstalk guard: a piSessionId shared by two sessions must not let one
// runtime entry set a connection-key override on the session that does NOT own
// the runtime (the pi reverse-index is ambiguous there).
test("shared piSessionId never records an override for the non-owning session", async () => {
  let sessionA = makeSession({
    id: "tab-A",
    piSessionId: "pi-shared",
    status: "idle",
  });
  let sessionB = makeSession({
    id: "tab-B",
    piSessionId: "pi-shared",
    status: "idle",
  });
  const sessions = () => [sessionA, sessionB];

  const controller = createSessionRuntimeController({
    idleReconnectMs: 0,
    pollIntervalMs: 1_000_000,
    api: {
      listRuntimeSessions: async () => [
        { sessionId: "tab-A", status: { active: true, piSessionId: "pi-shared" } },
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

  try {
    assert.equal(sessionA.status, "running", "owner promoted via the direct match");
    assert.equal(sessionB.status, "idle", "the colliding session is untouched");
    assert.equal(
      controller.connectionKey("tab-B"),
      "tab-B",
      "no override crosstalk onto the colliding session",
    );
    assert.equal(controller.connectionKey("tab-A"), "tab-A", "direct match needs no override");
  } finally {
    controller.closeAll();
    controller.unbind();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
});
