import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  appendGoalSystemPrompt,
  createGoalPromptExtension,
  goalSystemPromptSection,
  readGoalSync,
} from "../src/goal-prompt";

const dataDir = path.join(tmpdir(), `local-studio-goal-prompt-${process.pid}-${Date.now()}`);

function writeGoal(sessionId: string, goal: Record<string, unknown>): void {
  writeFileSync(path.join(dataDir, "goals", `${sessionId}.json`), JSON.stringify(goal), "utf8");
}

beforeAll(() => {
  process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
  mkdirSync(path.join(dataDir, "goals"), { recursive: true });
  writeGoal("sess-active", { version: 1, objective: "Ship the mobile nav", status: "active" });
  writeGoal("sess-paused", { version: 1, objective: "Later", status: "paused" });
});

describe("goalSystemPromptSection", () => {
  test("wraps the objective in tags so it reads as instruction, not data", () => {
    const section = goalSystemPromptSection({ objective: "Ship the mobile nav", status: "active" });
    expect(section).toContain("<objective>Ship the mobile nav</objective>");
    expect(section).toContain("Local Studio session goal:");
  });

  test("stays silent when there is no objective or the goal is not steering", () => {
    expect(goalSystemPromptSection({ objective: "   ", status: "active" })).toBeNull();
    expect(goalSystemPromptSection({})).toBeNull();
    expect(goalSystemPromptSection({ objective: "x", status: "complete" })).toBeNull();
  });

  test("reports the turn budget and warns when it is spent", () => {
    expect(
      goalSystemPromptSection({ objective: "R", status: "active", turnBudget: 10, turnsUsed: 3 }),
    ).toContain("Turn budget: 3 of 10 used.");
    expect(
      goalSystemPromptSection({
        objective: "R",
        status: "budget_limited",
        turnBudget: 10,
        turnsUsed: 10,
      }),
    ).toContain("do not start new work");
  });
});

describe("readGoalSync", () => {
  test("reads the on-disk goal keyed by the canonical piSessionId", () => {
    expect(readGoalSync("sess-active")?.objective).toBe("Ship the mobile nav");
  });

  test("returns null for an unknown session or an invalid id", () => {
    expect(readGoalSync("nope")).toBeNull();
    expect(readGoalSync("../escape")).toBeNull();
  });
});

describe("appendGoalSystemPrompt", () => {
  test("appends the objective section for an active goal", () => {
    const next = appendGoalSystemPrompt("base prompt", "sess-active");
    expect(next).not.toBeNull();
    expect(next).toContain("base prompt");
    expect(next).toContain("<objective>Ship the mobile nav</objective>");
  });

  test("is idempotent — will not append twice once the marker is present", () => {
    const once = appendGoalSystemPrompt("base prompt", "sess-active");
    expect(once).not.toBeNull();
    expect(appendGoalSystemPrompt(once as string, "sess-active")).toBeNull();
  });

  test("returns null for a non-steering goal or a session with none", () => {
    expect(appendGoalSystemPrompt("base", "sess-paused")).toBeNull();
    expect(appendGoalSystemPrompt("base", "sess-missing")).toBeNull();
  });
});

describe("createGoalPromptExtension", () => {
  function captureHandler(getId: () => string | null) {
    let handler: ((event: { systemPrompt: string }) => unknown) | null = null;
    const pi = {
      on: (name: string, h: (event: { systemPrompt: string }) => unknown) => {
        if (name === "before_agent_start") handler = h;
      },
    };
    createGoalPromptExtension(getId)(pi as never);
    if (!handler) throw new Error("handler not registered");
    return handler;
  }

  test("overrides the system prompt each turn using the live canonical id", () => {
    const handler = captureHandler(() => "sess-active");
    const result = handler({ systemPrompt: "base" }) as { systemPrompt?: string };
    expect(result.systemPrompt).toContain("<objective>Ship the mobile nav</objective>");
  });

  test("leaves the prompt untouched when there is no session id or no goal", () => {
    expect(captureHandler(() => null)({ systemPrompt: "base" })).toEqual({});
    expect(captureHandler(() => "sess-missing")({ systemPrompt: "base" })).toEqual({});
  });
});
