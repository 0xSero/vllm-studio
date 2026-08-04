import assert from "node:assert/strict";
import { test } from "node:test";
import { reduceSessionEvent, type SessionStreamContext } from "./pi-event-applier";
import type { Session } from "./types";

const session = (): Session => ({
  id: "session-1",
  piSessionId: null,
  title: "",
  messages: [],
  status: "running",
  error: "",
  input: "",
});

const context = (): SessionStreamContext => ({ liveAssistantIds: new Map() });

test("extension UI requests become bounded browser dialogs", () => {
  const next = reduceSessionEvent(session(), context(), {
    type: "extension_ui_request",
    requestId: "request-1",
    method: "confirm",
    title: "Approve action",
    message: "Continue?",
  });
  assert.deepEqual(next.extensionUiRequest, {
    requestId: "request-1",
    method: "confirm",
    title: "Approve action",
    message: "Continue?",
  });
});

test("malformed extension UI requests are ignored", () => {
  const current = session();
  const next = reduceSessionEvent(current, context(), {
    type: "extension_ui_request",
    requestId: "request-1",
    method: "custom",
    title: "Unsupported",
  });
  assert.equal(next, current);
});

// --- steer echo dedupe -------------------------------------------------------

const steerBubble = (id: string, text: string) => ({
  id,
  role: "user" as const,
  text,
  pending: true,
  awaitingEcho: true,
});

const userEcho = (text: string) => ({
  type: "message_end",
  message: { role: "user", content: [{ type: "text", text }] },
});

const userCount = (messages: { role: string; text: string }[], text: string) =>
  messages.filter((message) => message.role === "user" && message.text === text).length;

test("a steer echo matches its optimistic bubble instead of duplicating it", () => {
  const current: Session = { ...session(), messages: [steerBubble("user_a", "check this")] };
  const next = reduceSessionEvent(current, context(), userEcho("check this"));
  assert.equal(userCount(next.messages, "check this"), 1);
  assert.equal(next.messages[0].pending, false);
  assert.equal(next.messages[0].awaitingEcho, false);
});

// The regression: agent_end fires once per low-level run — several times per
// prompt under auto-retry or compaction — and used to clear the flag the echo
// matcher keyed on. With two steers in flight both echoes then missed, and each
// message was appended a second time.
test("steer echoes still match after agent_end has un-dimmed the bubbles", () => {
  let current: Session = {
    ...session(),
    messages: [steerBubble("user_a", "check this"), steerBubble("user_b", "codex session")],
  };

  current = reduceSessionEvent(current, context(), { type: "agent_end" });
  assert.equal(
    current.messages.every((message) => message.pending !== true),
    true,
    "agent_end should un-dim the bubbles",
  );

  current = reduceSessionEvent(current, context(), userEcho("check this"));
  current = reduceSessionEvent(current, context(), userEcho("codex session"));

  assert.equal(userCount(current.messages, "check this"), 1);
  assert.equal(userCount(current.messages, "codex session"), 1);
});

// --- stale live-target pin ---------------------------------------------------

test("a pin whose bubble no longer exists does not swallow the turn", () => {
  // Reproduces the follow-up-after-a-dropped-connection loss: the pin from the
  // previous turn survived a settle that wasn't `agent_settled`, and every
  // block event afterwards was discarded against the dead id while the seq
  // cursor advanced, so nothing after the follow-up ever rendered.
  const ctx = context();
  ctx.liveAssistantIds.set("session-1", "assistant-gone");

  const next = reduceSessionEvent(session(), ctx, {
    type: "message_start",
    message: { role: "assistant", content: [{ type: "text", text: "still here" }] },
  });

  const assistants = next.messages.filter((message) => message.role === "assistant");
  assert.equal(assistants.length, 1);
  assert.notEqual(assistants[0].id, "assistant-gone");
  assert.equal(ctx.liveAssistantIds.has("session-1"), false);
});
