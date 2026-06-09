// Characterization tests for the session event ordering path. These pin the
// CURRENT behavior of the cursor gate, replay-cursor hydration, the
// canonical/runtime event merge, the text-delta coalescer, batch replay, and
// the resume subscription lifecycle — so the session-runtime-controller
// consolidation can refactor against a fixed contract instead of live users.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  mergeCanonicalAndRuntimeEvents,
  replayCursorAfterRuntimeHydration,
} from "@/lib/agent/session/helpers";
import { replaySessionEvents } from "@/lib/agent/session/replay";
import type { RuntimeLoggedEvent } from "@/lib/agent/session";
import type {
  RuntimeEventPayload,
  RuntimeEventSubscription,
  RuntimeStatus,
} from "@/lib/agent/sessions/api";
import {
  acceptRuntimeSeq,
  adoptExternalCursor,
  commitRuntimeSeq,
  createRuntimeCursor,
  reconnectAfter,
} from "@/lib/agent/sessions/runtime-cursor";
import { createSessionRuntimeController } from "@/lib/agent/sessions/session-runtime-controller";
import { createTextDeltaCoalescer } from "@/lib/agent/sessions/text-delta-coalescer";
import type { Session, SessionId } from "@/lib/agent/sessions/types";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/session-event-log.json", import.meta.url), "utf8"),
) as {
  canonical: Record<string, unknown>[];
  runtimeTail: RuntimeLoggedEvent[];
};

// ----- cursor gate (runtime-cursor.ts) -----

test("cursor gate passes seq-less payloads through without advancing", () => {
  const cursor = createRuntimeCursor();
  assert.deepEqual(acceptRuntimeSeq(cursor, undefined), { accept: true, cursor });
  const at7 = createRuntimeCursor(7);
  assert.deepEqual(acceptRuntimeSeq(at7, undefined), { accept: true, cursor: at7 });
});

test("cursor gate rejects equal and stale seqs, accepts strictly newer", () => {
  const at5 = createRuntimeCursor(5);
  assert.deepEqual(acceptRuntimeSeq(at5, 5), { accept: false, cursor: at5 });
  assert.deepEqual(acceptRuntimeSeq(at5, 4), { accept: false, cursor: at5 });
  assert.equal(acceptRuntimeSeq(at5, 6).accept, true);
  assert.equal(acceptRuntimeSeq(at5, 6).cursor.receivedSeq, 6);
  // No persisted cursor behaves as 0.
  assert.equal(acceptRuntimeSeq(createRuntimeCursor(), 1).accept, true);
});

test("adopting an external cursor moves the in-memory gate backwards", () => {
  // Deliberately non-monotonic: a lastEventSeq reset (new prompt on the same
  // Pi session) or replay hydration must move the gate BACKWARDS, while
  // acceptRuntimeSeq alone is monotonic.
  const reset = adoptExternalCursor(0);
  assert.equal(acceptRuntimeSeq(reset, 1).accept, true);
  assert.deepEqual(adoptExternalCursor(undefined), {
    receivedSeq: undefined,
    committedSeq: undefined,
  });
  assert.equal(adoptExternalCursor(43).receivedSeq, 43);
});

test("committed cursor lags received and reconnect resumes from received", () => {
  const cursor = acceptRuntimeSeq(createRuntimeCursor(2), 5).cursor;
  assert.equal(cursor.receivedSeq, 5);
  assert.equal(cursor.committedSeq, 2);
  // Reconnect must use the highest RECEIVED seq: an unflushed coalesced delta
  // is still in memory, so replaying it would double-apply.
  assert.equal(reconnectAfter(cursor), 5);
  const committed = commitRuntimeSeq(cursor, 5);
  assert.equal(committed.committedSeq, 5);
  // Commit is monotonic.
  assert.equal(commitRuntimeSeq(committed, 3).committedSeq, 5);
  assert.equal(reconnectAfter(createRuntimeCursor()), 0);
});

// ----- replay cursor after navigation hydration (session/helpers.ts) -----

test("replay hydration reattaches from the runtime cursor only when the runtime is active", () => {
  assert.equal(replayCursorAfterRuntimeHydration(true, 42), 42);
  assert.equal(replayCursorAfterRuntimeHydration(true, undefined), undefined);
  assert.equal(replayCursorAfterRuntimeHydration(false, 42), undefined);
  assert.equal(replayCursorAfterRuntimeHydration(false, undefined), undefined);
});

// ----- canonical + runtime merge (session/helpers.ts) -----

