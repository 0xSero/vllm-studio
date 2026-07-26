import { describe, expect, test } from "bun:test";
import { goalSystemPromptSection } from "./goal";

describe("goalSystemPromptSection", () => {
  test("wraps the objective in tags so it reads as instruction, not data", () => {
    const section = goalSystemPromptSection({ objective: "Ship the mobile nav", status: "active" });
    expect(section).toContain("<objective>Ship the mobile nav</objective>");
    expect(section).toContain("Local Studio session goal:");
  });

  test("stays silent when there is no objective", () => {
    expect(goalSystemPromptSection({ objective: "   ", status: "active" })).toBeNull();
    expect(goalSystemPromptSection({})).toBeNull();
  });

  test("stops steering once the goal is paused, complete or blocked", () => {
    for (const status of ["paused", "complete", "blocked"]) {
      expect(goalSystemPromptSection({ objective: "Keep going", status })).toBeNull();
    }
  });

  test("reports the turn budget and warns when it is spent", () => {
    const active = goalSystemPromptSection({
      objective: "Refactor",
      status: "active",
      turnBudget: 10,
      turnsUsed: 3,
    });
    expect(active).toContain("Turn budget: 3 of 10 used.");
    expect(active).not.toContain("do not start new work");

    const spent = goalSystemPromptSection({
      objective: "Refactor",
      status: "budget_limited",
      turnBudget: 10,
      turnsUsed: 10,
    });
    expect(spent).toContain("do not start new work");
  });

  test("demands evidence before the completion sentinel", () => {
    const section = goalSystemPromptSection({ objective: "Fix the build", status: "active" });
    expect(section).toContain("GOAL_COMPLETE");
    expect(section).toContain("GOAL_BLOCKED");
    expect(section).toContain("concrete evidence");
  });
});
