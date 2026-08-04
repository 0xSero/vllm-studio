import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentThinkingLevel } from "@/features/agent/contracts";
import { pickThinkingLevel } from "./thinking-level-pref";

const LEVELS: readonly AgentThinkingLevel[] = ["off", "low", "medium", "high"];

test("a session's own saved level always wins", () => {
  assert.equal(pickThinkingLevel(LEVELS, "low", "medium"), "low");
});

test("a fresh session adopts the user's remembered default", () => {
  assert.equal(pickThinkingLevel(LEVELS, undefined, "medium"), "medium");
});

test("falls back to high when there is no saved or preferred level", () => {
  assert.equal(pickThinkingLevel(LEVELS, undefined, undefined), "high");
});

test("ignores saved/preferred levels the model does not support", () => {
  // "max" isn't in LEVELS, so it can't be honored and we fall through to high.
  assert.equal(pickThinkingLevel(LEVELS, "max", "max"), "high");
});

test("falls back to the last supported level when high is unavailable", () => {
  assert.equal(pickThinkingLevel(["off", "low"], undefined, undefined), "low");
});

test("returns off when the model exposes no levels", () => {
  assert.equal(pickThinkingLevel([], undefined, "high"), "off");
});
