import { expect, test } from "bun:test";
import {
  goalContinuationPrompt,
  goalOutcomeFromText,
  isGoalContinuationPrompt,
  stripGoalSentinels,
} from "../../../shared/agent/goal-protocol";
import { goalSystemPromptSection } from "../src/goal-prompt";

test("driver prompts are tagged", () => {
  const prompt = goalContinuationPrompt("ship the release");
  expect(isGoalContinuationPrompt(prompt)).toBe(true);
  expect(prompt).toContain("ship the release");
});

test("user text is not tagged", () => {
  expect(isGoalContinuationPrompt("Continue working toward the goal: ship it")).toBe(false);
  expect(isGoalContinuationPrompt("")).toBe(false);
});

test("completion sentinel wins over prose", () => {
  expect(goalOutcomeFromText("Everything builds.\n\nGOAL_COMPLETE")).toEqual({ kind: "complete" });
});

test("blocked sentinel carries its reason", () => {
  expect(goalOutcomeFromText("GOAL_BLOCKED: no network access")).toEqual({
    kind: "blocked",
    reason: "no network access",
  });
});

test("ordinary turns have no outcome", () => {
  expect(goalOutcomeFromText("I rebuilt the bundle and it passes.")).toBeNull();
});

test("sentinel lines are stripped", () => {
  expect(stripGoalSentinels("Done.\nGOAL_COMPLETE")).toBe("Done.");
  expect(stripGoalSentinels("Stuck.\nGOAL_BLOCKED — no network")).toBe("Stuck.");
});

test("partial sentinels are hidden", () => {
  expect(stripGoalSentinels("Done.\nGOAL_COMP")).toBe("Done.");
  expect(stripGoalSentinels("Done.\nGOAL_BLO")).toBe("Done.");
});

test("ordinary goal prose survives", () => {
  const text = "The goal here is GOAL clarity";
  expect(stripGoalSentinels(text)).toBe(text);
  expect(stripGoalSentinels("no sentinels\n")).toBe("no sentinels\n");
});

test("active goals steer", () => {
  expect(goalSystemPromptSection({ objective: "ship it", status: "active" })).toContain(
    "<objective>ship it</objective>",
  );
});

test("spent budgets stop steering", () => {
  expect(
    goalSystemPromptSection({ objective: "ship it", status: "budget_limited", turnBudget: 3 }),
  ).toBeNull();
});

test("inactive goals stop steering", () => {
  for (const status of ["paused", "complete", "blocked"])
    expect(goalSystemPromptSection({ objective: "ship it", status })).toBeNull();
});
