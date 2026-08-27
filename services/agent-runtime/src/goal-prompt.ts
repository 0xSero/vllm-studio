import { readFileSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Option, Schema } from "effect";
import { resolveDataDir } from "./data-dir";

const MARKER = "Local Studio session goal:";

const STEERING_STATUSES = new Set(["active"]);
const isString = Schema.is(Schema.String);
const isNumber = Schema.is(Schema.Number);
const GoalPromptInputSchema = Schema.Struct({
  objective: Schema.optional(Schema.Unknown),
  status: Schema.optional(Schema.Unknown),
  turnBudget: Schema.optional(Schema.Unknown),
  turnsUsed: Schema.optional(Schema.Unknown),
});

export type GoalPromptInput = {
  objective?: unknown;
  status?: unknown;
  turnBudget?: unknown;
  turnsUsed?: unknown;
};

export function goalSystemPromptSection(goal: GoalPromptInput): string | null {
  const objective = isString(goal.objective) ? goal.objective.trim() : "";
  if (!objective) return null;
  const status = isString(goal.status) ? goal.status : "active";
  if (!STEERING_STATUSES.has(status)) return null;

  const lines = [
    MARKER,
    "You are working toward a standing objective for this session. It applies to",
    "every turn, including ones the user starts. Keep it in view when you decide",
    "what to do next, and prefer work that advances it.",
    "",
    `<objective>${objective}</objective>`,
  ];

  const turnsUsed = isNumber(goal.turnsUsed) ? goal.turnsUsed : 0;
  const turnBudget = isNumber(goal.turnBudget) ? goal.turnBudget : null;
  if (turnBudget !== null) {
    lines.push("", `Turn budget: ${turnsUsed} of ${turnBudget} used.`);
  } else if (turnsUsed > 0) {
    lines.push("", `Turns spent on this goal so far: ${turnsUsed}.`);
  }

  lines.push(
    "",
    "Before claiming the objective is met, audit it against concrete evidence —",
    "files written, command output, and runtime evidence — not intent. Say GOAL_COMPLETE only",
    "when that evidence exists, and GOAL_BLOCKED with the reason only when you",
    "genuinely cannot proceed.",
  );

  return lines.join("\n");
}

function goalFilePath(piSessionId: string): string | null {
  const id = piSessionId.trim();
  if (!id || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(id)) return null;
  return path.join(resolveDataDir(), "goals", `${id}.json`);
}

export function readGoalSync(piSessionId: string): GoalPromptInput | null {
  const file = goalFilePath(piSessionId);
  if (!file) return null;
  try {
    return Option.getOrNull(
      Schema.decodeUnknownOption(GoalPromptInputSchema)(JSON.parse(readFileSync(file, "utf8"))),
    );
  } catch {
    return null;
  }
}

export function appendGoalSystemPrompt(systemPrompt: string, piSessionId: string): string | null {
  const goal = readGoalSync(piSessionId);
  if (!goal) return null;
  const section = goalSystemPromptSection(goal);
  if (!section) return null;
  if (systemPrompt.includes(MARKER)) return null;
  return `${systemPrompt.trimEnd()}\n\n${section}`;
}

export function createGoalPromptExtension(getPiSessionId: () => string | null) {
  return (pi: ExtensionAPI): void => {
    pi.on("before_agent_start", (event) => {
      const piSessionId = getPiSessionId();
      if (!piSessionId) return {};
      const next = appendGoalSystemPrompt(event.systemPrompt, piSessionId);
      return next ? { systemPrompt: next } : {};
    });
  };
}
