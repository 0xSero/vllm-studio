import assert from "node:assert/strict";
import { test } from "node:test";
import { canRunGoalCommand } from "./use-goal-command";

test("goal command stays a normal message until the session has a Pi identity", () => {
  assert.equal(canRunGoalCommand(null), false);
  assert.equal(canRunGoalCommand("pi-session"), true);
});
