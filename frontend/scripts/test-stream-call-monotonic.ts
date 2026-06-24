import assert from "node:assert/strict";
import test from "node:test";

import {
  reduceSessionEvent,
  type SessionStreamContext,
} from "../src/features/agent/runtime/pi-event-applier";
import type { Session } from "../src/features/agent/runtime/types";

// Regression for reliability finding [13]: a message_update whose chosen content
// snapshot momentarily LAGS the previous frame (assistantSnapshotContent flips
// between message.content and assistantMessageEvent.partial.content, which don't
// advance in lockstep) must NOT shrink the rendered bubble — the visible
// flicker/jump. The streamCalls slot is monotonic for message_update: it keeps
// whichever snapshot has the larger payload.
test("a lagging message_update snapshot does not shrink the streamed bubble (no flicker)", () => {
  const ctx: SessionStreamContext = { liveAssistantIds: new Map() };
  let session: Session = {
    id: "s-1",
    runtimeSessionId: "rt-1",
    piSessionId: "pi-1",
    title: "t",
    messages: [
      { id: "u1", role: "user", text: "hi", timestamp: "" },
      { id: "a1", role: "assistant", text: "", blocks: [], timestamp: "" },
    ],
    status: "running",
    error: "",
    input: "",
    activeAssistantId: "a1",
  };
  const ev = (event: Record<string, unknown>) => {
    session = reduceSessionEvent(session, ctx, "a1", event);
  };
  const text = () => session.messages.find((m) => m.id === "a1")?.text ?? "";

  ev({ type: "message_start", message: { role: "assistant", content: [] } });
  // Frame 1: the full accumulated text for the call.
  ev({
    type: "message_update",
    message: { role: "assistant", content: [{ type: "text", text: "first second third" }] },
  });
  assert.ok(text().includes("first second third"), "frame 1 rendered the full text");

  // Frame 2: a lagging/shorter snapshot arrives. The bubble must not regress.
  ev({
    type: "message_update",
    message: { role: "assistant", content: [{ type: "text", text: "first" }] },
  });
  assert.ok(
    text().includes("first second third"),
    `bubble shrank on a lagging update (flicker): got "${text()}"`,
  );

  // A genuinely longer next frame still advances normally.
  ev({
    type: "message_update",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "first second third fourth fifth" }],
    },
  });
  assert.ok(text().includes("fourth fifth"), "a longer frame advances the bubble");
});

// message_end carries the call's settled content and is authoritative — it must
// be applied even though it is not strictly larger (e.g. trailing whitespace
// trimmed), so the final settled text is what renders.
test("message_end applies the settled content even if marginally shorter", () => {
  const ctx: SessionStreamContext = { liveAssistantIds: new Map() };
  let session: Session = {
    id: "s-1",
    runtimeSessionId: "rt-1",
    piSessionId: "pi-1",
    title: "t",
    messages: [
      { id: "u1", role: "user", text: "hi", timestamp: "" },
      { id: "a1", role: "assistant", text: "", blocks: [], timestamp: "" },
    ],
    status: "running",
    error: "",
    input: "",
    activeAssistantId: "a1",
  };
  const ev = (event: Record<string, unknown>) => {
    session = reduceSessionEvent(session, ctx, "a1", event);
  };
  ev({ type: "message_start", message: { role: "assistant", content: [] } });
  ev({
    type: "message_update",
    message: { role: "assistant", content: [{ type: "text", text: "answer   " }] },
  });
  ev({
    type: "message_end",
    message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "answer" }] },
  });
  const text = session.messages.find((m) => m.id === "a1")?.text ?? "";
  assert.ok(text.includes("answer"), "settled final content rendered");
});
