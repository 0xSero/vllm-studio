const MARKER = "Local Studio session goal:";

/** Statuses where the goal should steer the turn. A paused/complete/blocked
 *  goal stays in the store (so the UI can show and resume it) but must not keep
 *  pushing the model. */
const STEERING_STATUSES = new Set(["active", "budget_limited"]);

type SessionGoal = {
  objective?: unknown;
  status?: unknown;
  turnBudget?: unknown;
  turnsUsed?: unknown;
};

/** Codex wraps the objective in tags and states plainly that it is instruction,
 *  not data, then reports budget so the model can pace itself. */
export function goalSystemPromptSection(goal: SessionGoal): string | null {
  const objective = typeof goal.objective === "string" ? goal.objective.trim() : "";
  if (!objective) return null;
  const status = typeof goal.status === "string" ? goal.status : "active";
  if (!STEERING_STATUSES.has(status)) return null;

  const lines = [
    MARKER,
    "You are working toward a standing objective for this session. It applies to",
    "every turn, including ones the user starts. Keep it in view when you decide",
    "what to do next, and prefer work that advances it.",
    "",
    `<objective>${objective}</objective>`,
  ];

  const turnsUsed = typeof goal.turnsUsed === "number" ? goal.turnsUsed : 0;
  const turnBudget = typeof goal.turnBudget === "number" ? goal.turnBudget : null;
  if (turnBudget !== null) {
    lines.push("", `Turn budget: ${turnsUsed} of ${turnBudget} used.`);
    if (status === "budget_limited") {
      lines.push(
        "The budget is spent. Summarise progress and what remains; do not start new work.",
      );
    }
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
