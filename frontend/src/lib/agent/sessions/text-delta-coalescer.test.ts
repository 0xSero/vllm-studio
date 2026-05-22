import { describe, expect, it } from "vitest";
import { createTextDeltaCoalescer, textDeltaFromPiEvent } from "./text-delta-coalescer";

type AppliedEvent = {
  assistantId: string;
  delta: string;
  sessionId: string;
  type: unknown;
};

function deltaEvent(type: "text_delta" | "thinking_delta", delta: string) {
  return {
    type: "message_update",
    assistantMessageEvent: { type, delta },
  };
}

function frameHarness() {
  let nextId = 0;
  const cancelled = new Set<number>();
  const frames: Array<{ callback: () => void; id: number }> = [];
  return {
    frames,
    scheduleFrame: (callback: () => void) => {
      const id = nextId;
      nextId += 1;
      frames.push({ callback, id });
      return { cancel: () => cancelled.add(id) };
    },
    runNextFrame: () => {
      const frame = frames.shift();
      if (frame && !cancelled.has(frame.id)) frame.callback();
    },
    runAllFrames: () => {
      while (frames.length) {
        const frame = frames.shift();
        if (frame && !cancelled.has(frame.id)) frame.callback();
      }
    },
  };
}

function coalescerHarness() {
  const applied: AppliedEvent[] = [];
  const frames = frameHarness();
  const coalescer = createTextDeltaCoalescer({
    scheduleFrame: frames.scheduleFrame,
    applyPiEvent: (sessionId, assistantId, event) => {
      const assistantMessageEvent = event.assistantMessageEvent as
        | { delta?: unknown; type?: unknown }
        | undefined;
      applied.push({
        sessionId,
        assistantId,
        type: assistantMessageEvent?.type,
        delta: typeof assistantMessageEvent?.delta === "string" ? assistantMessageEvent.delta : "",
      });
    },
  });
  return { applied, coalescer, frames };
}

describe("textDeltaFromPiEvent", () => {
  it("recognizes only non-empty assistant text and thinking deltas", () => {
    expect(textDeltaFromPiEvent(deltaEvent("text_delta", "hi"))).toEqual({
      kind: "text",
      delta: "hi",
    });
    expect(textDeltaFromPiEvent(deltaEvent("thinking_delta", "hmm"))).toEqual({
      kind: "thinking",
      delta: "hmm",
    });
    expect(textDeltaFromPiEvent(deltaEvent("text_delta", ""))).toBeNull();
    expect(textDeltaFromPiEvent({ type: "queue_update" })).toBeNull();
    expect(
      textDeltaFromPiEvent({
        type: "message_update",
        assistantMessageEvent: { type: "toolcall_delta", delta: "args" },
      }),
    ).toBeNull();
  });
});

describe("createTextDeltaCoalescer", () => {
  it("buffers text deltas until the scheduled frame and flushes one concatenated event", () => {
    const { applied, coalescer, frames } = coalescerHarness();

    expect(coalescer.enqueuePiEvent("s1", "a1", deltaEvent("text_delta", "Hel"))).toBe(true);
    expect(coalescer.enqueuePiEvent("s1", "a1", deltaEvent("text_delta", "lo"))).toBe(true);

    expect(applied).toEqual([]);
    expect(frames.frames).toHaveLength(1);

    frames.runNextFrame();

    expect(applied).toEqual([
      { sessionId: "s1", assistantId: "a1", type: "text_delta", delta: "Hello" },
    ]);
  });

  it("keeps first-seen FIFO ordering between text and thinking buckets", () => {
    const { applied, coalescer, frames } = coalescerHarness();

    coalescer.enqueuePiEvent("s1", "a1", deltaEvent("thinking_delta", "plan "));
    coalescer.enqueuePiEvent("s1", "a1", deltaEvent("text_delta", "answer"));
    coalescer.enqueuePiEvent("s1", "a1", deltaEvent("thinking_delta", "more"));

    frames.runNextFrame();

    expect(applied).toEqual([
      { sessionId: "s1", assistantId: "a1", type: "thinking_delta", delta: "plan more" },
      { sessionId: "s1", assistantId: "a1", type: "text_delta", delta: "answer" },
    ]);
  });

  it("flushNow synchronously drains pending deltas and cancels the scheduled frame", () => {
    const { applied, coalescer, frames } = coalescerHarness();

    coalescer.enqueuePiEvent("s1", "a1", deltaEvent("text_delta", "now"));
    coalescer.flushNow("s1");

    expect(applied).toEqual([
      { sessionId: "s1", assistantId: "a1", type: "text_delta", delta: "now" },
    ]);

    frames.runAllFrames();
    expect(applied).toHaveLength(1);
  });

  it("flushes an existing session boundary before buffering a different assistant id", () => {
    const { applied, coalescer, frames } = coalescerHarness();

    coalescer.enqueuePiEvent("s1", "a1", deltaEvent("text_delta", "old"));
    coalescer.enqueuePiEvent("s1", "a2", deltaEvent("text_delta", "new"));

    expect(applied).toEqual([
      { sessionId: "s1", assistantId: "a1", type: "text_delta", delta: "old" },
    ]);

    frames.runAllFrames();
    expect(applied).toEqual([
      { sessionId: "s1", assistantId: "a1", type: "text_delta", delta: "old" },
      { sessionId: "s1", assistantId: "a2", type: "text_delta", delta: "new" },
    ]);
  });

  it("keeps mixed sessions isolated with one scheduled frame per session", () => {
    const { applied, coalescer, frames } = coalescerHarness();

    coalescer.enqueuePiEvent("s1", "a1", deltaEvent("text_delta", "one"));
    coalescer.enqueuePiEvent("s2", "a2", deltaEvent("text_delta", "two"));
    coalescer.enqueuePiEvent("s1", "a1", deltaEvent("text_delta", "!"));

    expect(frames.frames).toHaveLength(2);

    frames.runAllFrames();

    expect(applied).toEqual([
      { sessionId: "s1", assistantId: "a1", type: "text_delta", delta: "one!" },
      { sessionId: "s2", assistantId: "a2", type: "text_delta", delta: "two" },
    ]);
  });
});
