import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatMessage } from "@/features/agent/messages";
import { stepComposerHistory, type ComposerHistoryCursor } from "./composer-history";

function user(id: number): ChatMessage {
  return { id: `user-${id}`, role: "user", text: `message ${id}` };
}

test("composer history navigates the five latest sent messages and restores the draft", () => {
  const messages: ChatMessage[] = [
    user(1),
    { id: "assistant-1", role: "assistant", text: "reply" },
    user(2),
    user(3),
    user(4),
    user(5),
    user(6),
  ];
  let cursor: ComposerHistoryCursor = { index: -1, draft: "unfinished draft" };
  const older: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    const step = stepComposerHistory(messages, cursor, "older");
    assert.ok(step);
    cursor = step.cursor;
    older.push(step.value);
  }
  assert.deepEqual(older, [
    "message 6",
    "message 5",
    "message 4",
    "message 3",
    "message 2",
    "message 2",
  ]);

  const newer: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    const step = stepComposerHistory(messages, cursor, "newer");
    assert.ok(step);
    cursor = step.cursor;
    newer.push(step.value);
  }
  assert.deepEqual(newer, ["message 3", "message 4", "message 5", "message 6", "unfinished draft"]);
});