function userEvent(text: string): Record<string, unknown> {
  return { type: "message", message: { role: "user", content: text } };
}

function assistantEvent(text: string): Record<string, unknown> {
  return {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}

test("merge cuts the canonical tail at the runtime's first user message", () => {
  const canonical = [
    userEvent("first question"),
    assistantEvent("first answer"),
    userEvent("second question"),
    assistantEvent("settled second answer"),
  ];
  const runtime: RuntimeLoggedEvent[] = [
    { seq: 1, event: userEvent("second question") },
    { seq: 2, event: assistantEvent("live second answer") },
  ];

  const merged = mergeCanonicalAndRuntimeEvents(canonical, runtime);
  // Canonical keeps only the first turn; the runtime owns the covered tail —
  // the settled copy of the second turn must NOT appear (duplicate-bubble bug).
  assert.deepEqual(merged, [
    userEvent("first question"),
    assistantEvent("first answer"),
    userEvent("second question"),
    assistantEvent("live second answer"),
  ]);
});

test("merge dedupes identical events and sorts the runtime log by seq", () => {
  const canonical = [userEvent("only question")];
  const runtime: RuntimeLoggedEvent[] = [
    { seq: 2, event: assistantEvent("answer") },
    { seq: 1, event: userEvent("only question") },
    { seq: 3, event: assistantEvent("answer") },
  ];

  const merged = mergeCanonicalAndRuntimeEvents(canonical, runtime);
  assert.deepEqual(merged, [userEvent("only question"), assistantEvent("answer")]);
});

test("merge without runtime events returns the canonical log untouched", () => {
  const canonical = [userEvent("q"), assistantEvent("a")];
  assert.deepEqual(mergeCanonicalAndRuntimeEvents(canonical), canonical);
});

// ----- batch replay over the golden event log (session/replay.ts) -----

test("golden event log replays to the expected transcript", () => {
  const { messages, title, startedAt, modelId } = replaySessionEvents(fixture.canonical);

  assert.equal(title, "Summarize the GPU fleet");
  assert.equal(startedAt, "2026-06-09T10:00:00.000Z");
  assert.equal(modelId, "deepseek-v4-flash");

  assert.deepEqual(
    messages.map((message) => message.role),
    ["user", "assistant", "assistant"],
  );
  assert.equal(messages[0]?.text, "Summarize the GPU fleet");

  const toolTurn = messages[1];
  assert.deepEqual(
    (toolTurn?.blocks ?? []).map((block) => block.kind),
    ["thinking", "tool"],
  );
  const toolBlock = toolTurn?.blocks?.find((block) => block.kind === "tool");
  assert.equal(toolBlock?.kind === "tool" && toolBlock.status, "done");
  assert.equal(
    toolBlock?.kind === "tool" && toolBlock.text,
    "4x RTX PRO 6000 Blackwell + 1x RTX 3090",
  );

  assert.equal(
    messages[2]?.text,
    "The fleet has four Blackwell cards and one RTX 3090.\n\n- Blackwells capped at 275W.\n- 3090 capped at 150W.",
  );
});

// ----- text delta coalescer (text-delta-coalescer.ts) -----

type FrameHarness = {
  callbacks: (() => void)[];
  cancelled: number;
  schedule: (callback: () => void) => { cancel: () => void };
  runAll: () => void;
};

function frameHarness(): FrameHarness {
  const harness: FrameHarness = {
    callbacks: [],
    cancelled: 0,
    schedule: (callback) => {
      harness.callbacks.push(callback);
      return { cancel: () => (harness.cancelled += 1) };
    },
    runAll: () => {
      const pending = harness.callbacks.splice(0);
      for (const callback of pending) callback();
    },
  };
  return harness;
}

function deltaEvent(type: string, delta: string): Record<string, unknown> {
  return { type: "message_update", assistantMessageEvent: { type, delta } };
}

function appliedDelta(event: Record<string, unknown>): unknown {
  return (event.assistantMessageEvent as Record<string, unknown> | undefined)?.delta;
}

test("coalescer concatenates same-kind deltas including standalone newlines", () => {
  const applied: Record<string, unknown>[] = [];
  const frames = frameHarness();
  const coalescer = createTextDeltaCoalescer({
    applyPiEvent: (_sessionId, _assistantId, event) => applied.push(event),
    scheduleFrame: frames.schedule,
  });

  coalescer.enqueuePiEvent("s-1", "a-1", deltaEvent("text_delta", "Row 1"));
  coalescer.enqueuePiEvent("s-1", "a-1", deltaEvent("text_delta", "\n"));
  coalescer.enqueuePiEvent("s-1", "a-1", deltaEvent("text_delta", "Row 2"));
  assert.equal(applied.length, 0);

  frames.runAll();
  // One merged event; dropping the standalone "\n" delta was the table/paragraph
  // whitespace bug (d9ede391).
  assert.equal(applied.length, 1);
  assert.equal(appliedDelta(applied[0]), "Row 1\nRow 2");
});

test("coalescer flushNow applies pending once and a stale frame is harmless", () => {
  const applied: Record<string, unknown>[] = [];
  const frames = frameHarness();
  const coalescer = createTextDeltaCoalescer({
    applyPiEvent: (_sessionId, _assistantId, event) => applied.push(event),
    scheduleFrame: frames.schedule,
  });

  coalescer.enqueuePiEvent("s-1", "a-1", deltaEvent("text_delta", "Hello"));
  coalescer.flushNow("s-1");
  assert.equal(applied.length, 1);
  assert.equal(frames.cancelled, 1);

  // A frame callback firing after the explicit flush must not double-apply.
  frames.runAll();
  assert.equal(applied.length, 1);
});

test("coalescer dispose drops pending deltas without applying them", () => {
  // Current behavior: dispose is cancellation-only. The hook compensates by
  // calling flushAll() first on unmount. Step 7 of the refactor intentionally
  // changes this to flush — this test documents the BEFORE state and must be
  // updated when that lands.
  const applied: Record<string, unknown>[] = [];
  const frames = frameHarness();
  const coalescer = createTextDeltaCoalescer({
    applyPiEvent: (_sessionId, _assistantId, event) => applied.push(event),
    scheduleFrame: frames.schedule,
  });

  coalescer.enqueuePiEvent("s-1", "a-1", deltaEvent("text_delta", "lost"));
  coalescer.dispose();
  frames.runAll();
  assert.equal(applied.length, 0);
  assert.equal(frames.cancelled, 1);
});

test("coalescer flushes pending work when the assistant id changes", () => {
  const applied: { assistantId: string; event: Record<string, unknown> }[] = [];
  const frames = frameHarness();
  const coalescer = createTextDeltaCoalescer({
    applyPiEvent: (_sessionId, assistantId, event) => applied.push({ assistantId, event }),
    scheduleFrame: frames.schedule,
  });

  coalescer.enqueuePiEvent("s-1", "a-1", deltaEvent("text_delta", "first"));
  coalescer.enqueuePiEvent("s-1", "a-2", deltaEvent("text_delta", "second"));

  assert.equal(applied.length, 1);
  assert.equal(applied[0]?.assistantId, "a-1");
  assert.equal(appliedDelta(applied[0].event), "first");

  frames.runAll();
  assert.equal(applied.length, 2);
  assert.equal(applied[1]?.assistantId, "a-2");
});

// ----- live attachment lifecycle (session-runtime-controller.ts) -----

type ControllerHarness = {
  session: () => Session;
  subscribeCalls: { after: number; piSessionId: string | null | undefined }[];
  order: string[];
  frames: FrameHarness;
  emit: (payload: RuntimeEventPayload) => void;
  fail: () => void;
  close: () => void;
};

function createControllerHarness(
  options: {
    lastEventSeq?: number;
    status?: RuntimeStatus | null;
  } = {},
): ControllerHarness {
  let session: Session = {
    id: "s-1",
    runtimeSessionId: "rt-1",
    piSessionId: "pi-1",
    title: "New session",
    messages: [],
    status: "running",
    error: "",
    input: "",
    lastEventSeq: options.lastEventSeq,
  };
  const subscribeCalls: ControllerHarness["subscribeCalls"] = [];
  const handlers: { onPayload: (payload: RuntimeEventPayload) => void; onError: () => void }[] = [];
  const order: string[] = [];
  const frames = frameHarness();

  const controller = createSessionRuntimeController({
    api: {
      loadRuntimeStatus: async () => options.status ?? null,
      subscribeRuntimeEvents: (_runtime, after, piSessionId, eventHandlers) => {
        subscribeCalls.push({ after, piSessionId });
        handlers.push(eventHandlers);
        return { close: () => order.push("transport-close") };
      },
    },
    scheduleFrame: frames.schedule,
  });
  controller.bind({
    commit: (sessionId, patch) => {
      if (sessionId !== session.id) return;
      const prev = session;
      session = patch(session);
      if (session === prev) return;
      if (prev.status !== "idle" && session.status === "idle") order.push("idle-patch");
      const joinedBlocks = (entry: Session) =>
        (entry.messages.at(-1)?.blocks ?? []).map((block) => block.text).join("");
      if (joinedBlocks(session) !== joinedBlocks(prev)) order.push(`blocks:${joinedBlocks(session)}`);
    },
    getSession: (sessionId) => (sessionId === session.id ? session : undefined),
  });
  controller.mirrorCursors([session]);
  controller.reconcile([session]);

  return {
    session: () => session,
    subscribeCalls,
    order,
    frames,
    emit: (payload) => handlers.at(-1)?.onPayload(payload),
    fail: () => handlers.at(-1)?.onError(),
    close: () => {
      controller.closeAll();
      controller.unbind();
    },
  };
}

function partialDeltaEvent(delta: string, full: string): Record<string, unknown> {
  return {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_delta",
      delta,
      contentIndex: 0,
      partial: { role: "assistant", content: [{ type: "text", text: full }] },
    },
  };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("controller reconnects from the highest received seq, not the configured start", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const harness = createControllerHarness({ status: { active: true } });

  harness.emit({ type: "pi", seq: 5, event: partialDeltaEvent("a", "a") });
  harness.emit({ type: "pi", seq: 3, event: partialDeltaEvent("b", "b") });
  harness.fail();
  await settle();
  t.mock.timers.tick(1_000);

  assert.deepEqual(
    harness.subscribeCalls.map((call) => call.after),
    [0, 5],
  );
  harness.close();
});

