import assert from "node:assert/strict";
import test from "node:test";

import { settleFailedTurn } from "../src/features/agent/runtime/prompt-stream";
import type { Session } from "../src/features/agent/runtime/types";

function session(patch: Partial<Session> = {}): Session {
  return {
    id: "s-1",
    runtimeSessionId: "rt-1",
    piSessionId: "pi-1",
    title: "t",
    messages: [],
    status: "starting",
    error: "",
    input: "",
    activeAssistantId: "assistant-1",
    ...patch,
  };
}

test("a failed turn idles the session when it still owns the bubble", () => {
  const out = settleFailedTurn(
    session({ activeAssistantId: "assistant-1" }),
    "assistant-1",
    "boom",
  );
  assert.equal(out.status, "idle");
  assert.equal(out.activeAssistantId, undefined);
  assert.equal(out.error, "boom");
});

test("a failed turn does NOT clobber a newer turn that already superseded it", () => {
  // The slow failed POST resolves AFTER the user sent a second prompt, which set
  // a fresh activeAssistantId and starting status.
  const superseded = session({ activeAssistantId: "assistant-2", status: "starting" });
  const out = settleFailedTurn(superseded, "assistant-1", "boom");
  assert.equal(out, superseded, "the newer turn's session object is returned untouched");
  assert.equal(out.activeAssistantId, "assistant-2");
  assert.equal(out.status, "starting");
  assert.equal(out.error, "");
});

test("a failed turn still settles when no turn currently owns the bubble", () => {
  const out = settleFailedTurn(session({ activeAssistantId: undefined }), "assistant-1", "boom");
  assert.equal(out.status, "idle");
  assert.equal(out.error, "boom");
});
