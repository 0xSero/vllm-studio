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
import { subscribeResumeRuntimeSession } from "@/lib/agent/sessions/runtime-resume";
import {
  mirrorSessionLastEventSeq,
  shouldApplyRuntimeSeq,
} from "@/lib/agent/sessions/runtime-subscription-state";
import { createTextDeltaCoalescer } from "@/lib/agent/sessions/text-delta-coalescer";
import type { Session, SessionId } from "@/lib/agent/sessions/types";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/session-event-log.json", import.meta.url), "utf8"),
) as {
  canonical: Record<string, unknown>[];
  runtimeTail: RuntimeLoggedEvent[];
};

// ----- cursor gate (runtime-subscription-state.ts) -----

test("cursor gate passes seq-less payloads through without advancing", () => {
  assert.deepEqual(shouldApplyRuntimeSeq(undefined, undefined), {
    apply: true,
    next: undefined,
  });
  assert.deepEqual(shouldApplyRuntimeSeq(7, undefined), { apply: true, next: 7 });
});

test("cursor gate rejects equal and stale seqs, accepts strictly newer", () => {
  assert.deepEqual(shouldApplyRuntimeSeq(5, 5), { apply: false, next: 5 });
  assert.deepEqual(shouldApplyRuntimeSeq(5, 4), { apply: false, next: 5 });
  assert.deepEqual(shouldApplyRuntimeSeq(5, 6), { apply: true, next: 6 });
  // No persisted cursor behaves as 0.
  assert.deepEqual(shouldApplyRuntimeSeq(undefined, 1), { apply: true, next: 1 });
});

test("cursor mirror moves the in-memory gate backwards unconditionally", () => {
  // The mirror is deliberately an identity on the session value: it is the only
  // channel by which a lastEventSeq reset (new prompt) or replay hydration can
  // move the gate BACKWARDS. shouldApplyRuntimeSeq alone is monotonic.
  assert.equal(mirrorSessionLastEventSeq(43, 0), 0);
  assert.equal(mirrorSessionLastEventSeq(43, undefined), undefined);
  assert.equal(mirrorSessionLastEventSeq(undefined, 43), 43);
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

// ----- resume subscription lifecycle (runtime-resume.ts) -----

type ResumeHarness = {
  session: Session;
  subscribeCalls: { after: number; piSessionId: string | null | undefined }[];
  handlers: { onPayload: (payload: RuntimeEventPayload) => void; onError: () => void }[];
  applied: { assistantId: string; event: Record<string, unknown>; flushNow: boolean }[];
  order: string[];
  sub: RuntimeEventSubscription;
  emit: (payload: RuntimeEventPayload) => void;
  fail: () => void;
};

function createResumeHarness(options: {
  after?: number;
  status?: RuntimeStatus | null;
  shouldApplySeq?: (sessionId: SessionId, seq?: number) => boolean;
} = {}): ResumeHarness {
  const harness = {} as ResumeHarness;
  harness.session = {
    id: "s-1",
    runtimeSessionId: "rt-1",
    piSessionId: "pi-1",
    title: "New session",
    messages: [],
    status: "running",
    error: "",
    input: "",
  };
  harness.subscribeCalls = [];
  harness.handlers = [];
  harness.applied = [];
  harness.order = [];

  harness.sub = subscribeResumeRuntimeSession({
    after: options.after ?? 0,
    api: {
      loadRuntimeStatus: async () => options.status ?? null,
      subscribeRuntimeEvents: (_runtime, after, piSessionId, handlers) => {
        harness.subscribeCalls.push({ after, piSessionId });
        harness.handlers.push(handlers);
        return { close: () => harness.order.push("transport-close") };
      },
    },
    applyPiEvent: (_sessionId, assistantId, event, applyOptions = {}) => {
      harness.order.push("apply");
      harness.applied.push({ assistantId, event, flushNow: applyOptions.flushNow === true });
    },
    flushPiEvents: () => harness.order.push("flush"),
    runtime: "rt-1",
    piSessionId: "pi-1",
    sessionId: "s-1",
    shouldApplySeq: options.shouldApplySeq,
    submitPromptRef: { current: async () => undefined },
    tabsRef: {
      get current() {
        return [harness.session];
      },
    },
    updateSession: (_sessionId, patch) => {
      harness.session = patch(harness.session);
      if (harness.session.status === "idle") harness.order.push("idle-patch");
    },
  });

  harness.emit = (payload) => harness.handlers.at(-1)?.onPayload(payload);
  harness.fail = () => harness.handlers.at(-1)?.onError();
  return harness;
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("resume reconnects from the highest received seq, not the configured start", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const harness = createResumeHarness({ after: 0, status: { active: true } });

  harness.emit({ type: "pi", seq: 5, event: { type: "message_update" } });
  harness.emit({ type: "pi", seq: 3, event: { type: "message_update" } });
  harness.fail();
  await settle();
  t.mock.timers.tick(1_000);

  assert.deepEqual(
    harness.subscribeCalls.map((call) => call.after),
    [0, 5],
  );
  harness.sub.close();
});

test("resume applies agent_end with flushNow and settles the session idle", () => {
  const harness = createResumeHarness();

  harness.emit({ type: "pi", seq: 1, event: { type: "agent_end" } });

  assert.equal(harness.applied.length, 1);
  assert.equal(harness.applied[0]?.event.type, "agent_end");
  assert.equal(harness.applied[0]?.flushNow, true);
  assert.equal(harness.session.status, "idle");
  assert.equal(harness.session.activeAssistantId, undefined);
  // ensureAssistantId appended a placeholder assistant message before applying.
  assert.equal(harness.session.messages.at(-1)?.role, "assistant");
  harness.sub.close();
});

test("resume drops payloads the seq gate rejects without touching state", () => {
  const harness = createResumeHarness({ shouldApplySeq: () => false });
  const before = harness.session;

  harness.emit({ type: "pi", seq: 1, event: { type: "agent_end" } });

  assert.equal(harness.applied.length, 0);
  assert.equal(harness.session, before);
  harness.sub.close();
});

test("resume close() flushes pending pi events before closing the transport", () => {
  const harness = createResumeHarness();

  harness.sub.close();

  assert.deepEqual(harness.order, ["flush", "transport-close"]);
});

test("inconclusive liveness probe reconnects and never idles the session", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const harness = createResumeHarness({ status: null });

  harness.fail();
  await settle();
  assert.equal(harness.session.status, "running");
  assert.equal(harness.order.includes("idle-patch"), false);

  t.mock.timers.tick(1_000);
  assert.equal(harness.subscribeCalls.length, 2);
  harness.sub.close();
});

test("definitively inactive runtime closes, flushes, then idles — in that order", async () => {
  const harness = createResumeHarness({ status: { active: false } });

  harness.fail();
  await settle();

  assert.deepEqual(harness.order, ["transport-close", "flush", "idle-patch"]);
  assert.equal(harness.session.status, "idle");
  harness.sub.close();
});

test("done status payloads settle the session idle and keep the pi session id", () => {
  const harness = createResumeHarness();

  harness.emit({
    type: "status",
    phase: "done",
    session: { piSessionId: "pi-from-status" },
  });

  assert.equal(harness.session.status, "idle");
  assert.equal(harness.session.piSessionId, "pi-from-status");
  assert.equal(harness.session.activeAssistantId, undefined);
  harness.sub.close();
});