test("controller applies agent_end immediately and settles the session idle", () => {
  const harness = createControllerHarness();

  harness.emit({ type: "pi", seq: 1, event: { type: "agent_end" } });

  assert.equal(harness.session().status, "idle");
  assert.equal(harness.session().activeAssistantId, undefined);
  // The controller ensured an assistant bubble before applying the event.
  assert.equal(harness.session().messages.at(-1)?.role, "assistant");
  assert.equal(harness.session().lastEventSeq, 1);
  harness.close();
});

test("controller drops payloads the seq gate rejects without touching state", () => {
  const harness = createControllerHarness({ lastEventSeq: 5 });
  const before = harness.session();

  harness.emit({ type: "pi", seq: 3, event: { type: "agent_end" } });

  assert.equal(harness.session(), before);
  // The attachment also resumed from the persisted cursor.
  assert.deepEqual(
    harness.subscribeCalls.map((call) => call.after),
    [5],
  );
  harness.close();
});

test("closing attachments flushes pending coalesced deltas before the transport", () => {
  const harness = createControllerHarness();

  harness.emit({ type: "pi", seq: 1, event: partialDeltaEvent("abc", "abc") });
  assert.equal(harness.order.includes("blocks:abc"), false);

  harness.close();

  const flushedAt = harness.order.indexOf("blocks:abc");
  const closedAt = harness.order.indexOf("transport-close");
  assert.notEqual(flushedAt, -1);
  assert.notEqual(closedAt, -1);
  assert.ok(flushedAt < closedAt, `flush must precede transport close: ${harness.order.join(",")}`);
});

test("inconclusive liveness probe reconnects and never idles the session", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const harness = createControllerHarness({ status: null });

  harness.fail();
  await settle();
  assert.equal(harness.session().status, "running");
  assert.equal(harness.order.includes("idle-patch"), false);

  t.mock.timers.tick(1_000);
  assert.equal(harness.subscribeCalls.length, 2);
  harness.close();
});

test("definitively inactive runtime closes, flushes pending text, then idles", async () => {
  const harness = createControllerHarness({ status: { active: false } });

  harness.emit({ type: "pi", seq: 1, event: partialDeltaEvent("tail", "tail") });
  harness.fail();
  await settle();

  const closedAt = harness.order.indexOf("transport-close");
  const flushedAt = harness.order.indexOf("blocks:tail");
  const idledAt = harness.order.indexOf("idle-patch");
  assert.ok(closedAt !== -1 && flushedAt !== -1 && idledAt !== -1, harness.order.join(","));
  assert.ok(closedAt < flushedAt && flushedAt < idledAt, harness.order.join(","));
  assert.equal(harness.session().status, "idle");
  harness.close();
});

test("done status payloads settle the session idle and keep the pi session id", () => {
  const harness = createControllerHarness();

  harness.emit({
    type: "status",
    phase: "done",
    session: { piSessionId: "pi-from-status" },
  });

  assert.equal(harness.session().status, "idle");
  assert.equal(harness.session().piSessionId, "pi-from-status");
  assert.equal(harness.session().activeAssistantId, undefined);
  harness.close();
});
